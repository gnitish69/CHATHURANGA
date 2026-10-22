/**
 * EventLogger Module
 * Maintains strictly separated loggers for:
 * 1. Physical Sensor & ESP32 Hardware Events
 * 2. Official Accepted Chess Move History
 * 3. Network Request / Response Inspector (REST traffic)
 * 4. Authoritative FEN Chronological History
 */

export class EventLogger {
  constructor(containers) {
    this.containers = containers || {};
    this.sensorLogs = [];
    this.moveLogs = [];
    this.networkLogs = [];
    this.fenHistory = [];

    this.maxEntries = 200;
  }

  setContainers(containers) {
    this.containers = containers;
  }

  /**
   * Log raw hardware sensor / microcontroller event
   */
  logSensorEvent(evt) {
    const entry = {
      id: 'sens_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      time: new Date().toLocaleTimeString(),
      ...evt
    };
    this.sensorLogs.unshift(entry);
    if (this.sensorLogs.length > this.maxEntries) this.sensorLogs.pop();
    this._renderSensorLogs();
  }

  /**
   * Log confirmed official chess move
   */
  logMoveEvent(move) {
    const entry = {
      id: 'move_' + Date.now(),
      time: new Date().toLocaleTimeString(),
      ...move
    };
    this.moveLogs.unshift(entry);
    if (this.moveLogs.length > this.maxEntries) this.moveLogs.pop();
    this._renderMoveLogs();

    // Also track FEN
    if (move.fen) {
      this.logFEN(move.fen, move.move_san || move.uci || 'Initial');
    }
  }

  /**
   * Log network inspector transaction
   */
  logNetworkEvent(traffic) {
    const entry = {
      id: 'net_' + Date.now(),
      time: new Date().toLocaleTimeString(),
      ...traffic
    };
    this.networkLogs.unshift(entry);
    if (this.networkLogs.length > this.maxEntries) this.networkLogs.pop();
    this._renderNetworkLogs();
  }

  /**
   * Track authoritative FEN string
   */
  logFEN(fen, sourceLabel = '') {
    const entry = {
      id: 'fen_' + Date.now(),
      time: new Date().toLocaleTimeString(),
      fen,
      label: sourceLabel
    };
    // Don't duplicate last FEN if identical
    if (this.fenHistory.length === 0 || this.fenHistory[0].fen !== fen) {
      this.fenHistory.unshift(entry);
      if (this.fenHistory.length > this.maxEntries) this.fenHistory.pop();
      this._renderFENHistory();
    }
  }

  clearSensorLogs() {
    this.sensorLogs = [];
    this._renderSensorLogs();
  }

  clearMoveLogs() {
    this.moveLogs = [];
    this._renderMoveLogs();
  }

  clearNetworkLogs() {
    this.networkLogs = [];
    this._renderNetworkLogs();
  }

  clearFENHistory() {
    this.fenHistory = [];
    this._renderFENHistory();
  }

  clearAll() {
    this.clearSensorLogs();
    this.clearMoveLogs();
    this.clearNetworkLogs();
    this.clearFENHistory();
  }

  _renderSensorLogs() {
    const el = this.containers.sensorLog;
    if (!el) return;
    if (this.sensorLogs.length === 0) {
      el.innerHTML = '<div class="log-empty">No sensor events recorded yet.</div>';
      return;
    }

    el.innerHTML = this.sensorLogs.map(item => {
      let badgeClass = 'badge-info';
      let title = item.type || 'EVENT';
      let details = '';

      if (item.type === 'STABLE_CHANGE') {
        badgeClass = 'badge-success';
        const liftedStr = item.diff.lifted.length ? `Lift: [${item.diff.lifted.join(', ')}]` : '';
        const placedStr = item.diff.placed.length ? `Place: [${item.diff.placed.join(', ')}]` : '';
        details = `<span class="log-diff">${liftedStr} ${placedStr}</span> <span class="log-bitmap">HEX: ${item.bitmapHex}</span>`;
      } else if (item.type === 'NET_ERROR') {
        badgeClass = 'badge-error';
        details = `<span class="log-error">${item.error} (Retry ${item.retryCount}/${item.maxRetries})</span>`;
      } else if (item.detail && item.detail.source === 'debug_override') {
        badgeClass = 'badge-warning';
        title = 'DEBUG_OVERRIDE';
        details = `Square ${item.detail.square} toggled: ${item.detail.oldVal} &rarr; ${item.detail.newVal}`;
      } else {
        details = JSON.stringify(item.detail || item);
      }

      return `
        <div class="log-entry">
          <span class="log-time">${item.time}</span>
          <span class="log-badge ${badgeClass}">${title}</span>
          <div class="log-body">${details}</div>
        </div>
      `;
    }).join('');
  }

