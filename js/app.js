/**
 * CHĀTURANGA Main Application Orchestrator
 * Wires together BoardUI, SensorMatrix, VirtualESP32, VirtualLEDs, VirtualOLED, ApiService, and EventLogger.
 * Phase 3: Stockfish Computer Mode, Two-Player Mode, Step-by-Step Guidance, and Recovery System.
 */

import { HARDWARE_CONFIG } from './config.js';
import { SensorMatrix } from './modules/sensorMatrix.js';
import { VirtualLEDs } from './modules/virtualLEDs.js';
import { VirtualOLED } from './modules/virtualOLED.js';
import { ApiService } from './modules/apiService.js';
import { VirtualESP32, ESP_STATES } from './modules/virtualESP32.js';
import { BoardUI } from './modules/boardUI.js';
import { EventLogger } from './modules/eventLogger.js';

const SKILL_LABELS = {
  0: 'Level 0: Novice (~800 Elo)',
  3: 'Level 3: Beginner (~1100 Elo)',
  5: 'Level 5: Casual (~1400 Elo)',
  10: 'Level 10: Club (~1800 Elo)',
  15: 'Level 15: Expert (~2200 Elo)',
  20: 'Level 20: Grandmaster (~3500 Elo)'
};

class ChaturangaSimulatorApp {
  constructor() {
    this.sensorMatrix = new SensorMatrix();
    // Default to FLASK mode for seamless Phase 3 play, fallback to MOCK
    this.apiService = new ApiService({ mode: 'FLASK' });
    this.virtualLEDs = null;
    this.virtualOLED = null;
    this.virtualESP32 = null;
    this.boardUI = null;
    this.eventLogger = null;

    // Phase 3 Match Configuration
    this.gameMode = 'vs_engine'; // 'vs_engine' | 'two_player'
    this.humanColor = 'white';   // 'white' | 'black'
    this.skillLevel = 5;
    this.moveTimeMs = 300;
    this.engineStatusInterval = null;
    this.lastEngineStatus = null;
    this.engineThinkingInterval = null;
  }

  async init() {
    console.log('Initializing CHĀTURANGA Phase 3 Full Game Simulator...');

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

    // 4. Initialize Board UI & Captured Trays
    this.boardUI = new BoardUI(boardGridEl, this.sensorMatrix, this.virtualLEDs);
    this.boardUI.init();
    this.boardUI.bindCapturedTrays(
      document.getElementById('tray-white-captured'),
      document.getElementById('tray-black-captured')
    );

    // 5. Initialize Event Logger with tabs
    this.eventLogger = new EventLogger({
      sensorLog: document.getElementById('log-sensors-content'),
      moveLog: document.getElementById('log-moves-content'),
      networkLog: document.getElementById('log-network-content'),
      fenHistory: document.getElementById('log-fen-content')
    });

    // 6. Connect Event Streams
    this._wireEventStreams();

    // 7. Bind Interactive UI Controls (Phase 1, 2, and 3)
    this._bindControls();
    this._bindPhase3Controls();

    // 8. Boot ESP32 and Record Initial State
    this.virtualESP32.init();
    this.eventLogger.logFEN(HARDWARE_CONFIG.STARTING_FEN, 'Starting Position');
    this._updateBitmapDisplay();

    // 9. Start Engine Health Polling (Every 3 seconds)
    this._startEngineStatusPolling();

    // 10. Sync Initial Game State & Live Move History
    await this._syncGameState();

    console.log('CHĀTURANGA Phase 3 ready.');
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

    // E. Confirmed Moves -> Update move log & FEN & Live Moves
    this.virtualESP32.onMoveConfirmed(async (moveData) => {
      this.eventLogger.logMoveEvent(moveData);
      if (moveData.fen) {
        this.eventLogger.logFEN(moveData.fen, `${moveData.move_san || moveData.move_uci} (${moveData.turn})`);
      }
      this.virtualOLED.update({
        turn: (moveData.turn || 'WHITE').toUpperCase(),
        lastMove: moveData.move_san || moveData.move_uci,
        message: `${moveData.move_san || 'MOVE'} CONFIRMED`
      });
      await this._refreshMoveHistory();
    });

    // F. Authoritative Scan Response -> Guidance, Recovery, Promotion UI & Live Moves
    this.virtualESP32.onScanResponse((resp) => {
      this._updateGamePhaseUI(resp);
      if (resp && resp.move_history) {
        this._renderLiveMoveHistory(resp.move_history);
      }
    });

    // G. ApiService REST Traffic -> Inspector Log
    this.apiService.onTraffic((trafficEntry) => {
      this.eventLogger.logNetworkEvent(trafficEntry);
    });
  }

