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

    // Player Experience Features
    this.currentView = 'player'; // 'player' | 'lab'
    this.autoPlayComputerMoves = true;
    this.lastEvalScore = 0.0;
    this._isAutoMoving = false;
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
    this._initViewMode();

    // 8. Boot ESP32 and Record Initial State
    this.virtualESP32.init();
    this.eventLogger.logFEN(HARDWARE_CONFIG.STARTING_FEN, 'Starting Position');
    this._updateBitmapDisplay();
    this._updateWinProbability(HARDWARE_CONFIG.STARTING_FEN);
    this.setAIMood('neutral', "I'm ready. Make your opening move!");

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
      const history = resp?.move_history || resp?.history;
      if (history) {
        this._renderLiveMoveHistory(history);
      }
    });

    // G. BoardUI Piece Lift -> Instantly switch LED guidance from pickup to placement!
    this.boardUI.onPieceLift((sq, piece) => {
      if (this.currentPhase === 'GUIDING_ENGINE_MOVE' && this.lastGuidance) {
        const fromSq = this.lastGuidance.from_square?.toLowerCase();
        const toSq = this.lastGuidance.to_square?.toLowerCase();
        if (sq.toLowerCase() === fromSq && toSq) {
          this.boardUI.clearMoveGuidance();
          this.boardUI.highlightMoveGuidance(null, toSq);
          this.virtualLEDs.indicatePiecePickedUp(fromSq, toSq);
          const subEl = document.getElementById('phase-banner-sub');
          if (subEl) subEl.textContent = `Place piece on ${toSq.toUpperCase()} (Blinking Green LED)`;
          const stepInst = document.getElementById('guidance-instruction');
          if (stepInst) stepInst.textContent = `Place piece on ${toSq.toUpperCase()} (Blinking Green LED)`;
        }
      }
    });

    // H. ApiService REST Traffic -> Inspector Log
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
          const history = state.move_history || state.history;
          if (history) {
            this._renderLiveMoveHistory(history);
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
    this.currentPhase = phase;

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
    const history = resp.move_history || resp.history;
    if (history) {
      this._renderLiveMoveHistory(history);
    }

    // Reset modals/cards unless triggered
    if (guidanceBox) guidanceBox.style.display = 'none';
    if (recoveryBox) recoveryBox.style.display = 'none';
    if (promoModal && phase !== 'AWAITING_PROMOTION_CHOICE') {
      promoModal.classList.remove('visible');
    }

    // Update active player highlight in match status card
    const cardWhite = document.getElementById('card-player-white');
    const cardBlack = document.getElementById('card-player-black');
    const currentTurn = (resp.side_to_move || resp.turn || 'white').toLowerCase();

    if (currentTurn === 'white') {
      cardWhite?.classList.add('active-player');
      cardBlack?.classList.remove('active-player');
    } else {
      cardBlack?.classList.add('active-player');
      cardWhite?.classList.remove('active-player');
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
        if (resp.fen) {
          this._updateWinProbability(resp.fen, resp.is_check, resp.is_game_over);
        }
        if (side === 'WHITE') {
          // Human turn: clear guidance highlights after natural delay
          setTimeout(() => {
            this.boardUI.clearMoveArrow();
            this.boardUI.clearMoveGuidance();
          }, 1500);
        }
        break;

      case 'MOVE_IN_PROGRESS':
        if (titleEl) titleEl.textContent = `PIECE LIFTED: ${(resp.lifted || '').toUpperCase()}`;
        if (subEl) {
          const dests = resp.legalDestinations ? resp.legalDestinations.join(', ') : 'valid squares';
          subEl.textContent = `Legal destinations: [${dests}] highlighted in Cyan.`;
        }
        break;

      case 'ENGINE_THINKING':
        if (titleEl) titleEl.textContent = '⚙ COMPUTER THINKING...';
        if (subEl) subEl.textContent = `Calculating best response... Please do not touch board.`;
        this.setAIMood('thinking', 'Calculating move...');
        break;

      case 'GUIDING_ENGINE_MOVE':
        const guidance = resp.guidance;
        this.lastGuidance = guidance;

        if (guidanceBox && guidance) {
          guidanceBox.style.display = 'block';
          const stepTag = document.getElementById('guidance-step-tag');
          const stepInst = document.getElementById('guidance-instruction');
          const hintMagenta = document.getElementById('hint-magenta');

          if (stepTag) stepTag.textContent = `STEP ${guidance.step} OF ${guidance.total_steps}`;
          if (stepInst) stepInst.textContent = guidance.instruction;
          if (hintMagenta) {
            hintMagenta.style.display = guidance.instruction.toLowerCase().includes('remove') ? 'inline-flex' : 'none';
          }
        }

        // Computer Move LED Guidance: Blinking pick-up piece, then blinking destination square
        if (guidance) {
          let fromSq = (guidance.from_square || '').toLowerCase();
          let toSq = (guidance.to_square || '').toLowerCase();

          if (!fromSq && guidance.instruction) {
            const m = guidance.instruction.match(/on\s+([a-h][1-8])/i);
            if (m) fromSq = m[1].toLowerCase();
          }

          // Ensure arrow animation is completely cleared per user instruction
          this.boardUI.clearMoveArrow();

          const isPieceInHand = guidance.in_hand || (fromSq && !this.boardUI.pieces[fromSq]);

          if (isPieceInHand && toSq) {
            // Step 2: Piece has been lifted from board -> BLINK destination square in GREEN!
            this.boardUI.clearMoveGuidance();
            this.boardUI.highlightMoveGuidance(null, toSq);
            this.virtualLEDs.indicatePiecePickedUp(fromSq, toSq);
            if (subEl) subEl.textContent = `Place piece on ${toSq.toUpperCase()} (Blinking Green LED)`;
          } else if (fromSq) {
            // Step 1: Piece is still on board -> BLINK piece to pick up in YELLOW!
            this.boardUI.clearMoveGuidance();
            this.boardUI.highlightMoveGuidance(fromSq, null);
            this.virtualLEDs.indicateComputerMove(fromSq);
            if (subEl) subEl.textContent = `Pick up piece on ${fromSq.toUpperCase()} (Blinking Yellow LED)`;
          }
        }

        if (titleEl) titleEl.textContent = 'COMPUTER MOVE READY';
        if (resp.oled_message) {
          this.virtualOLED.update({
            turn: 'BLACK',
            lastMove: guidance ? `MOVE: ${guidance.instruction}` : resp.oled_message,
            message: resp.oled_message
          });
        }

        this.setAIMood('confident', 'Follow LED cues to complete computer move.');

        // Hands-Free Auto-Play Engine Move
        if (this.autoPlayComputerMoves && guidance && !this._isAutoMoving) {
          this._handleAutoEngineMove(guidance);
        }
        break;

      case 'RECOVERY':
        const recoveryData = resp.recovery || {
          reason: resp.reason || 'Board does not match expected game position.',
          missing_squares: resp.offending_squares || [],
          extra_squares: []
        };
        if (recoveryBox) {
          this._renderRecoveryDiff(recoveryData, recoveryBox);
        }
        if (titleEl) titleEl.textContent = '⚠️ ILLEGAL MOVE / RECOVERY';
        if (subEl) subEl.textContent = recoveryData.reason || 'Please restore board to match the LEDs.';
        this.setAIMood('panic', recoveryData.reason || 'Board restore required.');
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
        if (resp.fen) {
          this._updateWinProbability(resp.fen, resp.is_check, true, resp.game_over?.result);
        }
        break;

      default:
        if (titleEl) titleEl.textContent = (resp.status || 'READY').toUpperCase();
        if (subEl) subEl.textContent = resp.oled_message || '';
        if (resp.fen) {
          this._updateWinProbability(resp.fen, resp.is_check);
        }
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

    // 11. Auto-Play Computer Moves Toggle
    const chkAutoMove = document.getElementById('chk-auto-engine-move');
    chkAutoMove?.addEventListener('change', (e) => {
      this.autoPlayComputerMoves = e.target.checked;
    });

    // 12. Restore Legal Board Position Buttons (Toolbar + Recovery Box)
    const btnRestore = document.getElementById('btn-restore-board');
    btnRestore?.addEventListener('click', () => {
      this._restoreLegalBoard();
    });

    const btnRecoveryFix = document.getElementById('btn-recovery-auto-fix');
    btnRecoveryFix?.addEventListener('click', () => {
      this._restoreLegalBoard();
    });
  }

  // ============================================================
  // View Switcher (Player Mode vs Hardware Lab Mode)
  // ============================================================
  _initViewMode() {
    const btnPlayer = document.getElementById('btn-view-player');
    const btnLab = document.getElementById('btn-view-lab');
    if (!btnPlayer || !btnLab) return;

    // Default: Player Mode for clean, focused game experience
    document.body.classList.add('player-view');
    document.body.classList.remove('lab-view');

    btnPlayer.addEventListener('click', () => {
      this.currentView = 'player';
      btnPlayer.classList.add('active');
      btnLab.classList.remove('active');
      document.body.classList.add('player-view');
      document.body.classList.remove('lab-view');
    });

    btnLab.addEventListener('click', () => {
      this.currentView = 'lab';
      btnLab.classList.add('active');
      btnPlayer.classList.remove('active');
      document.body.classList.remove('player-view');
      document.body.classList.add('lab-view');
    });
  }

  // ============================================================
  // Win Probability / Evaluation Bar Calculation
  // ============================================================
  _updateWinProbability(fen, isCheck = false, isGameOver = false, result = null) {
    const blackBar = document.getElementById('eval-bar-black');
    const whiteBar = document.getElementById('eval-bar-white');
    const scoreTag = document.getElementById('eval-score-tag');
    if (!blackBar || !whiteBar || !scoreTag) return;

    if (isGameOver) {
      if (result && result.includes('1-0')) {
        whiteBar.style.height = '100%';
        blackBar.style.height = '0%';
        scoreTag.style.top = '10%';
        scoreTag.textContent = '1-0';
        this.setAIMood('panic', 'You won! Beautiful victory.');
        return;
      } else if (result && result.includes('0-1')) {
        whiteBar.style.height = '0%';
        blackBar.style.height = '100%';
        scoreTag.style.top = '90%';
        scoreTag.textContent = '0-1';
        this.setAIMood('happy', 'Checkmate! Good game.');
        return;
      } else {
        whiteBar.style.height = '50%';
        blackBar.style.height = '50%';
        scoreTag.style.top = '50%';
        scoreTag.textContent = '1/2';
        this.setAIMood('neutral', 'The game concluded in a draw.');
        return;
      }
    }

    if (!fen) fen = HARDWARE_CONFIG.STARTING_FEN;
    const pos = fen.split(' ')[0];

    // Piece values
    const PIECE_VALS = {
      'P': 1.0, 'N': 3.1, 'B': 3.25, 'R': 5.0, 'Q': 9.5, 'K': 0.0,
      'p': -1.0, 'n': -3.1, 'b': -3.25, 'r': -5.0, 'q': -9.5, 'k': -0.0
    };

    let score = 0.0;
    const rows = pos.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (!isNaN(parseInt(ch, 10))) {
          f += parseInt(ch, 10);
        } else {
          score += (PIECE_VALS[ch] || 0.0);
          // Small center square positional evaluation
          if ((r === 3 || r === 4) && (f === 3 || f === 4)) {
            score += (ch === ch.toUpperCase() ? 0.25 : -0.25);
          }
          f++;
        }
      }
    }

    if (isCheck) {
      const turn = fen.split(' ')[1];
      score += (turn === 'w' ? -0.7 : 0.7);
    }

    this.lastEvalScore = score;
    const cp = score * 100;
    // Win probability formula: P(White) = 1 / (1 + 10^(-cp / 400))
    let pWhite = 1 / (1 + Math.pow(10, -cp / 400)) * 100;
    pWhite = Math.max(3, Math.min(97, pWhite));

    whiteBar.style.height = `${pWhite}%`;
    blackBar.style.height = `${100 - pWhite}%`;
    scoreTag.style.top = `${100 - pWhite}%`;

    const formattedScore = score >= 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
    scoreTag.textContent = formattedScore;

    // AI Avatar reaction based on evaluation score & turn
    if (this.gameMode === 'vs_engine') {
      const botColor = this.humanColor === 'white' ? 'black' : 'white';
      const botAdvantage = (botColor === 'black' ? -score : score);

      if (isCheck) {
        if (botAdvantage < -1.0) {
          this.setAIMood('panic', 'Check! My king is under heavy fire!');
        } else {
          this.setAIMood('happy', 'Check! Watch your defenses!');
        }
      } else if (botAdvantage > 2.0) {
        this.setAIMood('happy', 'My position is dominating. Checkmate is on the horizon.');
      } else if (botAdvantage > 0.8) {
        this.setAIMood('confident', 'A solid positional advantage. Your options are shrinking.');
      } else if (botAdvantage < -2.0) {
        this.setAIMood('panic', 'Incredible tactical blow! My evaluations are dropping rapidly.');
      } else if (botAdvantage < -0.8) {
        this.setAIMood('worried', 'You found a great move. I need to be careful here.');
      } else {
        this.setAIMood('neutral', 'A balanced contest. Let us see who blunders first.');
      }
    }
  }

  // ============================================================
  // AI Bot Persona: Facial Expressions & Speech Bubble
  // ============================================================
  setAIMood(mood, quote) {
    const card = document.getElementById('ai-persona-card');
    const badge = document.getElementById('ai-mood-badge');
    const bubble = document.getElementById('ai-speech-bubble');
    const mouth = document.getElementById('ai-mouth');
    const browL = document.getElementById('eyebrow-left');
    const browR = document.getElementById('eyebrow-right');
    const accent = document.getElementById('emotion-accent');

    const statusBlack = document.getElementById('status-player-black');
    if (statusBlack) {
      if (mood === 'thinking') {
        statusBlack.textContent = 'Thinking...';
      } else if (mood === 'panic') {
        statusBlack.textContent = 'Check!';
      } else {
        statusBlack.textContent = `Stockfish (Lvl ${this.skillLevel})`;
      }
    }

    if (!card) return;

    card.classList.remove('mood-thinking', 'mood-confident', 'mood-happy', 'mood-worried', 'mood-panic');
    if (mood !== 'neutral') card.classList.add(`mood-${mood}`);

    if (bubble && quote) bubble.textContent = `"${quote}"`;

    if (badge) {
      const labels = {
        'thinking': 'Calculating...',
        'confident': 'Confident',
        'happy': 'Victorious',
        'worried': 'Worried',
        'panic': 'Panicked!',
        'neutral': 'Focused'
      };
      badge.textContent = labels[mood] || 'Focused';
    }

    if (accent) {
      if (mood === 'panic') {
        accent.style.display = 'block';
        accent.setAttribute('fill', '#ff4757');
      } else if (mood === 'worried') {
        accent.style.display = 'block';
        accent.setAttribute('fill', '#38e1ff');
      } else {
        accent.style.display = 'none';
      }
    }

    if (mouth) {
      switch (mood) {
        case 'happy':
          mouth.setAttribute('d', 'M 35 62 Q 50 78 65 62');
          break;
        case 'confident':
          mouth.setAttribute('d', 'M 35 64 Q 50 72 65 64');
          break;
        case 'worried':
          mouth.setAttribute('d', 'M 35 68 Q 50 62 65 68');
          break;
        case 'panic':
          mouth.setAttribute('d', 'M 42 66 Q 50 58 58 66 Q 50 74 42 66');
          break;
        case 'thinking':
          mouth.setAttribute('d', 'M 38 66 L 62 66');
          break;
        default:
          mouth.setAttribute('d', 'M 35 66 Q 50 68 65 66');
      }
    }

    if (browL && browR) {
      switch (mood) {
        case 'confident':
          browL.setAttribute('y1', '33'); browL.setAttribute('y2', '28');
          browR.setAttribute('y1', '28'); browR.setAttribute('y2', '33');
          break;
        case 'worried':
          browL.setAttribute('y1', '26'); browL.setAttribute('y2', '30');
          browR.setAttribute('y1', '30'); browR.setAttribute('y2', '26');
          break;
        case 'panic':
          browL.setAttribute('y1', '24'); browL.setAttribute('y2', '28');
          browR.setAttribute('y1', '28'); browR.setAttribute('y2', '24');
          break;
        case 'thinking':
          browL.setAttribute('y1', '29'); browL.setAttribute('y2', '32');
          browR.setAttribute('y1', '32'); browR.setAttribute('y2', '29');
          break;
        default:
          browL.setAttribute('y1', '31'); browL.setAttribute('y2', '31');
          browR.setAttribute('y1', '31'); browR.setAttribute('y2', '31');
      }
    }
  }

  // ============================================================
  // Hands-Free Auto Engine Move Execution
  // ============================================================
  async _handleAutoEngineMove(guidance) {
    if (this._isAutoMoving) return;
    this._isAutoMoving = true;

    try {
      let fromSq = (guidance.from_square || '').toLowerCase();
      let toSq = (guidance.to_square || '').toLowerCase();

      if (!fromSq && guidance.instruction) {
        const m = guidance.instruction.match(/on\s+([a-h][1-8])/i);
        if (m) fromSq = m[1].toLowerCase();
      }

      if (!fromSq) return;

      const subEl = document.getElementById('phase-banner-sub');
      const stepInst = document.getElementById('guidance-instruction');

      // Stage 1: Blink source square in Yellow
      this.boardUI.clearMoveGuidance();
      this.boardUI.clearMoveArrow();
      this.virtualLEDs.clearAll();
      this.boardUI.highlightMoveGuidance(fromSq, null);
      this.virtualLEDs.indicateComputerMove(fromSq);
      if (subEl) subEl.textContent = `Pick up piece on ${fromSq.toUpperCase()} (Blinking Yellow LED)`;
      if (stepInst) stepInst.textContent = `Pick up piece on ${fromSq.toUpperCase()} (Blinking Yellow LED)`;

      // Visible pause so the user clearly sees the pick-up square blinking in yellow
      await new Promise(r => setTimeout(r, 900));

      if (guidance.step === 1 && guidance.total_steps === 2 && !toSq) {
        // Step 1 of capture or en-passant: remove victim piece
        const victim = this.boardUI.pieces[fromSq];
        if (victim) {
          delete this.boardUI.pieces[fromSq];
          this.sensorMatrix.setPhysicalPresence(fromSq, false);
          this.boardUI.renderPieces();
          this.boardUI.updateSensorIndicators();
          this.boardUI.updateCapturedPieces();
        }
        const diff = { lifted: [fromSq], placed: [], changedCount: 1 };
        await this.virtualESP32._transmitSensorEvent(diff, this.sensorMatrix.toBigInt());
      } else if (fromSq && toSq) {
        // Pick up the moving piece from source
        const movingPiece = this.boardUI.pieces[fromSq];
        if (movingPiece) {
          delete this.boardUI.pieces[fromSq];
          this.sensorMatrix.setPhysicalPresence(fromSq, false);
          this.boardUI.renderPieces();
          this.boardUI.updateSensorIndicators();
        }

        // Stage 2: Blink destination square in Green
        this.boardUI.clearMoveGuidance();
        this.boardUI.highlightMoveGuidance(null, toSq);
        this.virtualLEDs.indicatePiecePickedUp(fromSq, toSq);
        if (subEl) subEl.textContent = `Place piece on ${toSq.toUpperCase()} (Blinking Green LED)`;
        if (stepInst) stepInst.textContent = `Place piece on ${toSq.toUpperCase()} (Blinking Green LED)`;

        // Visible pause so the user clearly sees the destination square blinking in green
        await new Promise(r => setTimeout(r, 900));

        // Place piece onto destination
        if (movingPiece) {
          this.boardUI.pieces[toSq] = movingPiece;
          this.sensorMatrix.setPhysicalPresence(toSq, true);
          this.boardUI.renderPieces();
          this.boardUI.updateSensorIndicators();
          this.boardUI.updateCapturedPieces();
        }

        const diff = { lifted: [fromSq], placed: [toSq], changedCount: 2 };
        await this.virtualESP32._transmitSensorEvent(diff, this.sensorMatrix.toBigInt());
      }
    } catch (e) {
      console.warn('Auto move execution error:', e);
    } finally {
      this._isAutoMoving = false;
    }
  }

  // ============================================================
  // Restore Legal Board Position (One-Click Error & Capture Fix)
  // ============================================================
  async _restoreLegalBoard() {
    try {
      let targetFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      try {
        const state = await this.apiService.getGameState();
        if (state && state.fen) {
          targetFen = state.fen;
        }
      } catch (e) {
        console.warn('Could not fetch authoritative state, using local FEN:', e);
        if (this.apiService.mockBackend) {
          targetFen = this.apiService.mockBackend.generateFEN();
        }
      }

      this.boardUI.syncFromFEN(targetFen);

      // Re-align physical sensors with restored pieces
      const { SQUARES } = await import('./config.js');
      const { SensorMatrix } = await import('./modules/sensorMatrix.js');

      for (const sq of SQUARES) {
        const hasPiece = !!this.boardUI.pieces[sq];
        this.sensorMatrix.setPhysicalPresence(sq, hasPiece);
      }

      this.boardUI.updateSensorIndicators();
      this.virtualLEDs.clearAll();
      this.virtualESP32.clearLEDCommand();
      this._updateBitmapDisplay();

      // Transmit settled sensor state to backend so backend exits recovery mode!
      const currentBigInt = this.sensorMatrix.toBigInt();
      const prevStable = this.virtualESP32.lastStableBigInt || currentBigInt;
      const diff = SensorMatrix.computeDiff(prevStable, currentBigInt);
      this.virtualESP32.lastStableBigInt = currentBigInt;
      this.virtualESP32.lastCandidateBigInt = currentBigInt;
      await this.virtualESP32._transmitSensorEvent(diff, currentBigInt);

      const recBox = document.getElementById('recovery-box');
      if (recBox) recBox.style.display = 'none';

      const titleEl = document.getElementById('phase-banner-title');
      const subEl = document.getElementById('phase-banner-sub');
      if (titleEl) titleEl.textContent = 'BOARD RESTORED';
      if (subEl) subEl.textContent = 'Physical pieces and sensors restored to legal position.';
      this.setAIMood('neutral', 'Board synchronized to official game state.');
    } catch (e) {
      console.error('Failed to restore legal board:', e);
    }
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
      const moves = state?.move_history || state?.history;
      if (moves) {
        this._renderLiveMoveHistory(moves);
      }
    } catch (e) {
      console.warn('Could not refresh move history:', e);
    }
  }

  async _downloadPGN() {
    try {
      const pgnData = await this.apiService.getPGN();
      let pgn = pgnData?.pgn || '';

      if (!pgn || pgn.trim() === '' || pgn.trim() === '*') {
        if (this.apiService.mockBackend) {
          pgn = this.apiService.mockBackend.getPGN();
        }
      }

      if (!pgn || pgn.trim() === '') {
        const now = new Date();
        const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
        pgn = `[Event "CHĀTURANGA Game"]\n[Site "Physical Electronic Chessboard"]\n[Date "${dateStr}"]\n[Round "1"]\n[White "Human"]\n[Black "Computer"]\n[Result "*"]\n\n*`;
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
