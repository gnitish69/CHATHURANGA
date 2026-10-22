"""
CHĀTURANGA Phase 2 — Authoritative Chess Engine Service
Powered by python-chess.
Manages the single authoritative chess game state, resolves physical sensor events,
validates moves, handles special rules (castling, en passant, promotion),
and generates LED/OLED directives.
"""

import time
import chess


class ChessEngineService:
    def __init__(self):
        self.game_id = f"game_{int(time.time())}"
        self.board = chess.Board()
        self.move_history = []
        self.status_message = "Game started. White to move."
        self.active_lift = None  # square string e.g. "e2"

    def reset(self):
        """Reset game to initial starting position."""
        self.game_id = f"game_{int(time.time())}"
        self.board = chess.Board()
        self.move_history = []
        self.status_message = "Game reset to starting position. White to move."
        self.active_lift = None
        return self.get_state()

    def get_state(self):
        """Return authoritative serializable game state."""
        return {
            "game_id": self.game_id,
            "fen": self.board.fen(),
            "turn": "white" if self.board.turn == chess.WHITE else "black",
            "is_check": self.board.is_check(),
            "is_game_over": self.board.is_game_over(),
            "status_message": self.status_message,
            "move_count": len(self.move_history),
            "history": list(self.move_history)
        }

    def process_scan(self, scan_payload):
        """
        Process hardware sensor scan diff:
        scan_payload = {
            "bitmap_hex": "0x...",
            "diff": { "lifted": ["e2"], "placed": ["e4"] },
            "debounced": True
        }
        """
        diff = scan_payload.get("diff", scan_payload)
        lifted = diff.get("lifted", [])
        placed = diff.get("placed", [])

        # Case 1: Single square lifted (Piece picked up from board)
        if len(lifted) == 1 and len(placed) == 0:
            from_sq_str = lifted[0].lower()
            try:
                from_sq = chess.parse_square(from_sq_str)
            except ValueError:
                return {
                    "status": "warning",
                    "reason": f"Invalid square {from_sq_str}",
                    "oled_message": f"ERR: SQ {from_sq_str}"
                }

            piece = self.board.piece_at(from_sq)
            if piece is None:
                return {
                    "status": "warning",
                    "reason": f"Lifted empty square {from_sq_str}",
                    "leds": {from_sq_str: "YELLOW"},
                    "oled_message": f"EMPTY LIFT @ {from_sq_str}"
                }

            is_white_piece = (piece.color == chess.WHITE)
            is_white_turn = (self.board.turn == chess.WHITE)

            if is_white_piece != is_white_turn:
                expected = "White" if is_white_turn else "Black"
                return {
                    "status": "warning",
                    "reason": f"Wrong turn! It is {expected}'s turn to move.",
                    "offending_squares": [from_sq_str],
                    "leds": {from_sq_str: "RED"},
                    "oled_message": f"WRONG TURN ({'W' if is_white_turn else 'B'})"
                }

            # Find all legal destination squares for this piece
            legal_destinations = []
            for move in self.board.legal_moves:
                if move.from_square == from_sq:
                    dest_name = chess.square_name(move.to_square)
                    if dest_name not in legal_destinations:
                        legal_destinations.append(dest_name)

            self.active_lift = from_sq_str

            leds = {from_sq_str: "YELLOW"}
            for dest in legal_destinations:
                leds[dest] = "CYAN"

            piece_symbol = piece.symbol()
            return {
                "status": "intermediate",
                "lifted": from_sq_str,
                "legalDestinations": legal_destinations,
                "leds": leds,
                "oled_message": f"LIFT: {piece_symbol} @ {from_sq_str}"
            }

        # Case 2: One placed square (Piece put down)
        if len(placed) == 1:
            to_sq_str = placed[0].lower()

            # Identify candidate from_square:
            # Either from the currently lifted squares matching active turn,
            # or from the active_lift cache
            from_sq_str = None
            for sq_name in lifted:
                try:
                    sq = chess.parse_square(sq_name.lower())
                    p = self.board.piece_at(sq)
                    if p and p.color == self.board.turn:
                        from_sq_str = sq_name.lower()
                        break
                except ValueError:
                    continue

            if not from_sq_str and self.active_lift:
                from_sq_str = self.active_lift

            if not from_sq_str and len(lifted) > 0:
                from_sq_str = lifted[0].lower()

            if not from_sq_str:
                return {
                    "status": "warning",
                    "reason": f"Placed piece on {to_sq_str} without a detected lift source.",
                    "offending_squares": [to_sq_str],
                    "leds": {to_sq_str: "RED"},
                    "oled_message": f"ORPHAN DROP @ {to_sq_str}"
                }

            # If dropped back onto the same square: user cancelled the move
            if from_sq_str == to_sq_str:
                self.active_lift = None
                return {
                    "status": "idle",
                    "oled_message": "MOVE CANCELLED",
                    "leds": {}
                }

            # Attempt move execution
            return self.execute_move(from_sq_str, to_sq_str)

        # Case 3: No change or multiple simultaneous changes settling
        if len(lifted) == 0 and len(placed) == 0:
            return {
                "status": "idle",
                "oled_message": "STANDBY"
            }

        return {
            "status": "intermediate",
            "lifted": lifted,
            "placed": placed,
            "oled_message": "SETTLING MOVE..."
        }

    def execute_move(self, from_sq_str, to_sq_str, promotion="q"):
        """
        Validate and execute a move using python-chess.
        Handles castling, en passant, promotion, and check/checkmate detection.
        """
        self.active_lift = None
        from_sq_str = from_sq_str.lower()
        to_sq_str = to_sq_str.lower()

        try:
            from_sq = chess.parse_square(from_sq_str)
            to_sq = chess.parse_square(to_sq_str)
        except ValueError:
            return {
                "status": "rejected",
                "reason": f"Invalid square coordinates: {from_sq_str}->{to_sq_str}",
                "offending_squares": [from_sq_str, to_sq_str],
                "leds": {from_sq_str: "RED", to_sq_str: "RED"},
                "oled_message": "ERR: BAD COORDS"
            }

        piece = self.board.piece_at(from_sq)
        if piece is None:
            return {
                "status": "rejected",
                "reason": f"No piece at source square {from_sq_str}",
                "offending_squares": [from_sq_str],
                "leds": {from_sq_str: "RED"},
                "oled_message": f"NO PIECE @ {from_sq_str}"
            }

        # Build candidate moves (with promotion if pawn reaches back rank)
        candidate_moves = [chess.Move(from_sq, to_sq)]
        is_pawn = piece.piece_type == chess.PAWN
        target_rank = chess.square_rank(to_sq)

        if is_pawn and target_rank in (0, 7):
            promo_piece = getattr(chess, (promotion or "q").upper(), chess.QUEEN)
            candidate_moves = [chess.Move(from_sq, to_sq, promotion=promo_piece)]

        # Check legality against python-chess authoritative rules
        matched_move = None
        for cm in candidate_moves:
            if cm in self.board.legal_moves:
                matched_move = cm
                break

        if not matched_move:
            candidate_uci = f"{from_sq_str}{to_sq_str}"
            return {
                "status": "rejected",
                "reason": f"Illegal move {candidate_uci} for {piece.symbol()}",
                "offending_squares": [from_sq_str, to_sq_str],
                "leds": {from_sq_str: "RED", to_sq_str: "RED"},
                "oled_message": f"ILLEGAL: {candidate_uci}"
            }

        # Legal move confirmed!
        uci = matched_move.uci()
        san = self.board.san(matched_move)
        turn_str = "white" if self.board.turn == chess.WHITE else "black"

        # Check for special moves (castling) for LED highlighting
        is_castling = self.board.is_castling(matched_move)

        # Apply move authoritatively
        self.board.push(matched_move)

        is_check = self.board.is_check()
        is_game_over = self.board.is_game_over()
        new_turn = "white" if self.board.turn == chess.WHITE else "black"

        if self.board.is_checkmate():
            winner = "White" if new_turn == "black" else "Black"
            self.status_message = f"Checkmate! {winner} wins."
        elif self.board.is_stalemate():
            self.status_message = "Game drawn by stalemate."
        elif is_check:
            self.status_message = f"Check! {new_turn.capitalize()} king in check."
        else:
            self.status_message = f"{new_turn.capitalize()} to move."

        move_record = {
            "uci": uci,
            "san": san,
            "fen": self.board.fen(),
            "turn": turn_str,
            "is_check": is_check,
            "is_game_over": is_game_over,
            "timestamp": int(time.time() * 1000)
        }
        self.move_history.append(move_record)

        # Build LED output directives
        leds = {
            from_sq_str: "YELLOW",
            to_sq_str: "GREEN"
        }

        # If castling, highlight both King and Rook moves
        if is_castling:
            if uci == "e1g1":
                leds["h1"] = "YELLOW"; leds["f1"] = "GREEN"
            elif uci == "e1c1":
                leds["a1"] = "YELLOW"; leds["d1"] = "GREEN"
            elif uci == "e8g8":
                leds["h8"] = "YELLOW"; leds["f8"] = "GREEN"
            elif uci == "e8c8":
                leds["a8"] = "YELLOW"; leds["d8"] = "GREEN"

        # If King is in check, light up King square in RED
        if is_check:
            king_sq = self.board.king(self.board.turn)
            if king_sq is not None:
                leds[chess.square_name(king_sq)] = "RED"

        oled_msg = f"{san} ({'W' if new_turn == 'white' else 'B'})"
        if self.board.is_checkmate():
            oled_msg = f"{san} # MATE!"
        elif is_check:
            oled_msg = f"{san} + CHECK!"

        return {
            "status": "accepted",
            "move_uci": uci,
            "move_san": san,
            "fen": self.board.fen(),
            "turn": new_turn,
            "is_check": is_check,
            "is_game_over": is_game_over,
            "leds": leds,
            "oled_message": oled_msg
        }