  _updateBitmapDisplay() {
    const hex = this.sensorMatrix.toHex();
    const bi = this.sensorMatrix.toBigInt();
    const occCount = this.sensorMatrix.getOccupiedCount();

    const hexEl = document.getElementById('bitmap-hex-val');
    const countEl = document.getElementById('bitmap-count-val');
    const binEl = document.getElementById('bitmap-binary-grid');

    if (hexEl) hexEl.textContent = hex;
    if (countEl) countEl.textContent = `${occCount}/64 squares occupied`;

    if (binEl) {
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

  // ============================================================
  // Stockfish Engine Monitoring & Async Thinking Poller
  // ============================================================
  _startEngineStatusPolling() {
    this._checkEngineStatus();
    this.engineStatusInterval = setInterval(() => {
      this._checkEngineStatus();
    }, 3000);
  }

  async _checkEngineStatus() {
    const badgeEl = document.getElementById('stockfish-engine-badge');
    const textEl = document.getElementById('stockfish-badge-text');
    if (!badgeEl || !textEl) return;

    try {
      const status = await this.apiService.getEngineStatus();
      this.lastEngineStatus = status;

      if (status.status === 'online') {
        badgeEl.className = 'status-pill pill-engine-online';
        textEl.textContent = `${(status.engine_name || 'STOCKFISH 18').toUpperCase()} ONLINE`;
        badgeEl.title = `Stockfish 18 is active and ready!\nPath: ${status.path || 'engines/stockfish'}\nThreads: 1 | Skill: ${this.skillLevel}`;
      } else if (status.status === 'mock') {
        badgeEl.className = 'status-pill pill-idle';
        textEl.textContent = 'MOCK ENGINE ACTIVE';
        badgeEl.title = 'Running in Mock Mode. Switch to Live Flask mode for Stockfish 18.';
      } else {
        badgeEl.className = 'status-pill pill-engine-offline';
        textEl.textContent = 'STOCKFISH OFFLINE';
        badgeEl.title = `Engine offline: ${status.error || 'Server unreachable'}`;
      }
    } catch (e) {
      badgeEl.className = 'status-pill pill-engine-offline';
      textEl.textContent = 'STOCKFISH OFFLINE';
    }
  }

  _startEngineThinkingPolling() {
    if (this.engineThinkingInterval) return;
    this.engineThinkingInterval = setInterval(async () => {
      try {
        const state = await this.apiService.getGameState();
        if (state && state.phase !== 'ENGINE_THINKING') {
          this._stopEngineThinkingPolling();
          this._updateGamePhaseUI(state);
          if (state.move_history) {
            this._renderLiveMoveHistory(state.move_history);
          }
          if (state.leds) {
            this.virtualESP32.setLEDCommand(state.leds);
          }
          if (state.oled_message) {
            this.virtualOLED.update({
              turn: (state.side_to_move || 'BLACK').toUpperCase(),
              lastMove: state.last_move || state.oled_message,
              message: state.oled_message
            });
          }
        }
      } catch (e) {
        console.warn('Engine thinking polling failed:', e);
      }
    }, 200);
  }

  _stopEngineThinkingPolling() {
    if (this.engineThinkingInterval) {
      clearInterval(this.engineThinkingInterval);
      this.engineThinkingInterval = null;
    }
  }

  // ============================================================
  // Phase 3 UI Updating: Guidance, Recovery, Promotion
  // ============================================================
  _updateGamePhaseUI(resp) {
    if (!resp) return;

    const bannerEl = document.getElementById('phase-status-banner');
    const titleEl = document.getElementById('phase-banner-title');
    const subEl = document.getElementById('phase-banner-sub');
    const checkBadge = document.getElementById('check-badge');

    const guidanceBox = document.getElementById('guidance-box');
    const recoveryBox = document.getElementById('recovery-box');
    const promoModal = document.getElementById('promotion-modal');

    // 1. Check Indicator
    if (checkBadge) {
      checkBadge.style.display = resp.is_check ? 'inline-block' : 'none';
    }

    // 2. Phase-specific Card Switching
    const phase = resp.phase || (resp.status === 'recovery' ? 'RECOVERY' : 'WAITING_MOVE');

    if (bannerEl) {
      bannerEl.className = 'phase-status-banner';
      if (phase === 'ENGINE_THINKING') bannerEl.classList.add('phase-thinking');
      else if (phase === 'GUIDING_ENGINE_MOVE') bannerEl.classList.add('phase-guiding');
      else if (phase === 'RECOVERY') bannerEl.classList.add('phase-recovery');
    }

    // Automatically poll backend during engine calculation
    if (phase === 'ENGINE_THINKING') {
      this._startEngineThinkingPolling();
    } else {
      this._stopEngineThinkingPolling();
    }

    // Update live move history if available
    if (resp.move_history) {
      this._renderLiveMoveHistory(resp.move_history);
    }

    // Reset modals/cards unless triggered
    if (guidanceBox) guidanceBox.style.display = 'none';
    if (recoveryBox) recoveryBox.style.display = 'none';
    if (promoModal && phase !== 'AWAITING_PROMOTION_CHOICE') {
      promoModal.classList.remove('visible');
    }

    switch (phase) {
      case 'SETUP_VERIFY':
        if (titleEl) titleEl.textContent = 'BOARD SETUP VERIFICATION';
        if (subEl) subEl.textContent = resp.oled_message || 'Place all 32 pieces in standard starting position.';
        if (resp.recovery && recoveryBox) {
          this._renderRecoveryDiff(resp.recovery, recoveryBox);
        }
        break;

      case 'WAITING_MOVE':
        const side = (resp.side_to_move || (resp.turn === 'black' ? 'BLACK' : 'WHITE')).toUpperCase();
        if (titleEl) titleEl.textContent = `${side} TO MOVE`;
        if (subEl) subEl.textContent = resp.is_check ? `Check! ${side} king in check.` : 'Pick up a piece (Yellow LED) to see legal moves (Cyan LEDs).';
        break;

      case 'MOVE_IN_PROGRESS':
        if (titleEl) titleEl.textContent = `PIECE LIFTED: ${(resp.lifted || '').toUpperCase()}`;
        if (subEl) {
          const dests = resp.legalDestinations ? resp.legalDestinations.join(', ') : 'valid squares';
          subEl.textContent = `Legal destinations: [${dests}] highlighted in Cyan.`;
        }
        break;

      case 'ENGINE_THINKING':
        if (titleEl) titleEl.textContent = '⚙ STOCKFISH THINKING...';
        if (subEl) subEl.textContent = `Computing best response at Level ${this.skillLevel}... Please do not touch board.`;
        break;

      case 'GUIDING_ENGINE_MOVE':
        if (guidanceBox && resp.guidance) {
          guidanceBox.style.display = 'block';
          const stepTag = document.getElementById('guidance-step-tag');
          const stepInst = document.getElementById('guidance-instruction');
          const hintMagenta = document.getElementById('hint-magenta');

          if (stepTag) stepTag.textContent = `STEP ${resp.guidance.step} OF ${resp.guidance.total_steps}`;
          if (stepInst) stepInst.textContent = resp.guidance.instruction;
          if (hintMagenta) {
            hintMagenta.style.display = resp.guidance.instruction.toLowerCase().includes('remove') ? 'inline-flex' : 'none';
          }
        }
        if (titleEl) titleEl.textContent = '🤖 FOLLOW ENGINE GUIDANCE';
        if (subEl) subEl.textContent = resp.guidance ? resp.guidance.instruction : 'Follow LED cues to execute computer move.';
        if (resp.leds) {
          this.virtualESP32.setLEDCommand(resp.leds);
        }
        if (resp.oled_message) {
          this.virtualOLED.update({
            turn: 'BLACK',
            lastMove: resp.guidance ? `MOVE: ${resp.guidance.instruction}` : resp.oled_message,
            message: resp.oled_message
          });
        }
        break;

      case 'RECOVERY':
        if (recoveryBox) {
          this._renderRecoveryDiff(resp.recovery || { reason: resp.reason || 'Board mismatch', missing_squares: resp.offending_squares || [], extra_squares: [] }, recoveryBox);
        }
        if (titleEl) titleEl.textContent = '🚨 ILLEGAL MOVE / RECOVERY';
        if (subEl) subEl.textContent = resp.recovery ? resp.recovery.reason : 'Restore physical board to match LEDs.';
        break;

      case 'AWAITING_PROMOTION_CHOICE':
        if (promoModal) promoModal.classList.add('visible');
        if (titleEl) titleEl.textContent = '⭐ CHOOSE PAWN PROMOTION';
        if (subEl) subEl.textContent = 'Select Queen, Rook, Bishop, or Knight below.';
        break;

      case 'GAME_OVER':
        const reason = resp.game_over ? `${resp.game_over.reason} (${resp.game_over.result})` : 'Game Over';
        if (titleEl) titleEl.textContent = '🏆 GAME OVER';
        if (subEl) subEl.textContent = reason;
        break;

      default:
        if (titleEl) titleEl.textContent = (resp.status || 'READY').toUpperCase();
        if (subEl) subEl.textContent = resp.oled_message || '';
        break;
    }
  }

  _renderRecoveryDiff(recoveryData, recoveryBox) {
    if (!recoveryBox) return;
    recoveryBox.style.display = 'block';

    const reasonEl = document.getElementById('recovery-reason');
    const diffListEl = document.getElementById('recovery-diff-list');

    if (reasonEl) reasonEl.textContent = recoveryData.reason || 'Board does not match expected game state.';
    if (diffListEl) {
      diffListEl.innerHTML = '';
      const missing = recoveryData.missing_squares || [];
      const extra = recoveryData.extra_squares || [];

      if (missing.length === 0 && extra.length === 0) {
        diffListEl.innerHTML = '<span style="color:#2ecc71;">Board restored! Continue play.</span>';
        return;
      }

      missing.forEach(sq => {
        const item = document.createElement('div');
        item.className = 'recovery-diff-item';
        item.innerHTML = `<span class="diff-pill-blue">BLUE LED</span> Put piece back on <strong>[${sq.toUpperCase()}]</strong>`;
        diffListEl.appendChild(item);
      });

      extra.forEach(sq => {
        const item = document.createElement('div');
        item.className = 'recovery-diff-item';
        item.innerHTML = `<span class="diff-pill-red">RED LED</span> Remove extra piece from <strong>[${sq.toUpperCase()}]</strong>`;
        diffListEl.appendChild(item);
      });
    }
  }

  // ============================================================
  // Phase 3 Game Actions & Match Settings Binding
  // ============================================================
  _bindPhase3Controls() {
    // 1. Mode Switcher (VS Computer vs Two Player)
    const btnVsComp = document.getElementById('btn-mode-computer');
    const btnTwoPlayer = document.getElementById('btn-mode-twoplayer');
    const compSettings = document.getElementById('vs-computer-settings');

    btnVsComp?.addEventListener('click', () => {
      this.gameMode = 'vs_engine';
      btnVsComp.classList.add('active');
      btnTwoPlayer?.classList.remove('active');
      if (compSettings) compSettings.style.display = 'block';
      this._startNewGame();
    });

    btnTwoPlayer?.addEventListener('click', () => {
      this.gameMode = 'two_player';
      btnTwoPlayer.classList.add('active');
      btnVsComp?.classList.remove('active');
      if (compSettings) compSettings.style.display = 'none';
      this._startNewGame();
    });

    // 2. Human Color Switcher (White vs Black)
    const btnWhite = document.getElementById('btn-color-white');
    const btnBlack = document.getElementById('btn-color-black');

    btnWhite?.addEventListener('click', () => {
      this.humanColor = 'white';
      btnWhite.style.background = 'var(--accent-cyan)';
      btnWhite.style.color = '#000';
      btnBlack.style.background = '#1c2638';
      btnBlack.style.color = 'var(--text-main)';
      this._startNewGame();
    });

    btnBlack?.addEventListener('click', () => {
      this.humanColor = 'black';
      btnBlack.style.background = 'var(--accent-cyan)';
      btnBlack.style.color = '#000';
      btnWhite.style.background = '#1c2638';
      btnWhite.style.color = 'var(--text-main)';
      this._startNewGame();
    });

    // 3. Stockfish Strength Slider
    const sliderSkill = document.getElementById('slider-skill-level');
    const valSkill = document.getElementById('val-skill-level');
    sliderSkill?.addEventListener('input', (e) => {
      const lvl = parseInt(e.target.value, 10);
      this.skillLevel = lvl;
      let label = `Level ${lvl}`;
      if (lvl <= 2) label += ' (Novice)';
      else if (lvl <= 5) label += ' (Casual)';
      else if (lvl <= 10) label += ' (Club Player)';
      else if (lvl <= 15) label += ' (Master)';
      else label += ' (Grandmaster)';
      if (valSkill) valSkill.textContent = label;
    });

    // 4. New Game Button
    const btnNewGame = document.getElementById('btn-new-game');
    btnNewGame?.addEventListener('click', () => {
      this._startNewGame();
    });

    // 5. Resign Button
    const btnResign = document.getElementById('btn-resign');
    btnResign?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to resign the game?')) {
        const resp = await this.apiService.resignGame();
        this._updateGamePhaseUI(resp);
        this.eventLogger.logMoveEvent({
          move_san: 'RESIGN',
          turn: 'White resigned',
          status: 'game_over'
        });
      }
    });

