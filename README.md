# CHĀTURANGA — Phase 1: Hardware Simulator

An AI-powered electronic chessboard project simulating physical reed switches, a virtual ESP32 microcontroller, square LEDs, and an SSD1306 monochrome OLED display.

---

## 1. Quick Start Guide

### Prerequisites
- Node.js (v18+ recommended) or any modern web browser.
- No external internet connection or npm installation required (zero dependencies).

### Run the Application Locally
Run the built-in lightweight local static server:
```bash
npm start
```
Or with Python:
```bash
python -m http.server 3000
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

*(You can also directly open `index.html` in your browser).*

### Run Automated Tests
Execute the built-in test suite covering sensor bitmap mapping, debounce filters, mock rules, and API service:
```bash
npm test
```

---

## 2. Project Folder Structure

```
D:/CHATHURANGA/
├── index.html                   # Main Hardware Simulator UI
├── package.json                 # Test runner & static server scripts
├── README.md                    # Setup, architecture & acceptance criteria
├── WHAT_WAS_DONE.txt            # Plain-text audit summary of implementation
├── DOCS/
│   ├── SENSOR_BITMAP_SPEC.md    # 64-bit square ordering, polarity, and diff calculation
│   ├── FLASK_API_CONTRACT.md    # Proposed REST API contract for Phase 2 Flask backend
│   └── WORKFLOW_AND_PROMPTS.md  # Step-by-step workflow & exact Antigravity prompts
├── css/
│   ├── main.css                 # Base theme, typography, layout & glassmorphic cards
│   ├── board.css                # 8x8 chessboard, pieces, coordinates & virtual LEDs
│   ├── hardware.css             # ESP32 PCB breakout, OLED canvas & 64-bit bitmap viewer
│   └── panels.css               # Logs, network inspector, debug sliders & controls
├── js/
│   ├── config.js                # Hardware parameters, square mappings & starting FEN
│   ├── modules/
│   │   ├── sensorMatrix.js      # 64-square reed switch sensor state & bitmap conversions
│   │   ├── boardUI.js           # Interactive board UI, piece drag/drop & coordinates
│   │   ├── virtualESP32.js      # Scanning loop, debouncing, state machine & retry logic
│   │   ├── virtualLEDs.js       # 64-square LED controller (colors, pulse, flash)
│   │   ├── virtualOLED.js       # 128x64 SSD1306 canvas OLED display renderer
│   │   ├── apiService.js        # API service layer (Mock mode vs Live Flask mode)
│   │   ├── mockBackend.js       # python-chess-compatible move validation & FEN engine
│   │   └── eventLogger.js       # Separated sensor logs, move history & network inspector
│   └── app.js                   # Main application orchestrator
├── assets/
│   └── pieces.js                # Self-contained SVG chess pieces (100% offline)
├── images/
│   └── blockdaigram.png         # Hardware & backend architecture diagram
└── tests/
    ├── sensorBitmap.test.js     # Square index mapping & 64-bit bitmap tests
    ├── esp32Debounce.test.js    # Microcontroller scanning & debounce tests
    ├── mockBackend.test.js      # Chess rule verification, turn order & FEN tests
    └── apiService.test.js       # Mock REST API & network failure simulation tests
```

---

## 3. Sensor Bitmap Convention

| Parameter | Specification |
|:----------|:--------------|
| **Datatype** | 64-bit unsigned integer (`uint64_t` / `BigInt` / 16 hex chars) |
| **Square Mapping** | Rank-major algebraic order: `index = (rank - 1) * 8 + fileIndex` |
| **LSB (Bit 0)** | Square `a1` |
| **MSB (Bit 63)** | Square `h8` |
| **Bit Polarity** | `1` = Closed switch (Piece present / Magnet detected)<br>`0` = Open switch (Square empty) |
| **Starting Position** | `0xFFFF00000000FFFF` (32 pieces occupied) |
| **Python-Chess Compatibility** | Identical bit ordering to `chess.A1 = 0` ... `chess.H8 = 63` |

Full specification available in [`DOCS/SENSOR_BITMAP_SPEC.md`](file:///d:/CHATHURANGA/DOCS/SENSOR_BITMAP_SPEC.md).

---

## 4. Key Simulator Features

1. **Physical Reed Switch & Piece Decoupling**:
   - Physical sensors detect magnet occupancy only, not piece type.
   - Moving pieces lifts sensor at source square and closes sensor at destination square.
2. **Sensor Debug Override**:
   - Allows toggling individual sensors independently of piece presence.
   - Simulates physical hardware anomalies (stuck reed switch, missing magnet, double occupancy).
3. **ESP32 Firmware Simulation**:
   - Periodic scan loop (default 100ms, adjustable from 20ms to 1000ms).
   - N-cycle debounce filter (default 3 cycles) to eliminate mechanical contact bounce.
   - Hardware SMD LEDs for Power, Wi-Fi, TX, and RX.
   - Exponential backoff retry logic on network timeouts.
4. **SSD1306 128x64 Monochrome OLED Display**:
   - Pixel-art canvas rendering showing Wi-Fi signal, mode, turn, move notations, and alert banners.
5. **Virtual LED Indicators**:
   - 4 corner micro-LEDs and square underglow per square.
   - Colors: Green (valid move/source), Cyan (destination hint), Red (illegal move/error), Yellow (last move).
6. **Separated Loggers & Network Inspector**:
   - Sensor Events Log (physical hardware telemetry).
   - Move History Log (validated official chess moves).
   - Network Inspector (REST method, endpoint, headers, latency, payload, and response).
   - FEN History Panel with one-click clipboard copy.

---

## 5. Verification of Acceptance Criteria

| Acceptance Criterion | Verification Method | Status |
|:---------------------|:--------------------|:------:|
| 1. Initial board renders correctly | HTML5 canvas, SVG vector pieces, coordinate markers | **VERIFIED** |
| 2. Drag & drop updates simulated sensor states | `sensorMatrix.js` & `boardUI.js` unit & UI tests | **VERIFIED** |
| 3. Sensor bitmap contains 64 states with documented ordering & polarity | `tests/sensorBitmap.test.js` (11/11 tests pass) | **VERIFIED** |
| 4. Sensor changes appear in event log | Dedicated `Sensor Events` tab in `eventLogger.js` | **VERIFIED** |
| 5. Mock mode demonstrates moves with coherent FEN & history | `mockBackend.test.js` & `apiService.test.js` | **VERIFIED** |
| 6. Network failures & rejected moves are visible | Rejection flow triggers Red LEDs + OLED warning; offline toggle triggers retry backoff | **VERIFIED** |
| 7. Works locally without internet dependencies | Self-contained ES modules & vector SVG pieces | **VERIFIED** |
| 8. Automated tests cover key simulator behavior | 11 unit tests running via Node test runner | **VERIFIED** |

---

## 6. Remaining Limitations (For Future Phases)
- **Phase 2 Scope**: Stockfish evaluation, player accounts, and physical ESP32 C++ firmware are intentionally deferred per specification.
- **Clock / Timer**: Chess clock timer (e.g. Blitz 5+3) will be integrated in Phase 2 with Flask.
- **Physical ESP32 Flashing**: Will use the same REST API contract when flashing physical hardware in later stages.
