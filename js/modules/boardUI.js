/**
 * BoardUI Module
 * Renders and handles user interaction for the 8x8 physical chessboard:
 * - SVG vector piece rendering
 * - Fluid Drag-and-Drop and Click-to-Move
 * - Updates physical sensor states in SensorMatrix upon lift and drop
 * - Provides interactive sensor overlay and debug-click mode
 * - Integrates corner LEDs and coordinate markers
 */

import { FILES, RANKS, SQUARES, STARTING_PIECES } from '../config.js';
import { PIECE_SVGS } from '../../assets/pieces.js';

export class BoardUI {
  constructor(containerElement, sensorMatrix, virtualLEDs) {
    this.container = containerElement;
    this.sensorMatrix = sensorMatrix;
    this.virtualLEDs = virtualLEDs;

    // Board pieces state { 'e2': 'P', ... }
    this.pieces = { ...STARTING_PIECES };

    // Interaction state
    this.draggedSquare = null;
    this.draggedPiece = null;
    this.selectedSquare = null;
    this.isDragging = false;
    this.showSensorsOverlay = true;

    this.onPieceLiftCallback = null;
    this.onPieceDropCallback = null;
    this.onSquareClickCallback = null;

    // Captured pieces
    this.capturedWhite = [];
    this.capturedBlack = [];
    this.whiteTrayEl = null;
    this.blackTrayEl = null;
    this.draggedTrayPiece = null;
  }

  init() {
    this.render();
    this.sensorMatrix.initFromPieces(this.pieces);
    this.virtualLEDs.refreshDOM(this.container);
  }

  reset() {
    this.pieces = { ...STARTING_PIECES };
    this.draggedSquare = null;
    this.draggedPiece = null;
    this.selectedSquare = null;
    this.isDragging = false;
    this.render();
    this.sensorMatrix.initFromPieces(this.pieces);
    this.virtualLEDs.clearAll();
  }

  setShowSensorsOverlay(show) {
    this.showSensorsOverlay = !!show;
    this.container.classList.toggle('show-sensor-overlay', this.showSensorsOverlay);
    this.updateSensorIndicators();
  }

  /**
   * Render the complete 8x8 chessboard
   */
  render() {
    this.container.innerHTML = '';
    this.container.className = 'chessboard-grid';
    if (this.showSensorsOverlay) {
      this.container.classList.add('show-sensor-overlay');
    }

    // Build squares Rank 8 down to 1, File a to h (standard White view)
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const file = FILES[f];
        const rank = RANKS[r];
        const sq = `${file}${rank}`;
        const isLight = (f + r) % 2 !== 0;

        const squareEl = document.createElement('div');
        squareEl.className = `board-square ${isLight ? 'light' : 'dark'}`;
        squareEl.dataset.square = sq;
        squareEl.dataset.file = file;
        squareEl.dataset.rank = rank;

        // 1. Coordinate labels
        if (f === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'square-coord coord-rank';
          rankLabel.textContent = rank;
          squareEl.appendChild(rankLabel);
        }
        if (r === 0) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'square-coord coord-file';
          fileLabel.textContent = file;
          squareEl.appendChild(fileLabel);
        }

        // 2. Sensor state indicator badge
        const sensorBadge = document.createElement('div');
        sensorBadge.className = 'sensor-badge';
        sensorBadge.title = `Square ${sq} reed switch`;
        squareEl.appendChild(sensorBadge);

        // 3. Piece Container
        const pieceContainer = document.createElement('div');
        pieceContainer.className = 'piece-slot';
        squareEl.appendChild(pieceContainer);

        // 4. Square LED layer
        const ledLayer = document.createElement('div');
        ledLayer.className = 'square-led-layer';
        ledLayer.innerHTML = `
          <span class="led-corner led-tl"></span>
          <span class="led-corner led-tr"></span>
          <span class="led-corner led-bl"></span>
          <span class="led-corner led-br"></span>
          <div class="led-underglow"></div>
        `;
        squareEl.appendChild(ledLayer);

