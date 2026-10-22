/**
 * VirtualLEDs Module
 * Controls the simulated LED indicators for each of the 64 squares on the chessboard.
 * Matches physical chessboard LED hardware (corner LEDs or square underglow).
 */

import { SQUARES } from '../config.js';

export const LED_COLORS = {
  GREEN: 'led-green',
  RED: 'led-red',
  BLUE: 'led-blue',
  CYAN: 'led-cyan',
  YELLOW: 'led-yellow',
  WHITE: 'led-white',
  MAGENTA: 'led-magenta',
  ORANGE: 'led-orange'
};

export const LED_MODES = {
  SOLID: 'led-solid',
  PULSE: 'led-pulse',
  FLASH: 'led-flash'
};

export class VirtualLEDs {
  constructor(boardContainer) {
    this.boardContainer = boardContainer;
    // Map of square -> { color: 'GREEN', mode: 'SOLID' }
    this.activeLEDs = new Map();
    this.flashTimeout = null;
  }

  /**
   * Set specific LED configurations
   * @param {Object} command { squares: { e2: 'GREEN' | { color: 'GREEN', mode: 'PULSE' } }, clearOthers: boolean }
   */
  setLEDCommand(command) {
    if (command.clearOthers) {
      this.clearAll();
    }

    if (command.squares) {
      for (const [sq, config] of Object.entries(command.squares)) {
        if (!config) {
          this.clearSquare(sq);
          continue;
        }
        let color = 'GREEN';
        let mode = 'SOLID';

        if (typeof config === 'string') {
          color = config.toUpperCase();
        } else if (typeof config === 'object') {
          color = (config.color || 'GREEN').toUpperCase();
          mode = (config.mode || 'SOLID').toUpperCase();
        }

        this.setSquareLED(sq, color, mode);
      }
    }
  }

  /**
   * Set LED for an individual square
   */
  setSquareLED(sq, colorName = 'GREEN', modeName = 'SOLID') {
    const validColor = LED_COLORS[colorName] || LED_COLORS.GREEN;
    const validMode = LED_MODES[modeName] || LED_MODES.SOLID;

    this.activeLEDs.set(sq, { colorName, modeName, validColor, validMode });
    this._renderSquare(sq);
  }

  /**
   * Clear LED on single square
   */
  clearSquare(sq) {
    this.activeLEDs.delete(sq);
    this._renderSquare(sq);
  }

  /**
   * Clear all 64 LEDs
   */
  clearAll() {
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    const affected = Array.from(this.activeLEDs.keys());
    this.activeLEDs.clear();
    for (const sq of affected) {
      this._renderSquare(sq);
    }
  }

  /**
   * Flash error / illegal move on specific squares (temporary red flash)
   */
  flashIllegal(squares, durationMs = 1800) {
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    for (const sq of squares) {
      this.setSquareLED(sq, 'RED', 'FLASH');
    }
    this.flashTimeout = setTimeout(() => {
      for (const sq of squares) {
        this.clearSquare(sq);
      }
      this.flashTimeout = null;
    }, durationMs);
  }

  /**
   * Highlight a completed or suggested move
   */
  highlightMove(fromSq, toSq) {
    this.clearAll();
    if (fromSq) this.setSquareLED(fromSq, 'YELLOW', 'SOLID');
    if (toSq) this.setSquareLED(toSq, 'GREEN', 'SOLID');
  }

  /**
   * Render LED visual state in DOM for a square
   */
  _renderSquare(sq) {
    if (!this.boardContainer) return;
    const squareEl = this.boardContainer.querySelector(`[data-square="${sq}"]`);
    if (!squareEl) return;

    let ledLayer = squareEl.querySelector('.square-led-layer');
    if (!ledLayer) {
      ledLayer = document.createElement('div');
      ledLayer.className = 'square-led-layer';
      ledLayer.innerHTML = `
        <span class="led-corner led-tl"></span>
        <span class="led-corner led-tr"></span>
        <span class="led-corner led-bl"></span>
        <span class="led-corner led-br"></span>
        <div class="led-underglow"></div>
      `;
      squareEl.appendChild(ledLayer);
    }

    // Reset LED classes
    ledLayer.className = 'square-led-layer';

    const state = this.activeLEDs.get(sq);
    if (state) {
      ledLayer.classList.add('active', state.validColor, state.validMode);
    }
  }

  /**
   * Refresh all square DOM elements
   */
  refreshDOM(container) {
    if (container) this.boardContainer = container;
    for (const sq of SQUARES) {
      this._renderSquare(sq);
    }
  }

  /**
   * Get active state dump for debugging
   */
  getState() {
    const res = {};
    for (const [k, v] of this.activeLEDs.entries()) {
      res[k] = { color: v.colorName, mode: v.modeName };
    }
    return res;
  }
}
