/**
 * CHĀTURANGA Main Application Orchestrator
 * Wires together BoardUI, SensorMatrix, VirtualESP32, VirtualLEDs, VirtualOLED, ApiService, and EventLogger.
 */

import { HARDWARE_CONFIG } from './config.js';
import { SensorMatrix } from './modules/sensorMatrix.js';
import { VirtualLEDs } from './modules/virtualLEDs.js';
import { VirtualOLED } from './modules/virtualOLED.js';
import { ApiService } from './modules/apiService.js';
import { VirtualESP32, ESP_STATES } from './modules/virtualESP32.js';
import { BoardUI } from './modules/boardUI.js';
import { EventLogger } from './modules/eventLogger.js';

class ChaturangaSimulatorApp {
  constructor() {
    this.sensorMatrix = new SensorMatrix();
    this.apiService = new ApiService({ mode: 'MOCK' });
    this.virtualLEDs = null;
    this.virtualOLED = null;
    this.virtualESP32 = null;
    this.boardUI = null;
    this.eventLogger = null;
  }

  async init() {
    console.log('Initializing CHĀTURANGA Phase 1 Hardware Simulator...');

    // 1. DOM Elements
    const boardGridEl = document.getElementById('board-grid');
    const oledCanvasEl = document.getElementById('oled-canvas');

    // 2. Initialize Hardware Output Modules
    this.virtualLEDs = new VirtualLEDs(boardGridEl);
    this.virtualOLED = new VirtualOLED(oledCanvasEl);

    // 3. Initialize Microcontroller Simulation & Service Layer
    this.virtualESP32 = new VirtualESP32(
      this.sensorMatrix,
      this.apiService,
      this.virtualLEDs,
      this.virtualOLED
    );

    // 4. Initialize Board UI
    this.boardUI = new BoardUI(boardGridEl, this.sensorMatrix, this.virtualLEDs);
    this.boardUI.init();

    // 5. Initialize Event Logger with tabs
    this.eventLogger = new EventLogger({
      sensorLog: document.getElementById('log-sensors-content'),
      moveLog: document.getElementById('log-moves-content'),
      networkLog: document.getElementById('log-network-content'),
      fenHistory: document.getElementById('log-fen-content')
    });

    // 6. Connect Event Streams
    this._wireEventStreams();

    // 7. Bind Interactive UI Controls
    this._bindControls();

    // 8. Boot ESP32 and Record Initial State
    this.virtualESP32.init();
    this.eventLogger.logFEN(HARDWARE_CONFIG.STARTING_FEN, 'Starting Position');
    this._updateBitmapDisplay();

    console.log('CHĀTURANGA Simulator ready.');
  }

  _wireEventStreams() {
    // A. Sensor Matrix Updates -> Update bitmap displays
    this.sensorMatrix.onChange((event) => {
      this._updateBitmapDisplay();
      this.boardUI.updateSensorIndicators();
      if (event && event.detail && event.detail.source === 'debug_override') {
        this.eventLogger.logSensorEvent(event);
      }
    });

    // B. ESP32 Hardware Events -> Log to sensor log
    this.virtualESP32.onSensorEvent((evt) => {
      this.eventLogger.logSensorEvent(evt);
    });

    // C. ESP32 State Changes -> Update UI badges & OLED
    this.virtualESP32.onStateChange((stateInfo) => {
      this._updateHardwareBadges(stateInfo);
    });

    // D. ESP32 Hardware LEDs -> TX / RX / PWR / WIFI visual blinks
    this.virtualESP32.onHwLedChange((hwLeds) => {
      this._updateHwLeds(hwLeds);
    });

    // E. Confirmed Moves -> Update move log & FEN
    this.virtualESP32.onMoveConfirmed((moveData) => {
      this.eventLogger.logMoveEvent(moveData);
      // Sync board UI pieces with backend truth if provided
      if (this.apiService.mode === 'MOCK' && this.apiService.mockBackend) {
        this.boardUI.pieces = { ...this.apiService.mockBackend.board };
        this.boardUI.renderPieces();
      }
      this.virtualOLED.update({
        turn: moveData.turn.toUpperCase(),
        lastMove: moveData.move_san || moveData.move_uci,
        message: `${moveData.move_san} CONFIRMED`
      });
    });

    // F. ApiService REST Traffic -> Inspector Log
    this.apiService.onTraffic((trafficEntry) => {
      this.eventLogger.logNetworkEvent(trafficEntry);
    });
  }

  _updateBitmapDisplay() {
    const hex = this.sensorMatrix.toHex();
    const bi = this.sensorMatrix.toBigInt();
    const binary = bi.toString(2).padStart(64, '0');
    const occCount = this.sensorMatrix.getOccupiedCount();

    const hexEl = document.getElementById('bitmap-hex-val');
    const countEl = document.getElementById('bitmap-count-val');
    const binEl = document.getElementById('bitmap-binary-grid');

    if (hexEl) hexEl.textContent = hex;
    if (countEl) countEl.textContent = `${occCount}/64 squares occupied`;

    if (binEl) {
      // Format 64 bits into 8 ranks of 8 bits for visual matrix inspection
      // Rank 8 at top, Rank 1 at bottom
      let rowsHtml = '';
      for (let r = 7; r >= 0; r--) {
        let rowBits = '';
        for (let f = 0; f < 8; f++) {
          const idx = r * 8 + f;
          const bit = (bi >> BigInt(idx)) & 1n;
          rowBits += `<span class="bit-dot ${bit ? 'bit-1' : 'bit-0'}" title="Square ${String.fromCharCode(97+f)}${r+1}: ${bit}">${bit}</span>`;
        }
        rowsHtml += `<div class="bin-rank-row"><span class="bin-rank-num">R${r+1}</span>${rowBits}</div>`;
      }
      binEl.innerHTML = rowsHtml;
    }
  }

