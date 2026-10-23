"""
CHĀTURANGA Phase 3 — Game Session & State Machine Service
Implements the 8-state hardware-backed chess state machine:
  1. SETUP_VERIFY
  2. WAITING_MOVE
  3. MOVE_IN_PROGRESS
  4. AWAITING_PROMOTION_CHOICE
  5. ENGINE_THINKING
  6. GUIDING_ENGINE_MOVE
  7. RECOVERY
  8. GAME_OVER
"""

import time
import threading
import chess
import chess.pgn
from backend.config import IN_PROGRESS_TIMEOUT_SECONDS, DEFAULT_SKILL_LEVEL, DEFAULT_MOVE_TIME_MS

# Standard starting board occupancy bitmap
# Ranks 1 & 2 = 0xFFFF, Ranks 7 & 8 = 0xFFFF -> 0xFFFF00000000FFFF
STARTING_OCCUPANCY = 0xFFFF00000000FFFF


def board_to_occupancy(board):
    """Convert chess.Board occupied squares to 64-bit integer."""
    return int(board.occupied)


def square_to_bit(sq):
    return 1 << sq


def bit_to_square_name(bit_idx):
    return chess.square_name(bit_idx)


class GameSession:
    def __init__(self, engine_service, mode="two_player", human_color="white", skill_level=DEFAULT_SKILL_LEVEL, move_time_ms=DEFAULT_MOVE_TIME_MS):
        self.lock = threading.RLock()
        self.engine_service = engine_service
        self.mode = mode  # "vs_engine" | "two_player"
        self.human_color = chess.WHITE if human_color.lower() == "white" else chess.BLACK
        self.skill_level = skill_level
        self.move_time_ms = move_time_ms

        self.game_id = f"game_{int(time.time())}"
        self.board = chess.Board()
        self.move_history = []
        self.phase = "SETUP_VERIFY"
        self.status_message = "Setup board to standard starting position."

        # In-progress tracking
        self.in_progress_start_time = None
        self.active_lift_square = None  # int square index
        self.pending_promotion_move = None  # chess.Move without promo piece

        # Engine guidance
        self.engine_pending_move = None  # chess.Move
        self.guidance_steps = []  # list of step dicts
        self.current_guidance_idx = 0

        # Recovery tracking
        self.prior_phase = "WAITING_MOVE"
        self.recovery_reason = ""
        self.expected_recovery_occupancy = STARTING_OCCUPANCY

        # Idempotency cache: seq -> response_dict
        self.last_seq = None
        self.last_response = None

    def start_new_game(self, mode=None, human_color=None, skill_level=None, move_time_ms=None):
        with self.lock:
            if mode: self.mode = mode
            if human_color: self.human_color = chess.WHITE if human_color.lower() == "white" else chess.BLACK
            if skill_level is not None: self.skill_level = skill_level
            if move_time_ms is not None: self.move_time_ms = move_time_ms

            self.game_id = f"game_{int(time.time())}"
            self.board = chess.Board()
            self.move_history = []
            self.phase = "SETUP_VERIFY"
            self.status_message = "Verify starting piece placement."
            self.in_progress_start_time = None
            self.active_lift_square = None
            self.pending_promotion_move = None
            self.engine_pending_move = None
            self.guidance_steps = []
            self.current_guidance_idx = 0
            self.recovery_reason = ""
            self.expected_recovery_occupancy = STARTING_OCCUPANCY
            self.last_seq = None
            self.last_response = None
            return self.get_state()

    def get_state(self):
        with self.lock:
            turn_str = "white" if self.board.turn == chess.WHITE else "black"
            return {
                "game_id": self.game_id,
                "mode": self.mode,
                "phase": self.phase,
                "human_color": "white" if self.human_color == chess.WHITE else "black",
                "fen": self.board.fen(),
                "turn": turn_str,
                "side_to_move": turn_str,
                "is_check": self.board.is_check(),
                "is_game_over": self.board.is_game_over() or (self.phase == "GAME_OVER"),
                "status_message": self.status_message,
                "move_count": len(self.move_history),
                "history": list(self.move_history),
                "move_history": list(self.move_history),
                "guidance": self._get_current_guidance_info(),
                "recovery": self._get_recovery_info(),
                "leds": self._get_current_leds(),
                "oled_message": self._get_current_oled_message(),
                "engine_status": self.engine_service.get_status() if self.engine_service else {"status": "offline"}
            }

    def process_scan(self, scan_payload):
        with self.lock:
            # Check idempotency
            seq = scan_payload.get("seq")
            if seq is not None and seq == self.last_seq and self.last_response:
                return self.last_response

            raw_bitmap_hex = scan_payload.get("bitmap_hex") or scan_payload.get("occupancy_bitmap") or "0x0"
            try:
                curr_occupancy = int(raw_bitmap_hex, 16)
            except ValueError:
                curr_occupancy = 0

            diff = scan_payload.get("diff", {})
            lifted = diff.get("lifted", [])
            placed = diff.get("placed", [])

            # Apply diff if provided to ensure curr_occupancy reflects true physical state
            for sq_name in lifted:
                try:
                    curr_occupancy &= ~(1 << chess.parse_square(sq_name.lower()))
                except ValueError:
                    pass
            for sq_name in placed:
                try:
                    curr_occupancy |= (1 << chess.parse_square(sq_name.lower()))
                except ValueError:
                    pass

            # Route by current state
            if self.phase == "SETUP_VERIFY":
                # Check if reconstructed state matches STARTING_OCCUPANCY
                reconstructed = curr_occupancy
                for sq_name in lifted:
                    try:
                        reconstructed |= (1 << chess.parse_square(sq_name.lower()))
                    except ValueError:
                        pass
                for sq_name in placed:
                    try:
                        reconstructed &= ~(1 << chess.parse_square(sq_name.lower()))
                    except ValueError:
                        pass

                if curr_occupancy == STARTING_OCCUPANCY and not lifted and not placed:
                    resp = self._handle_setup_verify(curr_occupancy)
                elif reconstructed == STARTING_OCCUPANCY and (lifted or placed):
                    # Board was set up and move has begun
                    self.board = chess.Board()
                    self.phase = "WAITING_MOVE"
                    resp = self._handle_normal_play_scan(curr_occupancy, diff)
                else:
                    resp = self._handle_setup_verify(curr_occupancy)
            elif self.phase == "RECOVERY":
                resp = self._handle_recovery(curr_occupancy)
            elif self.phase == "ENGINE_THINKING":
                resp = self._handle_engine_thinking_scan(curr_occupancy, diff)
            elif self.phase == "GUIDING_ENGINE_MOVE":
                resp = self._handle_guidance_scan(curr_occupancy)
            elif self.phase == "AWAITING_PROMOTION_CHOICE":
                resp = self._handle_awaiting_promotion_scan(curr_occupancy)
            elif self.phase == "GAME_OVER":
                resp = self._build_game_over_response()
            else:
                # WAITING_MOVE or MOVE_IN_PROGRESS
                resp = self._handle_normal_play_scan(curr_occupancy, diff)

            if seq is not None:
                self.last_seq = seq
                self.last_response = resp

            return resp

    # -------------------------------------------------------------
    # 1. SETUP_VERIFY Handler
    # -------------------------------------------------------------
    def _handle_setup_verify(self, curr_occupancy):
        if curr_occupancy == STARTING_OCCUPANCY:
            # Board correctly set up!
            self.board = chess.Board()
            if self.mode == "vs_engine" and self.human_color == chess.BLACK:
                # Human plays Black -> Engine moves first!
                self.phase = "ENGINE_THINKING"
                self.status_message = "Setup verified! Engine thinking..."
                self._trigger_engine_move()
                return {
                    "status": "accepted",
                    "phase": self.phase,
                    "mode": self.mode,
                    "side_to_move": "white",
                    "leds": {},
                    "oled_message": "ENGINE THINKING...",
                    "fen": self.board.fen()
                }
            else:
                self.phase = "WAITING_MOVE"
                self.status_message = "Setup verified! White to move."
                return {
                    "status": "accepted",
                    "phase": self.phase,
                    "mode": self.mode,
                    "side_to_move": "white",
                    "leds": {},
                    "oled_message": "WHITE TO MOVE",
                    "fen": self.board.fen()
                }

        # Board mismatch in setup
        missing, extra = self._compute_bitmap_diff(STARTING_OCCUPANCY, curr_occupancy)
        leds = {}
        for sq in missing:
            leds[sq] = {"color": "WHITE", "mode": "PULSE"}
        for sq in extra:
            leds[sq] = {"color": "RED", "mode": "SOLID"}

        self.status_message = f"Setup incomplete: {len(missing)} missing, {len(extra)} extra pieces."
        return {
            "status": "warning",
            "phase": "SETUP_VERIFY",
            "mode": self.mode,
            "leds": leds,
            "oled_message": f"SETUP: -{len(missing)} +{len(extra)}",
            "recovery": {
                "reason": "Starting board position mismatch.",
                "missing_squares": missing,
                "extra_squares": extra
            }
        }

    # -------------------------------------------------------------
    # 2. WAITING_MOVE / MOVE_IN_PROGRESS Handler
    # -------------------------------------------------------------
    def _handle_normal_play_scan(self, curr_occupancy, diff):
        official_occ = board_to_occupancy(self.board)

        # A. If current bitmap equals official occupancy
        if curr_occupancy == official_occ:
            if self.phase == "MOVE_IN_PROGRESS":
                # User lifted piece and put it back -> Cancel move
                self.phase = "WAITING_MOVE"
                self.active_lift_square = None
                self.in_progress_start_time = None
                self.status_message = f"{self._turn_name()} to move."
                return {
                    "status": "idle",
                    "phase": "WAITING_MOVE",
                    "mode": self.mode,
                    "side_to_move": self._turn_name().lower(),
                    "leds": {},
                    "oled_message": "MOVE CANCELLED",
                    "fen": self.board.fen()
                }
            return {
                "status": "idle",
                "phase": "WAITING_MOVE",
                "mode": self.mode,
                "side_to_move": self._turn_name().lower(),
                "leds": {},
                "oled_message": f"{self._turn_name().upper()} TO MOVE",
                "fen": self.board.fen()
            }

        # B. Check if current occupancy matches EXACTLY ONE legal move
        matching_legal_moves = []
        for move in self.board.legal_moves:
            # Simulate move occupancy
            test_board = self.board.copy(stack=False)
            test_board.push(move)
            if board_to_occupancy(test_board) == curr_occupancy:
                matching_legal_moves.append(move)

        if len(matching_legal_moves) == 1:
            move = matching_legal_moves[0]
            return self._apply_accepted_move(move)
        elif len(matching_legal_moves) > 1:
            # Pawn promotion: queen, rook, bishop, knight yield identical occupancy
            if all(m.promotion is not None for m in matching_legal_moves):
                self.phase = "AWAITING_PROMOTION_CHOICE"
                self.pending_promotion_move = matching_legal_moves[0]
                self.status_message = "Choose promotion piece: Q, R, B, N."
                target_sq = chess.square_name(matching_legal_moves[0].to_square)
                return {
                    "status": "intermediate",
                    "phase": "AWAITING_PROMOTION_CHOICE",
                    "mode": self.mode,
                    "leds": {target_sq: "GREEN"},
                    "oled_message": "CHOOSE PROMOTION",
                    "fen": self.board.fen()
                }

        # C. Check for Plausible In-Progress state
        if self._is_plausible_in_progress(curr_occupancy, diff):
            self.phase = "MOVE_IN_PROGRESS"
            if not self.in_progress_start_time:
                self.in_progress_start_time = time.time()

            # Generate helpful LEDs (lifted source yellow, destinations cyan)
            leds = {}
            lifted_squares = diff.get("lifted", [])
            lifted_name = None
            legal_destinations = []
            if lifted_squares:
                from_sq_name = lifted_squares[0].lower()
                try:
                    from_sq = chess.parse_square(from_sq_name)
                    piece = self.board.piece_at(from_sq)
                    if piece and piece.color == self.board.turn:
                        lifted_name = from_sq_name
                        self.active_lift_square = from_sq
                        leds[from_sq_name] = "YELLOW"
                        for m in self.board.legal_moves:
                            if m.from_square == from_sq:
                                to_name = chess.square_name(m.to_square)
                                leds[to_name] = "CYAN"
                                if to_name not in legal_destinations:
                                    legal_destinations.append(to_name)
                except ValueError:
                    pass

            return {
                "status": "intermediate",
                "phase": "MOVE_IN_PROGRESS",
                "mode": self.mode,
                "lifted": lifted_name or (lifted_squares[0] if lifted_squares else None),
                "legalDestinations": legal_destinations,
                "leds": leds,
                "oled_message": f"LIFT: {lifted_name.upper()}" if lifted_name else "MOVE IN PROGRESS",
                "fen": self.board.fen()
            }

        # D. Otherwise -> Illegal Move / Mismatch -> Enter RECOVERY
        reason = self._diagnose_illegal_move(curr_occupancy, diff)
        return self._enter_recovery(official_occ, curr_occupancy, reason)

    def _is_plausible_in_progress(self, curr_occupancy, diff):
        official_occ = board_to_occupancy(self.board)
        # 1. Check timeout
        if self.in_progress_start_time and (time.time() - self.in_progress_start_time > IN_PROGRESS_TIMEOUT_SECONDS):
            return False

        # 2. Pieces removed only (piece in hand, or captured piece removed first)
        missing_bits = official_occ & (~curr_occupancy)
        extra_bits = curr_occupancy & (~official_occ)

        # If pieces are only lifted (extra_bits == 0) and at least one belongs to active side
        if extra_bits == 0 and missing_bits != 0:
            for sq in chess.SQUARES:
                if (missing_bits & (1 << sq)) != 0:
                    piece = self.board.piece_at(sq)
                    if piece and piece.color == self.board.turn:
                        return True
            # Also allow captured piece lifted first
            return True

        # 3. Intermediate castling step: King moved 2 squares, Rook not yet moved
        for king_move in self.board.legal_moves:
            if self.board.is_castling(king_move):
                # Occupancy with only king moved
                k_from = square_to_bit(king_move.from_square)
                k_to = square_to_bit(king_move.to_square)
                castling_king_occ = (official_occ ^ k_from) | k_to
                if curr_occupancy == castling_king_occ:
                    return True

        return False

    def _apply_accepted_move(self, move):
        uci = move.uci()
        san = self.board.san(move)
        turn_str = "white" if self.board.turn == chess.WHITE else "black"
        from_name = chess.square_name(move.from_square)
        to_name = chess.square_name(move.to_square)

        self.board.push(move)
        self.move_history.append({
            "uci": uci,
            "san": san,
            "fen": self.board.fen(),
            "turn": turn_str,
            "is_check": self.board.is_check(),
            "is_game_over": self.board.is_game_over(),
            "timestamp": int(time.time() * 1000)
        })

        self.in_progress_start_time = None
        self.active_lift_square = None

        # Build LEDs
        leds = {from_name: "YELLOW", to_name: "GREEN"}
        if self.board.is_check():
            king_sq = self.board.king(self.board.turn)
            if king_sq is not None:
                leds[chess.square_name(king_sq)] = {"color": "ORANGE", "mode": "PULSE"}

        # Check game over conditions
        if self.board.is_game_over():
            self.phase = "GAME_OVER"
            res = self.board.result()
            reason = "Checkmate" if self.board.is_checkmate() else "Draw"
            self.status_message = f"Game Over: {reason} ({res})"
            return {
                "status": "accepted",
                "phase": "GAME_OVER",
                "mode": self.mode,
                "move_uci": uci,
                "move_san": san,
                "fen": self.board.fen(),
                "turn": "white" if self.board.turn == chess.WHITE else "black",
                "is_check": self.board.is_check(),
                "is_game_over": True,
                "game_over": {"result": res, "reason": reason},
                "leds": leds,
                "oled_message": f"{san} # {reason.upper()}"
            }

        # Next turn
        if self.mode == "vs_engine" and self.board.turn != self.human_color:
            # Engine's turn!
            self.phase = "ENGINE_THINKING"
            self.status_message = "Engine thinking..."
            self._trigger_engine_move()
            return {
                "status": "accepted",
                "phase": "ENGINE_THINKING",
                "mode": self.mode,
                "move_uci": uci,
                "move_san": san,
                "fen": self.board.fen(),
                "turn": "white" if self.board.turn == chess.WHITE else "black",
                "is_check": self.board.is_check(),
                "is_game_over": False,
                "leds": leds,
                "oled_message": f"{san} | THINKING..."
            }
        else:
            # Human's turn
            self.phase = "WAITING_MOVE"
            self.status_message = f"{self._turn_name()} to move."
            return {
                "status": "accepted",
                "phase": "WAITING_MOVE",
                "mode": self.mode,
                "move_uci": uci,
                "move_san": san,
                "fen": self.board.fen(),
                "turn": "white" if self.board.turn == chess.WHITE else "black",
                "is_check": self.board.is_check(),
                "is_game_over": False,
                "leds": leds,
                "oled_message": f"{san} ({'W' if self.board.turn == chess.WHITE else 'B'})"
            }

    # -------------------------------------------------------------
    # 3. AWAITING_PROMOTION_CHOICE Handler
    # -------------------------------------------------------------
    def _handle_awaiting_promotion_scan(self, curr_occupancy):
        # Keep waiting for promotion HTTP POST
        return {
            "status": "intermediate",
            "phase": "AWAITING_PROMOTION_CHOICE",
            "mode": self.mode,
            "oled_message": "SELECT Q/R/B/N",
            "fen": self.board.fen()
        }

    def choose_promotion(self, promo_char):
        with self.lock:
            if self.phase != "AWAITING_PROMOTION_CHOICE" or not self.pending_promotion_move:
                return {"status": "rejected", "reason": "Not currently awaiting promotion choice."}

            promo_map = {
                "q": chess.QUEEN,
                "r": chess.ROOK,
                "b": chess.BISHOP,
                "n": chess.KNIGHT
            }
            promo_piece = promo_map.get(promo_char.lower(), chess.QUEEN)
            full_move = chess.Move(
                self.pending_promotion_move.from_square,
                self.pending_promotion_move.to_square,
                promotion=promo_piece
            )
            self.pending_promotion_move = None
            return self._apply_accepted_move(full_move)

    # -------------------------------------------------------------
    # 4. ENGINE_THINKING & GUIDING_ENGINE_MOVE Handlers
    # -------------------------------------------------------------
    def _trigger_engine_move(self):
        board_clone = self.board.copy()
        skill = self.skill_level
        move_time = self.move_time_ms

        def _on_move_ready(engine_move):
            with self.lock:
                if self.phase == "ENGINE_THINKING":
                    self.engine_pending_move = engine_move
                    self._generate_engine_guidance(engine_move)
                    self.phase = "GUIDING_ENGINE_MOVE"
                    self.status_message = f"Engine played {engine_move.uci()}. Follow LED guidance."

        def _on_engine_error(err):
            with self.lock:
                self.phase = "RECOVERY"
                self.status_message = f"Engine search error: {err}"

        self.engine_service.search_async(board_clone, skill, move_time, _on_move_ready, _on_engine_error)

    def _handle_engine_thinking_scan(self, curr_occupancy, diff):
        official_occ = board_to_occupancy(self.board)
        if curr_occupancy != official_occ:
            # Human disturbed board while engine was thinking!
            return self._enter_recovery(official_occ, curr_occupancy, "Do not touch board while engine is thinking!")

        return {
            "status": "intermediate",
            "phase": "ENGINE_THINKING",
            "mode": self.mode,
            "leds": {},
            "oled_message": "ENGINE THINKING...",
            "fen": self.board.fen()
        }

    def _generate_engine_guidance(self, move):
        """Generate 1-step or 2-step physical guidance for engine's move with blinking LEDs."""
        from_sq = move.from_square
        to_sq = move.to_square
        from_name = chess.square_name(from_sq)
        to_name = chess.square_name(to_sq)
        is_capture = self.board.is_capture(move)
        is_castling = self.board.is_castling(move)
        is_en_passant = self.board.is_en_passant(move)
        official_occ = board_to_occupancy(self.board)

        steps = []

        if is_en_passant:
            # Step 1: Remove captured pawn on victim square
            victim_sq = chess.square(chess.square_file(to_sq), chess.square_rank(from_sq))
            victim_name = chess.square_name(victim_sq)
            occ_after_step1 = official_occ ^ square_to_bit(victim_sq)
            steps.append({
                "step": 1,
                "total_steps": 2,
                "instruction": f"Remove captured piece on {victim_name.upper()} (Blinking LED)",
                "start_occupancy": official_occ,
                "in_hand_occupancy": None,
                "expected_occupancy": occ_after_step1,
                "from_square": victim_name,
                "to_square": None,
                "leds": {victim_name: {"color": "MAGENTA", "mode": "FLASH"}},
                "pickup_leds": {victim_name: {"color": "MAGENTA", "mode": "FLASH"}},
                "place_leds": {},
                "oled": f"REMOVE: {victim_name.upper()}"
            })
            # Step 2: Move attacking pawn
            occ_after_step2 = (occ_after_step1 ^ square_to_bit(from_sq)) | square_to_bit(to_sq)
            steps.append({
                "step": 2,
                "total_steps": 2,
                "instruction": f"Pick up pawn on {from_name.upper()} (Blinking Yellow LED)",
                "start_occupancy": occ_after_step1,
                "in_hand_occupancy": occ_after_step1 ^ square_to_bit(from_sq),
                "expected_occupancy": occ_after_step2,
                "from_square": from_name,
                "to_square": to_name,
                "leds": {from_name: "YELLOW", to_name: "GREEN"},
                "pickup_leds": {from_name: {"color": "YELLOW", "mode": "FLASH"}},
                "place_leds": {to_name: {"color": "GREEN", "mode": "FLASH"}},
                "oled": f"MOVE: {from_name}->{to_name}"
            })

        elif is_castling:
            # Step 1: Move King
            k_from_bit = square_to_bit(from_sq)
            k_to_bit = square_to_bit(to_sq)
            occ_after_step1 = (official_occ ^ k_from_bit) | k_to_bit
            steps.append({
                "step": 1,
                "total_steps": 2,
                "instruction": f"Pick up King on {from_name.upper()} (Blinking Yellow LED)",
                "start_occupancy": official_occ,
                "in_hand_occupancy": official_occ ^ k_from_bit,
                "expected_occupancy": occ_after_step1,
                "from_square": from_name,
                "to_square": to_name,
                "leds": {from_name: "YELLOW", to_name: "GREEN"},
                "pickup_leds": {from_name: {"color": "YELLOW", "mode": "FLASH"}},
                "place_leds": {to_name: {"color": "GREEN", "mode": "FLASH"}},
                "oled": f"KING: {from_name}->{to_name}"
            })
            # Step 2: Move Rook
            if to_name in ("g1", "g8"):
                r_from = "h1" if to_name == "g1" else "h8"
                r_to = "f1" if to_name == "g1" else "f8"
            else:
                r_from = "a1" if to_name == "c1" else "a8"
                r_to = "d1" if to_name == "c1" else "d8"
            rf_bit = square_to_bit(chess.parse_square(r_from))
            rt_bit = square_to_bit(chess.parse_square(r_to))
            occ_after_step2 = (occ_after_step1 ^ rf_bit) | rt_bit
            steps.append({
                "step": 2,
                "total_steps": 2,
                "instruction": f"Pick up Rook on {r_from.upper()} (Blinking Yellow LED)",
                "start_occupancy": occ_after_step1,
                "in_hand_occupancy": occ_after_step1 ^ rf_bit,
                "expected_occupancy": occ_after_step2,
                "from_square": r_from,
                "to_square": r_to,
                "leds": {r_from: "YELLOW", r_to: "GREEN"},
                "pickup_leds": {r_from: {"color": "YELLOW", "mode": "FLASH"}},
                "place_leds": {r_to: {"color": "GREEN", "mode": "FLASH"}},
                "oled": f"ROOK: {r_from}->{r_to}"
            })

        elif is_capture:
            # Step 1: Remove captured piece
            occ_after_step1 = official_occ ^ square_to_bit(to_sq)
            steps.append({
                "step": 1,
                "total_steps": 2,
                "instruction": f"Remove captured piece on {to_name.upper()} (Blinking LED)",
                "start_occupancy": official_occ,
                "in_hand_occupancy": None,
                "expected_occupancy": occ_after_step1,
                "from_square": to_name,
                "to_square": None,
                "leds": {to_name: {"color": "MAGENTA", "mode": "FLASH"}},
                "pickup_leds": {to_name: {"color": "MAGENTA", "mode": "FLASH"}},
                "place_leds": {},
                "oled": f"REMOVE: {to_name.upper()}"
            })
            # Step 2: Move capturing piece
            occ_after_step2 = (occ_after_step1 ^ square_to_bit(from_sq)) | square_to_bit(to_sq)
            steps.append({
                "step": 2,
                "total_steps": 2,
                "instruction": f"Pick up piece on {from_name.upper()} (Blinking Yellow LED)",
                "start_occupancy": occ_after_step1,
                "in_hand_occupancy": occ_after_step1 ^ square_to_bit(from_sq),
                "expected_occupancy": occ_after_step2,
                "from_square": from_name,
                "to_square": to_name,
                "leds": {from_name: "YELLOW", to_name: "GREEN"},
                "pickup_leds": {from_name: {"color": "YELLOW", "mode": "FLASH"}},
                "place_leds": {to_name: {"color": "GREEN", "mode": "FLASH"}},
                "oled": f"PLACE: {from_name}->{to_name}"
            })

        else:
            # Standard Move: 1 Step
            occ_after_move = (official_occ ^ square_to_bit(from_sq)) | square_to_bit(to_sq)
            steps.append({
                "step": 1,
                "total_steps": 1,
                "instruction": f"Pick up piece on {from_name.upper()} (Blinking Yellow LED)",
                "start_occupancy": official_occ,
                "in_hand_occupancy": official_occ ^ square_to_bit(from_sq),
                "expected_occupancy": occ_after_move,
                "from_square": from_name,
                "to_square": to_name,
                "leds": {from_name: "YELLOW", to_name: "GREEN"},
                "pickup_leds": {from_name: {"color": "YELLOW", "mode": "FLASH"}},
                "place_leds": {to_name: {"color": "GREEN", "mode": "FLASH"}},
                "oled": f"MOVE: {from_name}->{to_name}"
            })

        self.guidance_steps = steps
        self.current_guidance_idx = 0

    def _handle_guidance_scan(self, curr_occupancy):
        if not self.guidance_steps or self.current_guidance_idx >= len(self.guidance_steps):
            return self._enter_recovery(board_to_occupancy(self.board), curr_occupancy, "Guidance state lost.")

        current_step = self.guidance_steps[self.current_guidance_idx]
        target_occ = current_step["expected_occupancy"]
        start_occ = current_step.get("start_occupancy")
        in_hand_occ = current_step.get("in_hand_occupancy")

        # 1. Target Step Completed!
        if curr_occupancy == target_occ:
            self.current_guidance_idx += 1
            if self.current_guidance_idx >= len(self.guidance_steps):
                # Final step completed! Apply move to official board
                move = self.engine_pending_move
                self.engine_pending_move = None
                self.guidance_steps = []
                self.current_guidance_idx = 0
                return self._apply_accepted_move(move)
            else:
                # Advance to next guidance step
                next_step = self.guidance_steps[self.current_guidance_idx]
                return {
                    "status": "intermediate",
                    "phase": "GUIDING_ENGINE_MOVE",
                    "mode": self.mode,
                    "guidance": self._get_current_guidance_info(),
                    "leds": next_step["leds"],
                    "oled_message": next_step["oled"],
                    "fen": self.board.fen()
                }

        # 2. Piece not yet lifted, or put back down onto start square
        if start_occ is not None and curr_occupancy == start_occ:
            return {
                "status": "intermediate",
                "phase": "GUIDING_ENGINE_MOVE",
                "mode": self.mode,
                "guidance": self._get_current_guidance_info(),
                "leds": current_step["leds"],
                "oled_message": current_step["oled"],
                "fen": self.board.fen()
            }

        # 3. Piece lifted from origin square and currently in hand -> Blink destination!
        if in_hand_occ is not None and curr_occupancy == in_hand_occ:
            dest_sq = current_step.get("to_square")
            in_hand_leds = current_step.get("in_hand_leds") or ({dest_sq: {"color": "GREEN", "mode": "FLASH"}} if dest_sq else current_step["leds"])
            inst_text = f"Place piece onto {dest_sq.upper()} (Blinking Green LED)" if dest_sq else current_step["instruction"]
            oled_msg = f"PLACE ON {dest_sq.upper()}" if dest_sq else current_step["oled"]
            return {
                "status": "intermediate",
                "phase": "GUIDING_ENGINE_MOVE",
                "mode": self.mode,
                "guidance": {
                    "step": current_step["step"],
                    "total_steps": current_step["total_steps"],
                    "instruction": inst_text,
                    "from_square": current_step.get("from_square"),
                    "to_square": dest_sq,
                    "in_hand": True,
                    "leds": in_hand_leds,
                    "oled": oled_msg
                },
                "leds": in_hand_leds,
                "oled_message": oled_msg,
                "fen": self.board.fen()
            }

        # 4. Human placed or lifted an incorrect square -> Enter RECOVERY
        return self._enter_recovery(target_occ, curr_occupancy, f"Deviation from guidance: {current_step['instruction']}")

    def _diagnose_illegal_move(self, curr_occupancy, diff=None):
        """Generates detailed, user-friendly explanations of chess rule violations and board mismatches."""
        official_occ = board_to_occupancy(self.board)
        missing, extra = self._compute_bitmap_diff(official_occ, curr_occupancy)
        turn_name = self._turn_name()

        # Case 1: Exactly 1 piece moved to an illegal square
        if len(missing) == 1 and len(extra) == 1:
            from_sq_name = missing[0]
            to_sq_name = extra[0]
            try:
                from_sq = chess.parse_square(from_sq_name)
                to_sq = chess.parse_square(to_sq_name)
                piece = self.board.piece_at(from_sq)

                if piece is None:
                    return f"Square {from_sq_name.upper()} was empty; cannot move an absent piece."

                piece_name = chess.piece_name(piece.piece_type).capitalize()
                piece_color = "White" if piece.color == chess.WHITE else "Black"

                if piece.color != self.board.turn:
                    return f"Turn violation: It is {turn_name}'s turn, but {piece_color} {piece_name} on {from_sq_name.upper()} was moved."

                target_piece = self.board.piece_at(to_sq)
                if target_piece and target_piece.color == piece.color:
                    return f"Cannot move {piece_name} to {to_sq_name.upper()}: square is already occupied by your own {chess.piece_name(target_piece.piece_type)}."

                # Check if king is in check
                if self.board.is_check():
                    return f"Illegal move: Your King is in CHECK! You must protect your King, block the attack, or capture the checking piece."

                # Check if piece is pinned to the King
                king_sq = self.board.king(piece.color)
                if king_sq is not None and self.board.is_pinned(piece.color, from_sq):
                    return f"Illegal move: {piece_name} on {from_sq_name.upper()} is pinned to your King. Moving it exposes your King to check."

                # Piece specific movement rules
                if piece.piece_type == chess.PAWN:
                    from_file, from_rank = chess.square_file(from_sq), chess.square_rank(from_sq)
                    to_file, to_rank = chess.square_file(to_sq), chess.square_rank(to_sq)
                    forward = 1 if piece.color == chess.WHITE else -1
                    if (to_rank - from_rank) * forward < 0:
                        return f"Pawns cannot move backwards ({from_sq_name.upper()} -> {to_sq_name.upper()})."
                    if from_file == to_file and target_piece is not None:
                        return f"Pawn on {from_sq_name.upper()} cannot advance forward because {to_sq_name.upper()} is blocked."
                    if from_file != to_file and target_piece is None:
                        return f"Pawns only move diagonally when capturing an opponent piece ({from_sq_name.upper()} -> {to_sq_name.upper()})."
                    return f"Pawn cannot make that move from {from_sq_name.upper()} to {to_sq_name.upper()}."

                elif piece.piece_type == chess.KNIGHT:
                    return f"Knights only move in an L-shape (2 squares in one direction, 1 square perpendicular). {to_sq_name.upper()} is not a legal knight jump from {from_sq_name.upper()}."

                elif piece.piece_type == chess.BISHOP:
                    from_file, from_rank = chess.square_file(from_sq), chess.square_rank(from_sq)
                    to_file, to_rank = chess.square_file(to_sq), chess.square_rank(to_sq)
                    if abs(to_file - from_file) != abs(to_rank - from_rank):
                        return f"Bishops can only move diagonally. {to_sq_name.upper()} is not diagonal from {from_sq_name.upper()}."
                    return f"Bishop on {from_sq_name.upper()} cannot reach {to_sq_name.upper()} because its diagonal path is blocked."

                elif piece.piece_type == chess.ROOK:
                    from_file, from_rank = chess.square_file(from_sq), chess.square_rank(from_sq)
                    to_file, to_rank = chess.square_file(to_sq), chess.square_rank(to_sq)
                    if from_file != to_file and from_rank != to_rank:
                        return f"Rooks can only move horizontally or vertically ({from_sq_name.upper()} -> {to_sq_name.upper()})."
                    return f"Rook on {from_sq_name.upper()} cannot reach {to_sq_name.upper()} because its path is blocked."

                elif piece.piece_type == chess.QUEEN:
                    return f"Queen on {from_sq_name.upper()} cannot move to {to_sq_name.upper()}: path is either not on a rank, file, or diagonal, or is blocked."

                elif piece.piece_type == chess.KING:
                    return f"King cannot move to {to_sq_name.upper()}: kings can only move 1 square (or castle), and cannot step into check."

                return f"Illegal move for {piece_name} from {from_sq_name.upper()} to {to_sq_name.upper()}."
            except Exception:
                pass

        # Case 2: Only 1 piece missing (e.g. piece lifted and held in hand or knocked off)
        if len(missing) == 1 and len(extra) == 0:
            sq_name = missing[0].upper()
            return f"Piece lifted or missing from {sq_name}. Place piece back on {sq_name} (Blue LED) or complete your move."

        # Case 3: Multiple pieces missing
        if len(missing) > 1 and len(extra) == 0:
            return f"{len(missing)} pieces missing ({', '.join(s.upper() for s in missing)}). Return pieces to their squares (Blue LEDs)."

        # Case 4: Extra pieces on board
        if len(extra) > 0 and len(missing) == 0:
            return f"Unexpected extra piece(s) placed on {', '.join(s.upper() for s in extra)} (Red LEDs). Please remove."

        return f"Board mismatch: {len(missing)} missing ({', '.join(s.upper() for s in missing)}), {len(extra)} extra ({', '.join(s.upper() for s in extra)}). Restore board to match LEDs."

    # -------------------------------------------------------------
    # 5. RECOVERY Handler
    # -------------------------------------------------------------
    def _enter_recovery(self, expected_occ, actual_occ, reason):
        self.prior_phase = self.phase if self.phase != "RECOVERY" else self.prior_phase
        self.phase = "RECOVERY"
        self.recovery_reason = reason
        self.expected_recovery_occupancy = expected_occ
        return self._handle_recovery(actual_occ)

    def _handle_recovery(self, curr_occupancy):
        expected_occ = self.expected_recovery_occupancy
        if curr_occupancy == expected_occ:
            # Corrected! Resume prior state
            self.phase = self.prior_phase
            self.recovery_reason = ""
            self.status_message = "Board restored successfully."
            if self.phase == "GUIDING_ENGINE_MOVE" and self.guidance_steps:
                cur = self.guidance_steps[self.current_guidance_idx]
                return {
                    "status": "intermediate",
                    "phase": "GUIDING_ENGINE_MOVE",
                    "mode": self.mode,
                    "guidance": self._get_current_guidance_info(),
                    "leds": cur["leds"],
                    "oled_message": cur["oled"],
                    "fen": self.board.fen()
                }
            return {
                "status": "idle",
                "phase": self.phase,
                "mode": self.mode,
                "side_to_move": self._turn_name().lower(),
                "leds": {},
                "oled_message": "BOARD RESTORED",
                "fen": self.board.fen()
            }

        # Still mismatched: compute blue (missing) and red (extra) LEDs
        missing, extra = self._compute_bitmap_diff(expected_occ, curr_occupancy)
        leds = {}
        for sq in missing:
            leds[sq] = {"color": "BLUE", "mode": "SOLID"}
        for sq in extra:
            leds[sq] = {"color": "RED", "mode": "SOLID"}

        return {
            "status": "recovery",
            "phase": "RECOVERY",
            "mode": self.mode,
            "side_to_move": self._turn_name().lower(),
            "recovery": {
                "reason": self.recovery_reason,
                "missing_squares": missing,
                "extra_squares": extra
            },
            "reason": self.recovery_reason,
            "offending_squares": list(set(missing + extra)),
            "leds": leds,
            "oled_message": f"! RESTORE: -{len(missing)} +{len(extra)}",
            "fen": self.board.fen()
        }

    # -------------------------------------------------------------
    # Helper Utilities
    # -------------------------------------------------------------
    def _compute_bitmap_diff(self, expected_occ, actual_occ):
        missing_squares = []
        extra_squares = []
        for sq in chess.SQUARES:
            exp_bit = (expected_occ >> sq) & 1
            act_bit = (actual_occ >> sq) & 1
            if exp_bit == 1 and act_bit == 0:
                missing_squares.append(chess.square_name(sq))
            elif exp_bit == 0 and act_bit == 1:
                extra_squares.append(chess.square_name(sq))
        return missing_squares, extra_squares

    def _get_current_guidance_info(self):
        if self.phase == "GUIDING_ENGINE_MOVE" and self.guidance_steps and self.current_guidance_idx < len(self.guidance_steps):
            step = self.guidance_steps[self.current_guidance_idx]
            return {
                "step": step["step"],
                "total_steps": step["total_steps"],
                "instruction": step["instruction"],
                "from_square": step.get("from_square"),
                "to_square": step.get("to_square"),
                "in_hand": step.get("in_hand", False),
                "expected_occupancy_hex": hex(step["expected_occupancy"]).upper(),
                "leds": step.get("leds", {}),
                "pickup_leds": step.get("pickup_leds", {}),
                "place_leds": step.get("place_leds", {}),
                "oled": step.get("oled", "")
            }
        return None

    def _get_recovery_info(self):
        if self.phase == "RECOVERY":
            missing, extra = self._compute_bitmap_diff(self.expected_recovery_occupancy, board_to_occupancy(self.board))
            return {
                "reason": self.recovery_reason,
                "expected_occupancy_hex": hex(self.expected_recovery_occupancy).upper(),
                "missing_squares": missing,
                "extra_squares": extra
            }
        return None

    def _get_current_leds(self):
        if self.phase == "GUIDING_ENGINE_MOVE" and self.guidance_steps and self.current_guidance_idx < len(self.guidance_steps):
            return self.guidance_steps[self.current_guidance_idx].get("leds", {})
        elif self.phase == "RECOVERY":
            missing, extra = self._compute_bitmap_diff(self.expected_recovery_occupancy, board_to_occupancy(self.board))
            leds = {}
            for sq in missing: leds[sq] = {"color": "BLUE", "mode": "SOLID"}
            for sq in extra: leds[sq] = {"color": "RED", "mode": "SOLID"}
            return leds
        return {}

    def _get_current_oled_message(self):
        if self.phase == "GUIDING_ENGINE_MOVE" and self.guidance_steps and self.current_guidance_idx < len(self.guidance_steps):
            return self.guidance_steps[self.current_guidance_idx].get("oled", "GUIDING MOVE")
        elif self.phase == "ENGINE_THINKING":
            return "ENGINE THINKING..."
        elif self.phase == "RECOVERY":
            return "! RESTORE BOARD"
        elif self.phase == "AWAITING_PROMOTION_CHOICE":
            return "CHOOSE PROMOTION"
        elif self.phase == "GAME_OVER":
            return f"GAME OVER ({self.board.result()})"
        return f"{self._turn_name().upper()} TO MOVE"

    def _turn_name(self):
        return "White" if self.board.turn == chess.WHITE else "Black"

    def _build_game_over_response(self):
        return {
            "status": "game_over",
            "phase": "GAME_OVER",
            "mode": self.mode,
            "oled_message": f"GAME OVER ({self.board.result()})",
            "fen": self.board.fen()
        }

    def resign(self, color):
        with self.lock:
            self.phase = "GAME_OVER"
            res = "0-1" if color.lower() == "white" else "1-0"
            self.status_message = f"Game Over: {color.capitalize()} resigned. ({res})"
            return {
                "status": "game_over",
                "phase": "GAME_OVER",
                "result": res,
                "reason": "resignation",
                "oled_message": f"{color.upper()} RESIGNED ({res})"
            }

    def claim_draw(self):
        with self.lock:
            if self.board.can_claim_threefold_repetition():
                self.phase = "GAME_OVER"
                return {"status": "game_over", "phase": "GAME_OVER", "result": "1/2-1/2", "reason": "threefold_repetition"}
            if self.board.can_claim_fifty_moves():
                self.phase = "GAME_OVER"
                return {"status": "game_over", "phase": "GAME_OVER", "result": "1/2-1/2", "reason": "fifty_moves"}
            return {"status": "rejected", "reason": "No draw condition currently claimable."}

    def get_pgn(self):
        with self.lock:
            game = chess.pgn.Game()
            game.headers["Event"] = f"CHĀTURANGA ({self.mode.replace('_', ' ').title()})"
            game.headers["Site"] = "Physical Electronic Chessboard"
            game.headers["Date"] = time.strftime("%Y.%m.%d")
            game.headers["White"] = "Human" if self.human_color == chess.WHITE else "Stockfish"
            game.headers["Black"] = "Stockfish" if self.human_color == chess.WHITE else "Human"
            game.headers["Result"] = self.board.result()

            node = game
            replay_board = chess.Board()
            for record in self.move_history:
                mv = chess.Move.from_uci(record["uci"])
                if mv in replay_board.legal_moves:
                    node = node.add_variation(mv)
                    replay_board.push(mv)

            return str(game)
