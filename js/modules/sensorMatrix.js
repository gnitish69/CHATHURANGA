/**
 * SensorMatrix Module
 * Manages the 64 reed switch occupancy sensors.
 *
 * Sensor Polarity:
 *   1 = Reed switch closed (magnet present / square occupied)
 *   0 = Reed switch open (no magnet / square empty)
 *
 * Bit Mapping:
 *   Bit index = rankIndex * 8 + fileIndex (0 to 63)
 *   Bit 0 = a1 (LSB) ... Bit 7 = h1
 *   Bit 8 = a2         ... Bit 15 = h2
 *   ...
 *   Bit 56 = a8        ... Bit 63 = h8 (MSB)
 */

import { SQUARES, squareToIndex, indexToSquare } from '../config.js';

export class SensorMatrix {
  constructor() {
    // 64 sensor states: 0 = empty, 1 = occupied
    this.rawSensors = new Uint8Array(64);
    // Manual override flags when sensor debug mode is active
    this.debugOverrides = new Map(); // square -> 0 or 1
    this.debugMode = false;
    this.listeners = [];
  }

  /**
   * Initialize sensors based on a piece dictionary (or clear all)
   * @param {Object} piecesMap { 'e2': 'P', ... }
   */
  initFromPieces(piecesMap) {
    this.rawSensors.fill(0);
    this.debugOverrides.clear();
    for (const [sq, piece] of Object.entries(piecesMap)) {
      if (piece) {
        const idx = squareToIndex(sq);
        if (idx >= 0 && idx < 64) {
          this.rawSensors[idx] = 1;
        }
      }
    }
    this._notifyChange(null);
  }

  /**
   * Set sensor state for a square from piece presence
   * (ignored if debug override is active for this square)
   */
  setPhysicalPresence(sq, isPresent) {
    const idx = squareToIndex(sq);
    if (idx < 0 || idx >= 64) return;
    const oldVal = this.getSensorState(sq);
    this.rawSensors[idx] = isPresent ? 1 : 0;
    const newVal = this.getSensorState(sq);
    if (oldVal !== newVal) {
      this._notifyChange({ square: sq, index: idx, oldVal, newVal, source: 'physical' });
    }
  }

  /**
   * Enable/Disable Sensor Debug Mode
   */
  setDebugMode(enabled) {
    this.debugMode = !!enabled;
    if (!this.debugMode) {
      // Clear manual overrides when exiting debug mode
      this.debugOverrides.clear();
    }
    this._notifyChange(null);
  }

  /**
   * Toggle sensor state in debug mode
   */
  toggleDebugSensor(sq) {
    const idx = squareToIndex(sq);
    if (idx < 0 || idx >= 64) return;
    const current = this.getSensorState(sq);
    const toggled = current === 1 ? 0 : 1;
    this.debugOverrides.set(sq, toggled);
    this._notifyChange({ square: sq, index: idx, oldVal: current, newVal: toggled, source: 'debug_override' });
    return toggled;
  }

  /**
   * Explicitly set debug override
   */
  setDebugOverride(sq, val) {
    const idx = squareToIndex(sq);
    if (idx < 0 || idx >= 64) return;
    const current = this.getSensorState(sq);
    this.debugOverrides.set(sq, val ? 1 : 0);
    const newVal = this.getSensorState(sq);
    if (current !== newVal) {
      this._notifyChange({ square: sq, index: idx, oldVal: current, newVal, source: 'debug_override' });
    }
  }

  /**
   * Clear all debug overrides
   */
  clearDebugOverrides() {
    this.debugOverrides.clear();
    this._notifyChange(null);
  }

  /**
   * Get active state of sensor for square (0 or 1)
   */
  getSensorState(sq) {
    if (this.debugMode && this.debugOverrides.has(sq)) {
      return this.debugOverrides.get(sq);
    }
    const idx = squareToIndex(sq);
    if (idx < 0 || idx >= 64) return 0;
    return this.rawSensors[idx];
  }

  /**
   * Get state by 0..63 index
   */
  getSensorStateByIndex(idx) {
    const sq = indexToSquare(idx);
    return sq ? this.getSensorState(sq) : 0;
  }

  /**
   * Get total occupied sensors count
   */
  getOccupiedCount() {
    let count = 0;
    for (let i = 0; i < 64; i++) {
      if (this.getSensorStateByIndex(i) === 1) count++;
    }
    return count;
  }

  /**
   * Return 64-bit BigInt representing sensor bitmap
   * Bit 0 = a1, Bit 63 = h8
   */
  toBigInt() {
    let bitmap = 0n;
    for (let i = 0; i < 64; i++) {
      if (this.getSensorStateByIndex(i) === 1) {
        bitmap |= (1n << BigInt(i));
      }
    }
    return bitmap;
  }

  /**
   * Convert current sensors to 16-character Big-Endian Hex String (with 0x prefix)
   * Example starting position: 0xFFFF00000000FFFF
   */
  toHex() {
    const bi = this.toBigInt();
    return '0x' + bi.toString(16).toUpperCase().padStart(16, '0');
  }

  /**
   * Convert current sensors to 8-byte array (rank 1 to rank 8)
   */
  toBytes() {
    const bytes = new Uint8Array(8);
    for (let rank = 0; rank < 8; rank++) {
      let b = 0;
      for (let file = 0; file < 8; file++) {
        const idx = rank * 8 + file;
        if (this.getSensorStateByIndex(idx) === 1) {
          b |= (1 << file);
        }
      }
      bytes[rank] = b;
    }
    return bytes;
  }

  /**
   * Convert 8-byte array or hex string back into sensor array
   */
  loadFromBigInt(bigIntVal) {
    const bi = BigInt(bigIntVal);
    for (let i = 0; i < 64; i++) {
      const bit = Number((bi >> BigInt(i)) & 1n);
      this.rawSensors[i] = bit;
    }
    this.debugOverrides.clear();
    this._notifyChange(null);
  }

  loadFromHex(hexStr) {
    const cleanHex = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    const bi = BigInt('0x' + cleanHex);
    this.loadFromBigInt(bi);
  }

  /**
   * Compute difference between two 64-bit BigInt bitmaps
   * Returns: { lifted: ['e2'], placed: ['e4'], changedCount: 2 }
   */
  static computeDiff(prevBigInt, currentBigInt) {
    const prev = BigInt(prevBigInt);
    const curr = BigInt(currentBigInt);
    const diffMask = prev ^ curr;

    const lifted = [];
    const placed = [];

    for (let i = 0; i < 64; i++) {
      const bitMask = 1n << BigInt(i);
      if ((diffMask & bitMask) !== 0n) {
        const sq = indexToSquare(i);
        const wasOccupied = (prev & bitMask) !== 0n;
        const nowOccupied = (curr & bitMask) !== 0n;
        if (wasOccupied && !nowOccupied) {
          lifted.push(sq);
        } else if (!wasOccupied && nowOccupied) {
          placed.push(sq);
        }
      }
    }

    return {
      lifted,
      placed,
      changedCount: lifted.length + placed.length
    };
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  _notifyChange(detail) {
    for (const cb of this.listeners) {
      try {
        cb({
          detail,
          hex: this.toHex(),
          bigInt: this.toBigInt(),
          debugMode: this.debugMode
        });
      } catch (err) {
        console.error('SensorMatrix callback error:', err);
      }
    }
  }
}
