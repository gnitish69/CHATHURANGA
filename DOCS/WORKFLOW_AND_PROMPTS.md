# CHĀTURANGA — Complete Antigravity Workflow & Prompting Guide

This master guide explains the development workflow from basic setup to advanced AI training, and provides the exact prompts to give Google Antigravity across all 5 project phases.

---

## 1. End-to-End Project Roadmap (From Block Diagram)

```
[1. Physical Chessboard / Simulator]
   └── Reed switches + ESP32 detect piece movement
       ↓ (HTTP REST / WebSocket)
[2. Python + Flask Backend]
   └── Recognizes physical moves & validates rules with python-chess
       ↓
[3. SQLite Database]
   └── Stores players, game states, move timings & PGN records
       ↓
[4. Stockfish + Python Analysis]
   └── Evaluates positions, blunders, centipawn losses & weaknesses
       ↓
[5. Website + Training System]
   └── Game history, analysis reports, player profiles & replay-your-mistake mode
```

---

## 2. Engineering Workflow to Follow (Step-by-Step)

### Step 1: Foundation First (Phase 1 — Current)
- Run the Hardware Simulator independently with zero cloud dependencies.
- Verify sensor debouncing, 64-bit occupancy bitmap mapping, and mock rules.
- Test edge cases: lifted piece aborts, illegal moves, lost Wi-Fi connections.

### Step 2: Contract-Driven Backend (Phase 2)
- Build the Python Flask server implementing `DOCS/FLASK_API_CONTRACT.md`.
- Wire `python-chess` for official move resolution and FEN generation.
- Toggle Frontend API Service from `MOCK` to `FLASK` and test end-to-end.

### Step 3: Persistence Layer (Phase 3)
- Create SQLite database schema (`games`, `moves`, `players`, `evaluations`).
- Implement PGN (Portable Game Notation) export/import.
- Save every physical chessboard game session with timestamps.

### Step 4: AI Analysis Pipeline (Phase 4)
- Integrate Stockfish binary via Python's `chess.engine` UCI interface.
- Implement background async worker to evaluate centipawn scores and identify blunders.
- Generate post-game analysis charts (accuracy percentage, blunder count).

### Step 5: Web Platform & Training UI (Phase 5)
- Build responsive player dashboard, opening book stats, and historical games viewer.
- Implement "Replay Your Mistake" mode where the board LEDs illuminate to challenge the player to find the correct move!

---

## 3. Ready-to-Use Prompts for Antigravity

### PROMPT FOR PHASE 1 (Current Hardware Simulator Verification)
```text
Act as a senior full-stack engineer. Review the CHĀTURANGA Phase 1 Hardware Simulator in D:/CHATHURANGA.
1. Run the test suite: npm test
2. Start the local server on http://localhost:3000
3. Inspect and verify that:
   - 64-bit sensor bitmap displays 0xFFFF00000000FFFF with 32 occupied squares.
   - Dragging a piece (e.g. e2 to e4) triggers debounced scan and updates FEN.
   - Sensor Debug Mode allows manual toggling of individual squares.
   - Network failure simulation triggers ESP32 retry logic and OLED error alerts.
   - Illegal moves trigger red LED flashes and move rejection flow.
Provide a concise verification report.
```

---

### PROMPT FOR PHASE 2 (Python Flask Backend + python-chess)
```text
Act as a senior Python backend engineer. Build Phase 2 of CHĀTURANGA in D:/CHATHURANGA.
Objective: Implement the Python Flask backend that fulfills the API contract documented in D:/CHATHURANGA/DOCS/FLASK_API_CONTRACT.md.

Requirements:
1. Technology: Python 3, Flask, flask-cors, python-chess.
2. Implement endpoints:
   - POST /api/v1/hardware/scan (receives 64-bit bitmap and diff, resolves moves using python-chess, returns FEN, SAN, UCI, and LED/OLED directives)
   - GET /api/v1/game/state
   - POST /api/v1/game/move
   - POST /api/v1/game/reset
   - POST /api/v1/hardware/leds
   - GET /api/v1/hardware/health
3. Maintain authoritative chess state with python-chess.
4. Support all standard chess rules: pawn advances, captures, en passant, castling, promotion, check, checkmate, stalemate.
5. Create automated pytest tests verifying API endpoints and move resolution.
6. Connect with the Phase 1 frontend by testing switching Backend Mode to FLASK.
```

---

### PROMPT FOR PHASE 3 (SQLite Database & Game Persistence)
```text
Act as a senior database and backend engineer. Implement Phase 3 of CHĀTURANGA in D:/CHATHURANGA.
Objective: Add a lightweight SQLite database and PGN storage engine to persist electronic chessboard games.

Requirements:
1. Use SQLite with SQLAlchemy or Python sqlite3.
2. Database Schema:
   - players: id, username, rating, created_at
   - games: id, white_player_id, black_player_id, pgn, result, start_time, end_time, total_moves
   - moves: id, game_id, move_number, uci, san, fen_before, fen_after, timestamp_ms, time_taken_seconds
3. Implement API endpoints:
   - GET /api/v1/games (list past games)
   - GET /api/v1/games/<id> (retrieve game details & PGN)
   - GET /api/v1/games/<id>/export.pgn (download standard PGN file)
4. Automatically save the ongoing game to SQLite when game ends (checkmate, resignation, or reset).
5. Add automated unit tests for database migrations and queries.
```

---

### PROMPT FOR PHASE 4 (Stockfish Analysis Engine)
```text
Act as a senior AI/ML and Python engineer. Build Phase 4 of CHĀTURANGA in D:/CHATHURANGA.
Objective: Integrate Stockfish chess engine to analyze moves made on the physical chessboard and identify tactical blunders.

Requirements:
1. Integrate Stockfish via python-chess UCI engine interface (chess.engine).
2. Analysis Features:
   - Evaluate positions in centipawns or mate-in-N.
   - Classify moves: Best, Excellent, Good, Inaccuracy, Mistake, Blunder.
   - Calculate player accuracy score (CAPS / Lichess formula).
   - Identify top 3 suggested alternative moves.
3. Async Analysis Pipeline:
   - Provide an async or background analysis worker so move registration on the physical board remains sub-100ms real-time.
   - Endpoint GET /api/v1/analysis/<game_id> returning move-by-move evaluation graph.
4. Write pytest unit tests mocking Stockfish UCI responses.
```

---

### PROMPT FOR PHASE 5 (Web Platform & Replay-Your-Mistake Training)
```text
Act as a senior frontend engineer and UI/UX designer. Build Phase 5 of CHĀTURANGA in D:/CHATHURANGA.
Objective: Build the full web application dashboard and interactive training mode.

Requirements:
1. Rich, modern cyberpunk/hardware lab dark mode aesthetic matching Phase 1.
2. Player Dashboard:
   - Game history table with Win/Loss/Draw badges and PGN viewer.
   - Accuracy graphs and blunder breakdown.
3. "Replay Your Mistake" Mode:
   - Detects the biggest blunder from the player's last physical game.
   - Sets the physical/virtual board to the position right before the mistake.
   - Illuminates LEDs on the chessboard to challenge the player to physically find the winning move!
   - Provides hints if the player picks up the wrong piece.
```

---

## 4. Tips for Working with Antigravity
1. **One Phase at a Time**: Always build and test each phase before moving to the next.
2. **Strict Verification**: Instruct Antigravity to run unit tests and report exact test passes/failures before finishing.
3. **Preserve Hardware Abstraction**: Keep sensor occupancy strictly decoupled from piece identity so the virtual ESP32 can later be substituted with real ESP32 firmware via Wi-Fi/HTTP.