    // 6. Claim Draw Button
    const btnClaimDraw = document.getElementById('btn-claim-draw');
    btnClaimDraw?.addEventListener('click', async () => {
      const resp = await this.apiService.claimDraw();
      if (resp.status === 'accepted') {
        this._updateGamePhaseUI(resp);
      } else {
        alert(resp.reason || 'Draw conditions (threefold repetition or 50 moves) not yet met.');
      }
    });

    // 7. Direct 1-Click PGN Download Button
    const btnDownloadPgn = document.getElementById('btn-download-pgn');
    btnDownloadPgn?.addEventListener('click', async () => {
      await this._downloadPGN();
    });

    // 8. Copy PGN Text to Clipboard Button
    const btnExportPgn = document.getElementById('btn-export-pgn');
    btnExportPgn?.addEventListener('click', async () => {
      const pgnData = await this.apiService.getPGN();
      const pgn = pgnData.pgn || '1. ?';
      navigator.clipboard?.writeText(pgn).then(() => {
        alert(`Official PGN copied to clipboard!\n\n${pgn}`);
      }).catch(() => {
        alert(`PGN Export:\n\n${pgn}`);
      });
    });

    // 9. Promotion Choice Buttons
    const promoButtons = document.querySelectorAll('.btn-promo-piece');
    promoButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const pieceChar = btn.dataset.piece || 'q';
        const modal = document.getElementById('promotion-modal');
        if (modal) modal.classList.remove('visible');

