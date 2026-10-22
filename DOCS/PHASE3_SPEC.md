# CHĀTURANGA — Phase 3 Specification
Full Game, Computer Mode (Stockfish), Two-Player Mode, Illegal-Move Recovery

## ROLE
Act as a senior full-stack engineer on CHATURANGA (D:\CHATHURANGA): a browser hardware simulator (frontend) plus a Flask + python-chess backend, as described in README.md and WHAT_WAS_DONE.txt. Build PHASE 3: complete, playable chess on the physical board, including Stockfish.

## PRODUCT GOAL
I play on a physical board (simulated now, real ESP32 later). Sensors only report occupied/empty squares as a 64-bit bitmap (a1=bit 0, 1=occupied, same as python-chess board.occupied). The server validates everything and guides me with LEDs and the OLED. Two modes:
1. VS COMPUTER: I am "player one" (White by default; Black configurable). Stockfish plays the other side. Stockfish never moves anything: the server shows me which piece to lift and where to place it, and I move the engine's piece physically.
2. TWO PLAYER: two humans play on the board. The server validates each move, shows whose turn it is, and recovers from illegal moves.

## STAGE 0: VERIFY FIRST
- Run npm test and python -m pytest backend/tests -v; show real output.
- Start backend and frontend as per README, switch to Live Flask mode, make e2-e4 and then an illegal move; report exactly what the LEDs, OLED, logs and FEN show.
- List anything in WHAT_WAS_DONE.txt you cannot confirm. Fix real gaps before building features.

## STAGE 1: PLAN, THEN STOP
Inspect the code and present: (a) the state machine, (b) the API changes, (c) the module/file plan, (d) the LED colour table, (e) the test plan, (f) risks. Do not write feature code until I approve.

## HARD RULES
- The backend owns the official position and authoritative FEN. The frontend never decides legality.
- Never report a move as accepted until the backend confirms it. The official position NEVER advances on an ambiguous, illegal or mismatched bitmap.
- Sensors do not identify pieces. The backend infers moves by comparing the new stable bitmap with the occupancy produced by each legal move. Piece type is known only from the backend position. Document this limitation (e.g. wrong piece of the same colour placed on a legal square is undetectable).
- Keep backward compatibility with the existing /api/v1/hardware/scan, /game/state, /game/move (debug only, clearly labelled), /game/reset, /leds, /health. Extend, do not break.
- No SQLite, player profiles, analysis, website pages, ESP32 firmware, or machine learning in this phase.

## REQUIRED FEATURES

### A. Engine service (backend/services/engine_service.py)
- python-chess chess.engine.SimpleEngine.popen_uci, path from env STOCKFISH_PATH (fallback: backend config). Start once, reuse, close on shutdown (atexit).
- Strength via Skill Level (0-20) and/or UCI_Elo; move time in ms; both configurable per game.
- Windows pitfalls: avoid starting two engines under the Flask reloader (disable reloader or guard it); quote paths with spaces; engine crash or timeout must produce a clear error, keep the game state intact, and keep TWO PLAYER mode working.
- Engine search must NOT block the scan endpoint. Run it in a background worker and report phase ENGINE_THINKING until done. All game state access is protected by a lock. The scan endpoint must always answer quickly.

### B. Game session and state machine (explicit, documented, tested)
States: SETUP_VERIFY, WAITING_MOVE (side to move, human or engine), MOVE_IN_PROGRESS, AWAITING_PROMOTION_CHOICE, ENGINE_THINKING, GUIDING_ENGINE_MOVE (with numbered steps), RECOVERY, GAME_OVER.
- SETUP_VERIFY: a new game cannot start until the bitmap equals the starting position. LEDs show missing squares and extra squares.
- Move classification of each STABLE bitmap versus the official occupancy:
  * equal to official occupancy: no change (also how a lifted piece put back is treated: cancels).
  * equal to occupancy after exactly one legal move: candidate move. If several legal moves give the same occupancy (promotion piece), go to AWAITING_PROMOTION_CHOICE.
  * a plausible IN-PROGRESS state (only pieces removed or lifted, no new occupied squares that are not legal destinations; includes a captured piece lifted first, castling with only the king moved so far, en passant with only the pawn moved so far): stay in MOVE_IN_PROGRESS, show helpful LEDs (source, legal destinations), do not reject yet.
  * anything else, or an in-progress state that stays unresolved for a configurable timeout: RECOVERY.