        // Drag & Drop & Click event listeners
        this._bindSquareEvents(squareEl, sq);

        this.container.appendChild(squareEl);
      }
    }

    this.renderPieces();
    this.updateSensorIndicators();
  }

  /**
   * Render pieces based on this.pieces map
   */
  renderPieces() {
    for (const sq of SQUARES) {
      const squareEl = this.container.querySelector(`[data-square="${sq}"]`);
      if (!squareEl) continue;
      const slot = squareEl.querySelector('.piece-slot');
      if (!slot) continue;

      slot.innerHTML = '';
      const piece = this.pieces[sq];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece-element';
        pieceEl.draggable = true;
        pieceEl.dataset.square = sq;
        pieceEl.dataset.piece = piece;
        pieceEl.innerHTML = PIECE_SVGS[piece] || piece;

        this._bindPieceEvents(pieceEl, sq, piece);
        slot.appendChild(pieceEl);
      }
    }
  }

  /**
   * Update visual sensor status badges (Green = Closed/Occupied, Grey = Open/Empty)
   */
  updateSensorIndicators() {
    for (const sq of SQUARES) {
      const squareEl = this.container.querySelector(`[data-square="${sq}"]`);
      if (!squareEl) continue;
      const badge = squareEl.querySelector('.sensor-badge');
      if (!badge) continue;

      const isOccupied = this.sensorMatrix.getSensorState(sq) === 1;
      badge.classList.toggle('occupied', isOccupied);
      badge.classList.toggle('empty', !isOccupied);
      badge.textContent = isOccupied ? '1' : '0';
    }
  }

  _bindSquareEvents(squareEl, sq) {
    // Click handling (Debug sensor toggle or click-to-move)
    squareEl.addEventListener('click', (e) => {
      if (this.sensorMatrix.debugMode) {
        // In debug mode: clicking a square toggles the underlying reed switch
        e.stopPropagation();
        this.sensorMatrix.toggleDebugSensor(sq);
        this.updateSensorIndicators();
        if (this.onSquareClickCallback) {
          this.onSquareClickCallback({ square: sq, mode: 'debug_toggle' });
        }
        return;
      }

      // Normal Mode: Click to move
      this._handleClickToMove(sq);
    });

    // Drag over & Drop
    squareEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      squareEl.classList.add('drag-over');
    });

    squareEl.addEventListener('dragleave', () => {
      squareEl.classList.remove('drag-over');
    });

    squareEl.addEventListener('drop', (e) => {
      e.preventDefault();
      squareEl.classList.remove('drag-over');
      const fromSq = e.dataTransfer.getData('text/plain') || this.draggedSquare;
      if (!fromSq) return;

      const fromPiece = this.pieces[fromSq];
      const targetPiece = this.pieces[sq];

      // If dropped on another friendly piece of the SAME color, abort and restore origin piece!
      if (fromPiece && targetPiece && fromSq !== sq) {
        const isFromWhite = fromPiece === fromPiece.toUpperCase();
        const isTargetWhite = targetPiece === targetPiece.toUpperCase();
        if (isFromWhite === isTargetWhite) {
          this.sensorMatrix.setPhysicalPresence(fromSq, true);
          this.updateSensorIndicators();
          this.virtualLEDs.clearAll();
          this.renderPieces();
          this.draggedSquare = null;
          this.draggedPiece = null;
          return;
        }
      }

      this._handleDropPiece(fromSq, sq);
    });
  }

  _bindPieceEvents(pieceEl, sq, piece) {
    pieceEl.addEventListener('dragstart', (e) => {
      if (this.sensorMatrix.debugMode) {
        // Prevent accidental piece dragging while in sensor debug mode
        e.preventDefault();
        return;
      }

      this.isDragging = true;
      this.draggedSquare = sq;
      this.draggedPiece = piece;
      e.dataTransfer.setData('text/plain', sq);
      e.dataTransfer.effectAllowed = 'move';
      pieceEl.classList.add('dragging');

      // Physical reed switch detects piece lift immediately!
      this.sensorMatrix.setPhysicalPresence(sq, false);
      this.updateSensorIndicators();

      if (this.onPieceLiftCallback) {
        this.onPieceLiftCallback(sq, piece);
      }
    });

    pieceEl.addEventListener('dragend', () => {
      this.isDragging = false;
      pieceEl.classList.remove('dragging');

      // If dragged piece was not dropped on a square (dropped outside board),
      // restore physical sensor presence back to origin square
      if (this.draggedSquare && this.pieces[this.draggedSquare]) {
        this.sensorMatrix.setPhysicalPresence(this.draggedSquare, true);
        this.updateSensorIndicators();
        this.virtualLEDs.clearAll();
        this.renderPieces();
      }
      this.draggedSquare = null;
      this.draggedPiece = null;
    });
  }

  _handleClickToMove(sq) {
    // If no piece is currently selected
    if (!this.selectedSquare) {
      if (this.pieces[sq]) {
        this.selectedSquare = sq;
        this._highlightSelected(sq);
        // Sensor detects piece lifted from square
        this.sensorMatrix.setPhysicalPresence(sq, false);
        this.updateSensorIndicators();
        if (this.onPieceLiftCallback) {
          this.onPieceLiftCallback(sq, this.pieces[sq]);
        }
      }
      return;
    }

    const fromSq = this.selectedSquare;

    // Case A: Clicked on same square -> Cancel lift and put piece back!
    if (fromSq === sq) {
      this.selectedSquare = null;
      this._clearSelected();
      this.sensorMatrix.setPhysicalPresence(sq, true);
      this.updateSensorIndicators();
      this.virtualLEDs.clearAll();
      return;
    }

    // Case B: Clicked on another piece of the same color!
    // The player changed their mind and wants to pick up a different piece!
    const fromPiece = this.pieces[fromSq];
    const targetPiece = this.pieces[sq];
    if (fromPiece && targetPiece) {
      const isFromWhite = fromPiece === fromPiece.toUpperCase();
      const isTargetWhite = targetPiece === targetPiece.toUpperCase();
      if (isFromWhite === isTargetWhite) {
        // Put previous piece back!
        this.sensorMatrix.setPhysicalPresence(fromSq, true);
        // Select and lift the new piece!
        this.selectedSquare = sq;
        this._highlightSelected(sq);
        this.sensorMatrix.setPhysicalPresence(sq, false);
        this.updateSensorIndicators();
        this.virtualLEDs.clearAll();
        if (this.onPieceLiftCallback) {
          this.onPieceLiftCallback(sq, targetPiece);
        }
        return;
      }
    }

    // Case C: Placed on destination square (move or capture)
    this.selectedSquare = null;
    this._clearSelected();
    this._handleDropPiece(fromSq, sq);
  }

  _handleDropPiece(fromSq, toSq) {
    let piece = null;

    if (this.draggedTrayPiece) {
      // Piece placed from captured pieces tray onto board
      piece = this.draggedTrayPiece;
      const isWhite = piece === piece.toUpperCase();
      const trayList = isWhite ? this.capturedWhite : this.capturedBlack;
      const idx = trayList.indexOf(piece);
      if (idx !== -1) trayList.splice(idx, 1);
      this.draggedTrayPiece = null;
      this.renderCapturedTrays();
    } else {
      piece = this.pieces[fromSq];
      if (!piece) return;

      if (fromSq === toSq) {
        // Placed back on same square
        this.sensorMatrix.setPhysicalPresence(fromSq, true);
        this.updateSensorIndicators();
        this.virtualLEDs.clearAll();
        this.renderPieces();
        return;
      }

      delete this.pieces[fromSq];
      this.sensorMatrix.setPhysicalPresence(fromSq, false);
    }

    // If destination square had an enemy piece, send captured piece to tray
    const existingTargetPiece = this.pieces[toSq];
    if (existingTargetPiece) {
      this.addCapturedPiece(existingTargetPiece);
    }

    this.pieces[toSq] = piece;
    this.sensorMatrix.setPhysicalPresence(toSq, true);

    this.renderPieces();
    this.updateSensorIndicators();

    if (this.onPieceDropCallback) {
      this.onPieceDropCallback(fromSq, toSq, piece);
    }
  }

  bindCapturedTrays(whiteTrayEl, blackTrayEl) {
    this.whiteTrayEl = whiteTrayEl;
    this.blackTrayEl = blackTrayEl;
    this._initTrayDropListeners(this.whiteTrayEl, 'w');
    this._initTrayDropListeners(this.blackTrayEl, 'b');
    this.renderCapturedTrays();
  }

  _initTrayDropListeners(trayEl, color) {
    if (!trayEl) return;
    trayEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      trayEl.classList.add('drag-over');
    });

    trayEl.addEventListener('dragleave', () => {
      trayEl.classList.remove('drag-over');
    });

    trayEl.addEventListener('drop', (e) => {
      e.preventDefault();
      trayEl.classList.remove('drag-over');
      const fromSq = e.dataTransfer.getData('text/plain') || this.draggedSquare;
      if (fromSq && this.pieces[fromSq]) {
        const piece = this.pieces[fromSq];
        delete this.pieces[fromSq];
        this.sensorMatrix.setPhysicalPresence(fromSq, false);
        this.addCapturedPiece(piece);
        this.renderPieces();
        this.updateSensorIndicators();
        this.draggedSquare = null;
        this.draggedPiece = null;
      }
    });
  }

  addCapturedPiece(piece) {
    const isWhite = piece === piece.toUpperCase();
    if (isWhite) {
      this.capturedWhite.push(piece);
    } else {
      this.capturedBlack.push(piece);
    }
    this.renderCapturedTrays();
  }

  renderCapturedTrays() {
    if (this.whiteTrayEl) {
      const listEl = this.whiteTrayEl.querySelector('.captured-pieces-list') || this.whiteTrayEl;
      listEl.innerHTML = '';
      this.capturedWhite.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'captured-piece-item';
        item.draggable = true;
        item.innerHTML = PIECE_SVGS[p] || p;
        item.title = `White ${p} (drag onto board to restore)`;
        item.addEventListener('dragstart', (e) => {
          this.draggedTrayPiece = p;
          e.dataTransfer.setData('text/plain', `tray_w_${idx}`);
          e.dataTransfer.effectAllowed = 'move';
        });
        listEl.appendChild(item);
      });
    }

    if (this.blackTrayEl) {
      const listEl = this.blackTrayEl.querySelector('.captured-pieces-list') || this.blackTrayEl;
      listEl.innerHTML = '';
      this.capturedBlack.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'captured-piece-item';
        item.draggable = true;
        item.innerHTML = PIECE_SVGS[p] || p;
        item.title = `Black ${p} (drag onto board to restore)`;
        item.addEventListener('dragstart', (e) => {
          this.draggedTrayPiece = p;
          e.dataTransfer.setData('text/plain', `tray_b_${idx}`);
          e.dataTransfer.effectAllowed = 'move';
        });
        listEl.appendChild(item);
      });
    }
  }

  _highlightSelected(sq) {
    this._clearSelected();
    const squareEl = this.container.querySelector(`[data-square="${sq}"]`);
    if (squareEl) squareEl.classList.add('selected-piece');
  }

  _clearSelected() {
    const selected = this.container.querySelectorAll('.selected-piece');
    for (const el of selected) el.classList.remove('selected-piece');
  }

  /**
   * Sync visual board piece state with backend authoritative piece positions
   */
  syncPieces(piecesMap) {
    this.pieces = { ...piecesMap };
    this.renderPieces();
    this.sensorMatrix.initFromPieces(this.pieces);
    this.updateSensorIndicators();
  }

  onPieceLift(cb) { this.onPieceLiftCallback = cb; }
  onPieceDrop(cb) { this.onPieceDropCallback = cb; }
  onSquareClick(cb) { this.onSquareClickCallback = cb; }
}
