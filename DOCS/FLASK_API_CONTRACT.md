# CHĀTURANGA — Proposed Flask Backend API Contract (Phase 2 Ready)

## 1. Overview
This specification defines the REST API contract between the hardware layer (Virtual ESP32 simulator or physical ESP32-WROOM-32 microcontroller) and the Python Flask backend service.

Base URL: `http://localhost:5000/api/v1`

---

## 2. Endpoints

### 2.1 Send Hardware Sensor Scan
**`POST /api/v1/hardware/scan`**

Sent by ESP32 whenever a stable sensor change has been detected after debouncing.

#### Request Body:
```json
{
  "timestamp": 1729601400000,
  "bitmap_hex": "0xFFFF00000000FFFF",
  "raw_bits": "1111111111111111000000000000000000000000000000001111111111111111",
  "diff": {
    "lifted": ["e2"],
    "placed": ["e4"],
    "changedCount": 2
  },
  "debounced": true,
  "debounce_cycles": 3
}
```

#### Response Cases:

##### A. Move Accepted (`200 OK`)
```json
{
  "status": "accepted",
  "move_uci": "e2e4",
  "move_san": "e4",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "turn": "black",
  "is_check": false,
  "is_game_over": false,
  "leds": {
    "e2": "YELLOW",
    "e4": "GREEN"
  },
  "oled_message": "e4 (B)"
}
```

##### B. Intermediate Lift (`200 OK`)
Sent when a player picks up a piece, before placing it:
```json
{
  "status": "intermediate",
  "lifted": "e2",
  "legalDestinations": ["e3", "e4"],
  "leds": {
    "e2": "YELLOW",
    "e3": "CYAN",
    "e4": "CYAN"
  },
  "oled_message": "LIFT: P @ e2"
}
```

##### C. Move Rejected / Illegal Move (`400 Bad Request` or `200 OK` with rejected status)
```json
{
  "status": "rejected",
  "reason": "Illegal move e2e5 for Pawn",
  "offending_squares": ["e2", "e5"],
  "leds": {
    "e2": "RED",
    "e5": "RED"
  },
  "oled_message": "ILLEGAL: e2e5"
}
```

---

### 2.2 Get Game State
**`GET /api/v1/game/state`**

Returns authoritative game status, current FEN, move history, and turn.

#### Response (`200 OK`):
```json
{
  "game_id": "game_101",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "turn": "black",
  "is_check": false,
  "is_game_over": false,
  "status_message": "Black to move.",
  "move_count": 1,
  "history": [
    {
      "uci": "e2e4",
      "san": "e4",
      "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      "turn": "white"
    }
  ]
}
```

---

### 2.3 Execute Move (Direct UCI)
**`POST /api/v1/game/move`**

Allows triggering a move directly via UCI string (e.g. from UI click or AI engine).

#### Request:
```json
{
  "move": "e2e4",
  "promotion": "q"
}
```

#### Response (`200 OK`):
Same format as `2.1 Response Case A`.

---

### 2.4 Reset Game
**`POST /api/v1/game/reset`**

Resets the internal chess board to standard starting position `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`.

#### Request: `{}`

#### Response (`200 OK`):
```json
{
  "status": "reset",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "turn": "white",
  "message": "Game reset to starting position."
}
```

---

### 2.5 Command LEDs
**`POST /api/v1/hardware/leds`**

Manually sets or clears board LEDs.

#### Request:
```json
{
  "clearOthers": true,
  "squares": {
    "e2": { "color": "YELLOW", "mode": "SOLID" },
    "e4": { "color": "GREEN", "mode": "PULSE" }
  }
}
```

#### Response (`200 OK`):
```json
{
  "status": "success",
  "active_led_count": 2
}
```

---

### 2.6 Hardware Health Ping
**`GET /api/v1/hardware/health`**

#### Response (`200 OK`):
```json
{
  "status": "healthy",
  "uptime_seconds": 1284,
  "backend_version": "1.0.0-phase2",
  "python_chess_version": "1.10.0"
}
```
