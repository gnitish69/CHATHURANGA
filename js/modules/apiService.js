/**
 * ApiService Module
 * Clean service layer abstracting communication with the backend.
 * Seamlessly switches between MOCK mode and real Python/Flask backend.
 * Provides simulated network failure, latency, and full HTTP traffic inspection.
 */

import { MockBackend } from './mockBackend.js';
import { HARDWARE_CONFIG } from '../config.js';

export class ApiService {
  constructor(options = {}) {
    this.mode = options.mode || 'MOCK'; // 'MOCK' or 'FLASK'
    this.baseUrl = options.baseUrl || HARDWARE_CONFIG.DEFAULT_BACKEND_URL;
    this.mockBackend = new MockBackend();
    this.simulateOffline = false;
    this.latencyMs = 60;
    this.inspectorListeners = [];
  }

  setMode(newMode) {
    this.mode = newMode === 'FLASK' ? 'FLASK' : 'MOCK';
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  setSimulateOffline(offline) {
    this.simulateOffline = !!offline;
  }

  setLatency(ms) {
    this.latencyMs = Math.max(0, ms);
  }

  onTraffic(callback) {
    this.inspectorListeners.push(callback);
  }

  _notifyTraffic(entry) {
    for (const cb of this.inspectorListeners) {
      try {
        cb(entry);
      } catch (err) {
        console.error('Inspector listener error:', err);
      }
    }
  }

  /**
   * Send hardware sensor scan event
   * @param {Object} scanPayload { timestamp, bitmap_hex, raw_bits, diff, debounced }
   */
  async sendHardwareScan(scanPayload) {
    const endpoint = '/api/v1/hardware/scan';
    const method = 'POST';
    const startTime = performance.now();

    const requestInfo = {
      timestamp: new Date().toISOString(),
      method,
      endpoint: `${this.baseUrl}${endpoint}`,
      mode: this.mode,
      headers: { 'Content-Type': 'application/json' },
      body: scanPayload
    };

    // 1. Simulate network disconnect if enabled
    if (this.simulateOffline) {
      await this._sleep(this.latencyMs);
      const errorEntry = {
        ...requestInfo,
        status: 0,
        statusText: 'CONNECTION_FAILED',
        durationMs: Math.round(performance.now() - startTime),
        error: 'Simulated Wi-Fi / Network Error (Host Unreachable)'
      };
      this._notifyTraffic(errorEntry);
      throw new Error(errorEntry.error);
    }

    // 2. MOCK Backend Execution
    if (this.mode === 'MOCK') {
      await this._sleep(this.latencyMs);
      try {
        const responseData = this.mockBackend.processScan(scanPayload);
        const durationMs = Math.round(performance.now() - startTime);

        this._notifyTraffic({
          ...requestInfo,
          status: 200,
          statusText: 'OK',
          durationMs,
          response: responseData
        });

        return responseData;
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime);
        this._notifyTraffic({
          ...requestInfo,
          status: 500,
          statusText: 'Internal Error',
          durationMs,
          error: err.message
        });
        throw err;
      }
    }

    // 3. Real Flask Backend Execution
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scanPayload)
      });
      const durationMs = Math.round(performance.now() - startTime);
      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        data = { status: response.ok ? 'accepted' : 'error' };
      }

      this._notifyTraffic({
        ...requestInfo,
        status: response.status,
        statusText: response.statusText,
        durationMs,
        response: data
      });

      // Valid chess responses (recovery, rejected, warning, intermediate, idle, accepted)
      if (data && (data.status || data.recovery || data.reason)) {
        return data;
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }
      return data;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      this._notifyTraffic({
        ...requestInfo,
        status: 0,
        statusText: 'FETCH_ERROR',
        durationMs,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Fetch authoritative game state
   */
  async getGameState() {
    const endpoint = '/api/v1/game/state';
    const method = 'GET';
    const startTime = performance.now();

    const requestInfo = {
      timestamp: new Date().toISOString(),
      method,
      endpoint: `${this.baseUrl}${endpoint}`,
      mode: this.mode,
      headers: { 'Accept': 'application/json' },
      body: null
    };

    if (this.simulateOffline) {
      await this._sleep(this.latencyMs);
      const errorEntry = {
        ...requestInfo,
        status: 0,
        statusText: 'OFFLINE',
        durationMs: Math.round(performance.now() - startTime),
        error: 'Network disconnected'
      };
      this._notifyTraffic(errorEntry);
      throw new Error(errorEntry.error);
    }

    if (this.mode === 'MOCK') {
      await this._sleep(this.latencyMs);
      const data = this.mockBackend.getGameState();
      this._notifyTraffic({
        ...requestInfo,
        status: 200,
        statusText: 'OK',
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`);
      const data = await res.json();
      this._notifyTraffic({
        ...requestInfo,
        status: res.status,
        statusText: res.statusText,
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    } catch (err) {
      this._notifyTraffic({
        ...requestInfo,
        status: 0,
        statusText: 'FETCH_ERROR',
        durationMs: Math.round(performance.now() - startTime),
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Reset game to starting configuration
   */
  async resetGame() {
    const endpoint = '/api/v1/game/reset';
    const method = 'POST';
    const startTime = performance.now();

    const requestInfo = {
      timestamp: new Date().toISOString(),
      method,
      endpoint: `${this.baseUrl}${endpoint}`,
      mode: this.mode,
      headers: { 'Content-Type': 'application/json' },
      body: {}
    };

    if (this.simulateOffline) {
      await this._sleep(this.latencyMs);
      throw new Error('Network disconnected');
    }

    if (this.mode === 'MOCK') {
      await this._sleep(this.latencyMs);
      this.mockBackend.reset();
      const data = this.mockBackend.getGameState();
      this._notifyTraffic({
        ...requestInfo,
        status: 200,
        statusText: 'OK',
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, { method: 'POST' });
      const data = await res.json();
      this._notifyTraffic({
        ...requestInfo,
        status: res.status,
        statusText: res.statusText,
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    } catch (err) {
      this._notifyTraffic({
        ...requestInfo,
        status: 0,
        statusText: 'FETCH_ERROR',
        durationMs: Math.round(performance.now() - startTime),
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Check Stockfish Engine Status
   */
  async getEngineStatus() {
    if (this.mode === 'MOCK') {
      return { status: 'mock', engine_name: 'Internal Rule Engine (Mock)', is_fake: true };
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/hardware/engine_status`);
      if (!res.ok) return { status: 'offline' };
      return await res.json();
    } catch (e) {
      return { status: 'offline', error: e.message };
    }
  }

  /**
   * Start New Game with Phase 3 configuration (mode, color, skill, move_time)
   */
  async startNewGame(options = {}) {
    const endpoint = '/api/v1/game/new';
    const method = 'POST';
    const startTime = performance.now();

    const requestInfo = {
      timestamp: new Date().toISOString(),
      method,
      endpoint: `${this.baseUrl}${endpoint}`,
      mode: this.mode,
      headers: { 'Content-Type': 'application/json' },
      body: options
    };

    if (this.mode === 'MOCK') {
      await this._sleep(this.latencyMs);
      this.mockBackend.reset();
      const data = {
        ...this.mockBackend.getGameState(),
        mode: options.mode || 'two_player',
        phase: 'WAITING_MOVE'
      };
      this._notifyTraffic({
        ...requestInfo,
        status: 200,
        statusText: 'OK',
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    }

    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      const data = await res.json();
      this._notifyTraffic({
        ...requestInfo,
        status: res.status,
        statusText: res.statusText,
        durationMs: Math.round(performance.now() - startTime),
        response: data
      });
      return data;
    } catch (err) {
      this._notifyTraffic({
        ...requestInfo,
        status: 0,
        statusText: 'FETCH_ERROR',
        durationMs: Math.round(performance.now() - startTime),
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Choose Promotion Piece (Q, R, B, N)
   */
  async choosePromotion(piece) {
    const endpoint = '/api/v1/game/promotion';
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece })
    });
    return await res.json();
  }

  /**
   * Resign active game
   */
  async resignGame() {
    const endpoint = '/api/v1/game/resign';
    const res = await fetch(`${this.baseUrl}${endpoint}`, { method: 'POST' });
    return await res.json();
  }

  /**
   * Claim Draw (threefold repetition / 50-move rule)
   */
  async claimDraw() {
    const endpoint = '/api/v1/game/claim_draw';
    const res = await fetch(`${this.baseUrl}${endpoint}`, { method: 'POST' });
    return await res.json();
  }

  /**
   * Get official PGN export
   */
  async getPGN() {
    if (this.mode === 'MOCK') {
      const pgn = this.mockBackend ? this.mockBackend.getPGN() : '';
      return { pgn, status: 'ok' };
    }

    const endpoint = '/api/v1/game/pgn';
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`);
      if (res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          return { pgn: json.pgn || text, status: 'ok' };
        } catch (e) {
          return { pgn: text, status: 'ok' };
        }
      }
    } catch (e) {
      console.warn('Backend PGN fetch failed, falling back to local history:', e);
    }

    // Fallback to internal generator if backend offline
    if (this.mockBackend) {
      return { pgn: this.mockBackend.getPGN(), status: 'fallback' };
    }
    return { pgn: '', status: 'empty' };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