- Handle: normal moves, captures, castling (both sides), en passant, promotion (piece chosen via POST /api/v1/game/promotion {piece}; simulator provides Q/R/B/N buttons standing in for physical buttons; no silent default), check, checkmate, stalemate, insufficient material, fivefold repetition, seventy-five-move rule; plus a "claim draw" action when threefold repetition or the fifty-move rule is claimable; plus resign.
- GAME_OVER shows result and reason on OLED and frontend; PGN available at GET /api/v1/game/pgn (in memory only).

### C. Illegal move and mismatch recovery
- On illegal or unexplainable bitmaps: enter RECOVERY, keep the official position unchanged, and compute the diff between the stable bitmap and the EXPECTED bitmap (the official occupancy, or the expected bitmap of the current engine-guidance step).
  * square expected occupied but empty: BLUE LED ("put a piece back here").
  * square expected empty but occupied: RED LED ("remove the piece from here").
  * OLED line states the reason in plain words (e.g. "Illegal move e2-e5. Restore board.").
- Leave RECOVERY only when the stable bitmap equals the expected bitmap exactly; then resume the previous state with the same side to move. Never allow the game to continue from a mismatch.
- Works in both modes, for the human's moves and when I deviate from engine guidance. If I move something while it is the engine's turn (ENGINE_THINKING), that is a mismatch and goes to RECOVERY.

### D. Guiding the engine's move (VS COMPUTER)
- After my accepted move, if the game is not over, ask the engine for its reply and guide me one step at a time, each step with an EXPECTED occupancy bitmap:
  * normal move: source YELLOW (lift), destination GREEN (place).
  * capture: first the captured piece's square MAGENTA (remove it), then lift (YELLOW) and place (GREEN).
  * en passant: guide removal of the captured pawn on its real square.
  * castling: king step, then rook step.
  * promotion: OLED tells me which piece to place (backend knows it); pawn removed then promoted piece placed.
- After the last step the bitmap must equal board.occupied after pushing the engine move; only then does the official position advance and the turn pass to me. Intermediate steps never change the official position.
- If I choose Black, the engine moves first: guidance starts right after setup verification.
- Show check on the king's square (distinct LED colour/pulse) after any move.

### E. LED colour table (single source of truth in docs/LED_COLORS.md; reuse Phase 2 colours where they exist)
YELLOW lift, GREEN place/accepted, MAGENTA remove captured piece, CYAN legal destinations for a lifted piece, RED remove wrong piece / illegal, BLUE put piece back, ORANGE pulse king in check, WHITE pulse setup missing squares.

### F. API (document all in DOCS/FLASK_API_CONTRACT.md; backward compatible)
- POST /api/v1/game/new {mode: "vs_engine"|"two_player", human_color: "white"|"black", skill, elo, move_time_ms}
- POST /api/v1/game/promotion {piece}
- POST /api/v1/game/resign, POST /api/v1/game/claim_draw
- GET /api/v1/game/state, GET /api/v1/game/pgn
- Scan response additions: mode, phase, side_to_move, check, guidance {step, total_steps, instruction, expected_occupancy_hex}, recovery {reason, wrong_squares}, game_over {result, reason}, engine_move {uci, san} (only once the move is completed), plus existing leds and oled.
- Frames are idempotent by seq (repeated seq returns the same response).

### G. Frontend simulator
- Mode selector (Two player / Vs computer), colour, strength, move time, New game, Resign, Claim draw, promotion buttons (Q R B N).
- Panels: current phase, instruction text, expected-vs-actual bitmap diff, recovery explanation, check and game-over banners, engine move shown only when completed.
- Let me drag a piece OFF the board to a "captured pieces" tray and back onto the board (needed to test captures and recovery realistically).
- In Mock mode, show a clear message that vs-computer, recovery and full game rules require Live Flask mode.

### H. Tests
- pytest with a deterministic FAKE engine (scripted replies): normal move, capture, castling both sides, en passant, promotion (both human choice and engine promotion guidance), wrong piece, illegal human move then recovery, lift-and-return cancels, captured-piece-lifted-first, deviation from engine guidance, move during ENGINE_THINKING, engine missing/crash, scholar's mate and fool's mate, stalemate, threefold claim, fivefold auto draw, resign, setup verification, black-side start (engine first), idempotent seq.
- A full scripted game via Flask test client, driven only by bitmaps.
- One real-Stockfish integration test, skipped automatically when STOCKFISH_PATH is unset.
- Frontend node tests for guidance and recovery rendering where practical.

## HONESTY RULES
- Do not claim anything is verified unless you ran it and show command and output.
- Separate: verified by automated tests / verified by running the app / NOT verified.
- Never weaken tests to make them pass. Fix root causes.
- Work in milestones and stop for my approval after each one.