        const resp = await this.apiService.choosePromotion(pieceChar);
        if (resp.status === 'accepted') {
          this.virtualESP32._notifyMoveConfirmed(resp);
          this._updateGamePhaseUI(resp);
        }
      });
    });

    // 10. Stockfish Badge Click -> Pop up engine information
    const badgeEl = document.getElementById('stockfish-engine-badge');
    badgeEl?.addEventListener('click', () => {
      if (!this.lastEngineStatus) return;
      alert(
        `CHĀTURANGA Stockfish Status:\n\n` +
        `Engine: ${this.lastEngineStatus.engine_name || 'Stockfish 18'}\n` +
        `Status: ${this.lastEngineStatus.status || 'online'}\n` +
        `Binary Path: ${this.lastEngineStatus.path || 'engines/stockfish'}\n` +
        `Active Skill Level: ${this.skillLevel} (0-20)\n` +
        `Search Move Time: ${this.moveTimeMs} ms\n` +
        `Authoritative Backend: http://127.0.0.1:5000`
      );
    });
  }

  // ============================================================
  // Live Move History & PGN Direct Download
  // ============================================================
  _renderLiveMoveHistory(moveHistory) {
    const listEl = document.getElementById('live-moves-list');
    if (!listEl) return;

    if (!moveHistory || moveHistory.length === 0) {
      listEl.innerHTML = '<div class="no-moves-placeholder">No moves recorded yet. Play a move on the board!</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < moveHistory.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteItem = moveHistory[i];
      const blackItem = moveHistory[i + 1];

      const whiteSan = typeof whiteItem === 'string' ? whiteItem : (whiteItem?.san || whiteItem?.uci || '');
      const blackSan = blackItem ? (typeof blackItem === 'string' ? blackItem : (blackItem?.san || blackItem?.uci || '')) : '';

      const isLatestRow = (i + 1 >= moveHistory.length - 1);
      html += `
        <div class="live-move-row ${isLatestRow ? 'latest' : ''}">
          <span class="move-num">${moveNum}.</span>
          <span class="move-white">${whiteSan}</span>
          <span class="move-black">${blackSan}</span>
        </div>
      `;
    }

    listEl.innerHTML = html;
    listEl.scrollTop = listEl.scrollHeight;
  }

  async _refreshMoveHistory() {
    try {
      const state = await this.apiService.getGameState();
      if (state && state.move_history) {
        this._renderLiveMoveHistory(state.move_history);
      }
    } catch (e) {
      console.warn('Could not refresh move history:', e);
    }
  }

  async _downloadPGN() {
    try {
      const pgnData = await this.apiService.getPGN();
      let pgn = pgnData?.pgn || '';
      if (!pgn || pgn.trim() === '') {
        alert('No moves played yet in the current game to export.');
        return;
      }

      const blob = new Blob([pgn], { type: 'application/x-chess-pgn;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
      a.href = url;
      a.download = `chaturanga_game_${dateStr}_${timeStr}.pgn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error downloading PGN file:', e);
      alert('Failed to download PGN file: ' + e.message);
    }
  }

  async _startNewGame() {
    this._stopEngineThinkingPolling();
    this.boardUI.reset();
    this.virtualESP32.reset();
    this.virtualLEDs.clearAll();
    this._renderLiveMoveHistory([]);

    const options = {
      mode: this.gameMode,
      human_color: this.humanColor,
      skill_level: this.skillLevel,
      move_time_ms: this.moveTimeMs
    };

    const state = await this.apiService.startNewGame(options);
    this._updateGamePhaseUI(state);
    if (state && state.move_history) {
      this._renderLiveMoveHistory(state.move_history);
    }
    this.eventLogger.clearAll();
    this.eventLogger.logFEN(HARDWARE_CONFIG.STARTING_FEN, `New Game (${this.gameMode === 'vs_engine' ? 'VS Stockfish' : 'Two Player'})`);
    this._updateBitmapDisplay();

    // If human is Black in VS Computer mode, engine guidance will immediately appear
    if (this.gameMode === 'vs_engine' && this.humanColor === 'black') {
      const banner = document.getElementById('phase-status-banner');
      if (banner) {
        document.getElementById('phase-banner-title').textContent = 'ENGINE THINKING (WHITE)...';
        document.getElementById('phase-banner-sub').textContent = 'Stockfish is playing White. Follow LED guidance when ready.';
      }
      this._startEngineThinkingPolling();
    }
  }

  async _syncGameState() {
    try {
      const state = await this.apiService.getGameState();
      if (state) {
        this._updateGamePhaseUI(state);
        if (state.move_history) {
          this._renderLiveMoveHistory(state.move_history);
        }
      }
    } catch (e) {
      console.warn('Initial game state sync failed:', e);
    }
  }

  // ============================================================
  // Standard Controls (Phase 1 & 2 baseline)
  // ============================================================
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
      await this._startNewGame();
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
    if (selMode) {
      selMode.value = 'FLASK';
      const flaskConfigPanel = document.getElementById('flask-config-panel');
      if (flaskConfigPanel) flaskConfigPanel.style.display = 'block';
    }
    selMode?.addEventListener('change', (e) => {
      const newMode = e.target.value;
      this.apiService.setMode(newMode);
      this.virtualOLED.update({ mode: newMode });
      const flaskConfigPanel = document.getElementById('flask-config-panel');
      if (flaskConfigPanel) {
        flaskConfigPanel.style.display = newMode === 'FLASK' ? 'block' : 'none';
      }
      this._checkEngineStatus();
    });

    const txtFlaskUrl = document.getElementById('txt-flask-url');
    txtFlaskUrl?.addEventListener('input', (e) => {
      this.apiService.setBaseUrl(e.target.value);
      this._checkEngineStatus();
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
