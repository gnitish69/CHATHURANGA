/**
 * VirtualOLED Module
 * Emulates a 128x64 pixel monochrome SSD1306 I2C OLED display.
 * Renders directly to an HTML5 canvas with authentic pixel art / retro display aesthetics.
 */

export class VirtualOLED {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement ? canvasElement.getContext('2d') : null;
    this.width = 128;
    this.height = 64;

    this.state = {
      wifiStatus: 'CONNECTED', // 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'
      mode: 'MOCK',           // 'MOCK' | 'FLASK'
      turn: 'WHITE',          // 'WHITE' | 'BLACK'
      lastMove: 'READY',
      liftedSquare: null,
      message: 'READY TO PLAY',
      isError: false,
      scanState: 'IDLE',
      occupiedCount: 32,
      alertTimeout: null
    };

    if (this.canvas) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
    this.render();
  }

  setCanvas(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.render();
  }

  update(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }

  showAlert(message, durationMs = 2500) {
    if (this.state.alertTimeout) {
      clearTimeout(this.state.alertTimeout);
    }
    const previousMessage = this.state.message;
    const previousError = this.state.isError;

    this.state.message = message;
    this.state.isError = true;
    this.render();

    this.state.alertTimeout = setTimeout(() => {
      this.state.message = previousMessage;
      this.state.isError = previousError;
      this.state.alertTimeout = null;
      this.render();
    }, durationMs);
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { width, height } = this;

    // Background (OLED deep true black / faint phosphor grid)
    ctx.fillStyle = '#060b11';
    ctx.fillRect(0, 0, width, height);

    // Subtle phosphor scanlines
    ctx.fillStyle = 'rgba(0, 220, 255, 0.02)';
    for (let y = 0; y < height; y += 2) {
      ctx.fillRect(0, y, width, 1);
    }

    // Colors: Two-Tone SSD1306 (Yellow top bar, Cyan main display)
    const YELLOW = '#ffd21f';
    const CYAN = '#38e1ff';
    const RED = '#ff4343';
    const DIM = '#1e4854';

    // 1. Top Header Bar (0..12) - Yellow Section
    ctx.fillStyle = YELLOW;
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';

    // Title / Brand
    ctx.fillText('CHĀTURANGA', 2, 2);

    // Mode Tag [MOCK] or [FLASK]
    ctx.fillText(`[${this.state.mode}]`, 68, 2);

    // Wi-Fi Icon (Mini bar glyphs at top right)
    this._drawWifiIcon(ctx, 114, 2, this.state.wifiStatus, YELLOW, RED);

    // Divider Line
    ctx.fillStyle = YELLOW;
    ctx.fillRect(0, 12, width, 1);

    // 2. Middle Section (14..48) - Cyan Section
    ctx.fillStyle = CYAN;
    ctx.font = '8px monospace';

    // Turn & Game Status
    const turnText = `${this.state.turn} TO MOVE`;
    ctx.fillText(turnText, 2, 16);

    // Sensors count / ESP32 state
    ctx.font = '7px monospace';
    const liftedText = Array.isArray(this.state.liftedSquare)
      ? this.state.liftedSquare.join(', ').toUpperCase()
      : (typeof this.state.liftedSquare === 'string' ? this.state.liftedSquare.toUpperCase() : '');

    ctx.fillStyle = liftedText ? YELLOW : '#86e1e8';
    if (liftedText) {
      ctx.fillText(`LIFT: ${liftedText} (IN HAND)`, 2, 27);
    } else {
      ctx.fillText(`SENSORS: ${this.state.occupiedCount}/64 OCC`, 2, 27);
    }

    // Move Info
    ctx.fillStyle = CYAN;
    ctx.fillText(`LAST: ${this.state.lastMove}`, 2, 38);

    // ESP32 Sub-status
    ctx.fillStyle = DIM;
    ctx.fillText(`ESP32: ${this.state.scanState}`, 78, 38);

    // 3. Bottom Status / Alert Banner (49..63)
    const isErr = this.state.isError || this.state.wifiStatus === 'OFFLINE';
    if (isErr) {
      // Inverted red alert bar
      ctx.fillStyle = RED;
      ctx.fillRect(0, 50, width, 14);
      ctx.fillStyle = '#060b11';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(`! ${this.state.message.slice(0, 19)}`, 2, 53);
    } else {
      // Clean divider & message
      ctx.fillStyle = '#173642';
      ctx.fillRect(0, 50, width, 1);
      ctx.fillStyle = '#7de8f5';
      ctx.font = '7px monospace';
      ctx.fillText(this.state.message.slice(0, 22), 2, 54);
    }
  }

  _drawWifiIcon(ctx, x, y, status, normalColor, errColor) {
    if (status === 'OFFLINE') {
      ctx.fillStyle = errColor;
      ctx.fillText('!X', x, y);
      return;
    }
    if (status === 'RECONNECTING') {
      ctx.fillStyle = '#ffaa00';
      ctx.fillText('~?', x, y);
      return;
    }
    // 3 bars
    ctx.fillStyle = normalColor;
    ctx.fillRect(x + 6, y + 6, 2, 2);
    ctx.fillRect(x + 9, y + 4, 2, 4);
    ctx.fillRect(x + 12, y + 1, 2, 7);
  }
}