  _updateHardwareBadges(stateInfo) {
    const stateBadge = document.getElementById('esp-state-badge');
    const wifiBadge = document.getElementById('esp-wifi-badge');
    if (stateBadge) {
      stateBadge.textContent = stateInfo.state;
      stateBadge.className = `status-pill pill-${stateInfo.state.toLowerCase()}`;
    }
    if (wifiBadge) {
      wifiBadge.textContent = stateInfo.wifiStatus;
      wifiBadge.className = `status-pill pill-wifi-${stateInfo.wifiStatus.toLowerCase()}`;
    }
  }

  _updateHwLeds(hwLeds) {
    const pwr = document.getElementById('hw-led-pwr');
    const wifi = document.getElementById('hw-led-wifi');
    const tx = document.getElementById('hw-led-tx');
    const rx = document.getElementById('hw-led-rx');

    if (pwr) pwr.classList.toggle('active', !!hwLeds.pwr);
    if (wifi) wifi.classList.toggle('active', !!hwLeds.wifi);
    if (tx) tx.classList.toggle('active', !!hwLeds.tx);
    if (rx) rx.classList.toggle('active', !!hwLeds.rx);
  }

  _bindControls() {
    // 1. Simulation Play / Pause
    const btnPause = document.getElementById('btn-toggle-scan');
    btnPause?.addEventListener('click', () => {
      if (this.virtualESP32.isRunning) {
        this.virtualESP32.stopScanLoop();
        btnPause.innerHTML = '<span class="icon">▶</span> Resume Scan';
        btnPause.classList.add('btn-paused');
      } else {
        this.virtualESP32.startScanLoop();
        btnPause.innerHTML = '<span class="icon">⏸</span> Pause Scan';
        btnPause.classList.remove('btn-paused');
      }
    });

    // 2. Reset System
    const btnReset = document.getElementById('btn-reset-system');
    btnReset?.addEventListener('click', async () => {
      await this.apiService.resetGame();
      this.boardUI.reset();
      this.virtualESP32.reset();
      this.eventLogger.clearAll();
      this.eventLogger.logFEN(HARDWARE_CONFIG.STARTING_FEN, 'System Reset');
      this._updateBitmapDisplay();
    });

    // 3. Clear Logs
    const btnClearLogs = document.getElementById('btn-clear-logs');
    btnClearLogs?.addEventListener('click', () => {
      this.eventLogger.clearAll();
    });

    // 4. Sensor Debug Mode Toggle
    const chkDebugMode = document.getElementById('chk-sensor-debug');
    chkDebugMode?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.sensorMatrix.setDebugMode(enabled);
      const debugBanner = document.getElementById('debug-mode-banner');
      if (debugBanner) debugBanner.classList.toggle('visible', enabled);
    });

    // 5. Show / Hide Sensor Overlay Toggle
    const chkOverlay = document.getElementById('chk-sensor-overlay');
    chkOverlay?.addEventListener('change', (e) => {
      this.boardUI.setShowSensorsOverlay(e.target.checked);
    });

    // 6. Simulate Lost Connection Toggle
    const chkOffline = document.getElementById('chk-simulate-offline');
    chkOffline?.addEventListener('change', (e) => {
      this.apiService.setSimulateOffline(e.target.checked);
    });

    // 7. Backend Mode Switch (MOCK vs FLASK)
    const selMode = document.getElementById('sel-backend-mode');
    selMode?.addEventListener('change', (e) => {
      const newMode = e.target.value;
      this.apiService.setMode(newMode);
      this.virtualOLED.update({ mode: newMode });
      const flaskConfigPanel = document.getElementById('flask-config-panel');
      if (flaskConfigPanel) {
        flaskConfigPanel.style.display = newMode === 'FLASK' ? 'block' : 'none';
      }
    });

    const txtFlaskUrl = document.getElementById('txt-flask-url');
    txtFlaskUrl?.addEventListener('input', (e) => {
      this.apiService.setBaseUrl(e.target.value);
    });

    // 8. Sliders for Scan Interval & Debounce Cycles
    const sliderScan = document.getElementById('slider-scan-interval');
    const valScan = document.getElementById('val-scan-interval');
    sliderScan?.addEventListener('input', (e) => {
      const ms = parseInt(e.target.value, 10);
      valScan.textContent = `${ms} ms`;
      this.virtualESP32.setScanInterval(ms);
    });

    const sliderDebounce = document.getElementById('slider-debounce-cycles');
    const valDebounce = document.getElementById('val-debounce-cycles');
    sliderDebounce?.addEventListener('input', (e) => {
      const cycles = parseInt(e.target.value, 10);
      valDebounce.textContent = `${cycles} cycles`;
      this.virtualESP32.setDebounceCycles(cycles);
    });

    // 9. Inspector Tabs
    const tabBtns = document.querySelectorAll('.log-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.log-tab-pane').forEach(pane => {
          pane.classList.toggle('active', pane.id === targetTab);
        });
      });
    });

    // 10. Simulate Rejected Move Test Button
    const btnSimulateRejected = document.getElementById('btn-sim-rejected');
    btnSimulateRejected?.addEventListener('click', async () => {
      // Simulate an illegal move like moving e2 pawn to e6 (jumping 4 squares)
      const mockIllegalDiff = {
        lifted: ['e2'],
        placed: ['e6'],
        changedCount: 2
      };
      this.virtualESP32.state = ESP_STATES.STABLE;
      await this.virtualESP32._transmitSensorEvent(mockIllegalDiff, this.sensorMatrix.toBigInt());
    });
  }
}

// Boot on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  const app = new ChaturangaSimulatorApp();
  window.chaturangaApp = app;
  app.init();
});