  _renderMoveLogs() {
    const el = this.containers.moveLog;
    if (!el) return;
    if (this.moveLogs.length === 0) {
      el.innerHTML = '<div class="log-empty">No accepted moves yet. Drag a piece to begin.</div>';
      return;
    }

    el.innerHTML = this.moveLogs.map((item, idx) => {
      const isWhite = item.turn === 'white';
      return `
        <div class="move-entry ${isWhite ? 'move-white' : 'move-black'}">
          <div class="move-header">
            <span class="move-time">${item.time}</span>
            <span class="move-san">${item.move_san || item.uci}</span>
            <span class="move-turn">${isWhite ? 'White' : 'Black'}</span>
          </div>
          <div class="move-uci">UCI: <code>${item.move_uci || item.uci || ''}</code></div>
          ${item.is_check ? '<span class="move-check-flag">CHECK</span>' : ''}
          ${item.is_game_over ? '<span class="move-mate-flag">GAME OVER</span>' : ''}
        </div>
      `;
    }).join('');
  }

  _renderNetworkLogs() {
    const el = this.containers.networkLog;
    if (!el) return;
    if (this.networkLogs.length === 0) {
      el.innerHTML = '<div class="log-empty">No REST network calls recorded.</div>';
      return;
    }

    el.innerHTML = this.networkLogs.map(item => {
      const isOk = item.status >= 200 && item.status < 300;
      const statusClass = isOk ? 'status-ok' : 'status-err';
      const bodySnippet = item.body ? JSON.stringify(item.body) : '';
      const respSnippet = item.response ? JSON.stringify(item.response) : (item.error || '');

      return `
        <div class="network-entry ${statusClass}">
          <div class="net-row-top">
            <span class="net-method ${item.method}">${item.method}</span>
            <span class="net-endpoint" title="${item.endpoint}">${item.endpoint}</span>
            <span class="net-status ${statusClass}">${item.status || 0} ${item.statusText || 'ERR'}</span>
            <span class="net-duration">${item.durationMs || 0}ms</span>
          </div>
          <div class="net-details">
            <div class="net-box">
              <span class="net-label">Payload:</span>
              <pre class="net-pre">${bodySnippet}</pre>
            </div>
            <div class="net-box">
              <span class="net-label">Response:</span>
              <pre class="net-pre ${!isOk ? 'err-text' : ''}">${respSnippet}</pre>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  _renderFENHistory() {
    const el = this.containers.fenHistory;
    if (!el) return;
    if (this.fenHistory.length === 0) {
      el.innerHTML = '<div class="log-empty">No FEN history recorded.</div>';
      return;
    }

    el.innerHTML = this.fenHistory.map((item, idx) => {
      return `
        <div class="fen-entry">
          <div class="fen-header">
            <span class="fen-time">${item.time}</span>
            <span class="fen-label">${item.label ? `[${item.label}]` : `State #${this.fenHistory.length - idx}`}</span>
            <button class="btn-copy-fen" data-fen="${item.fen.replace(/"/g, '&quot;')}" title="Copy FEN to clipboard">Copy</button>
          </div>
          <div class="fen-string"><code>${item.fen}</code></div>
        </div>
      `;
    }).join('');

    // Attach copy button listeners
    el.querySelectorAll('.btn-copy-fen').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const fen = e.target.dataset.fen;
        navigator.clipboard.writeText(fen).then(() => {
          const original = e.target.textContent;
          e.target.textContent = 'Copied!';
          setTimeout(() => e.target.textContent = original, 1200);
        }).catch(() => {});
      });
    });
  }
}
