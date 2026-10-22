/**
 * VirtualESP32 Module
 * Simulates physical microcontroller scanning firmware:
 * - High-speed periodic sensor matrix scanning (e.g. 100ms default)
 * - N-cycle debounce filter to eliminate mechanical reed switch contact chatter
 * - State machine: IDLE -> DEBOUNCING -> STABLE -> TRANSMITTING -> CONFIRMED / RETRY
 * - Hardware status LEDs: PWR, WIFI, TX, RX
 * - Wi-Fi connection simulation with exponential retry backoff
 * - Separated sensor logging vs game move processing
 */

import { HARDWARE_CONFIG } from '../config.js';
import { SensorMatrix } from './sensorMatrix.js';

export const ESP_STATES = {
  BOOT: 'BOOT',
  IDLE: 'IDLE',
  DEBOUNCING: 'DEBOUNCING',
  STABLE: 'STABLE',
  TRANSMITTING: 'TRANSMITTING',
  WAITING: 'WAITING',
  RETRY: 'RETRY',
  ERROR: 'ERROR'
};

export class VirtualESP32 {
  constructor(sensorMatrix, apiService, virtualLEDs, virtualOLED) {
    this.sensorMatrix = sensorMatrix;
    this.apiService = apiService;
    this.virtualLEDs = virtualLEDs;
    this.virtualOLED = virtualOLED;

    // Scan & Debounce config
    this.scanIntervalMs = HARDWARE_CONFIG.DEFAULT_SCAN_INTERVAL_MS;
    this.debounceThreshold = HARDWARE_CONFIG.DEFAULT_DEBOUNCE_CYCLES;
    this.maxRetries = HARDWARE_CONFIG.MAX_RETRY_ATTEMPTS;

    // State machine
    this.state = ESP_STATES.BOOT;
    this.wifiStatus = 'CONNECTED'; // 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'
    this.retryCount = 0;
    this.scanTimer = null;
    this.isRunning = false;

    // Debounce registers
    this.lastCandidateBigInt = null;
    this.candidateMatchCount = 0;
    this.lastStableBigInt = null;

    // Hardware LED simulation flags
    this.hwLeds = {
      pwr: true,
      wifi: true,
      tx: false,
      rx: false
    };

    // Callback listeners
    this.listeners = {
      sensorEvent: [],
      stateChange: [],
      hwLedChange: [],
      moveConfirmed: []
    };
  }

  init() {
    this.lastStableBigInt = this.sensorMatrix.toBigInt();
    this.lastCandidateBigInt = this.lastStableBigInt;
    this.candidateMatchCount = this.debounceThreshold;
    this.state = ESP_STATES.IDLE;
    this.wifiStatus = 'CONNECTED';
    this.hwLeds.wifi = true;
    this._notifyStateChange();
    this.startScanLoop();
  }

  setScanInterval(ms) {
    this.scanIntervalMs = Math.max(HARDWARE_CONFIG.MIN_SCAN_INTERVAL_MS, Math.min(HARDWARE_CONFIG.MAX_SCAN_INTERVAL_MS, ms));
    if (this.isRunning) {
      this.stopScanLoop();
      this.startScanLoop();
    }
  }

  setDebounceCycles(cycles) {
    this.debounceThreshold = Math.max(HARDWARE_CONFIG.MIN_DEBOUNCE_CYCLES, Math.min(HARDWARE_CONFIG.MAX_DEBOUNCE_CYCLES, cycles));
  }

  startScanLoop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.isRunning = true;
    this.scanTimer = setInterval(() => this._scanTick(), this.scanIntervalMs);
  }

  stopScanLoop() {
    this.isRunning = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  reset() {
    this.stopScanLoop();
    this.retryCount = 0;
    this.virtualLEDs.clearAll();
    this.lastStableBigInt = this.sensorMatrix.toBigInt();
    this.lastCandidateBigInt = this.lastStableBigInt;
    this.candidateMatchCount = this.debounceThreshold;
    this.state = ESP_STATES.IDLE;
    this.wifiStatus = 'CONNECTED';
    this.hwLeds.wifi = true;
    this.virtualOLED.update({
      wifiStatus: 'CONNECTED',
      message: 'SYSTEM RESET OK',
      lastMove: 'READY',
      liftedSquare: null,
      isError: false,
      scanState: 'IDLE',
      occupiedCount: this.sensorMatrix.getOccupiedCount()
    });
    this._notifyStateChange();
    this.startScanLoop();
  }

  /**
   * Main Microcontroller Scan Loop (firmware loop equivalent)
   */
  async _scanTick() {
    const currentBigInt = this.sensorMatrix.toBigInt();

    // Debounce Logic
    if (currentBigInt === this.lastCandidateBigInt) {
      this.candidateMatchCount++;
    } else {
      this.lastCandidateBigInt = currentBigInt;
      this.candidateMatchCount = 1;
      if (this.state === ESP_STATES.IDLE) {
        this.state = ESP_STATES.DEBOUNCING;
        this._notifyStateChange();
      }
    }

    // Has state stabilized for N consecutive cycles?
    if (this.candidateMatchCount >= this.debounceThreshold) {
      if (currentBigInt !== this.lastStableBigInt) {
        // Confirmed stable transition!
        const prevStable = this.lastStableBigInt;
        this.lastStableBigInt = currentBigInt;
        const diff = SensorMatrix.computeDiff(prevStable, currentBigInt);

        this.state = ESP_STATES.STABLE;
        this._notifyStateChange();

        // Log raw hardware event
        this._notifySensorEvent({
          timestamp: new Date().toISOString(),
          type: 'STABLE_CHANGE',
          diff,
          bitmapHex: this.sensorMatrix.toHex(),
          consecutiveCycles: this.candidateMatchCount
        });

        // Trigger payload transmission to backend
        await this._transmitSensorEvent(diff, currentBigInt);
      } else {
        if (this.state === ESP_STATES.DEBOUNCING) {
          this.state = ESP_STATES.IDLE;
          this._notifyStateChange();
        }
      }
    }
  }

  /**
   * Transmit settled hardware reading to backend via ApiService
   */
  async _transmitSensorEvent(diff, bitmapBigInt) {
    this.state = ESP_STATES.TRANSMITTING;
    this._flashTxLed();
    this._notifyStateChange();

    const payload = {
      timestamp: Date.now(),
      bitmap_hex: '0x' + bitmapBigInt.toString(16).toUpperCase().padStart(16, '0'),
      raw_bits: bitmapBigInt.toString(2).padStart(64, '0'),
      diff,
      debounced: true,
      debounce_cycles: this.debounceThreshold
    };

    try {
      const response = await this.apiService.sendHardwareScan(payload);
      this._flashRxLed();
      this.retryCount = 0;
      this.wifiStatus = 'CONNECTED';
      this.hwLeds.wifi = true;
      this.state = ESP_STATES.IDLE;

      this.virtualOLED.update({
        wifiStatus: 'CONNECTED',
        message: response.oled_message || response.status.toUpperCase(),
        occupiedCount: this.sensorMatrix.getOccupiedCount(),
        scanState: 'IDLE',
        liftedSquare: Array.isArray(response.lifted) ? response.lifted.join(', ') : (response.lifted || null),
        isError: response.status === 'rejected'
      });

      // Handle LED directives
      if (response.leds) {
        this.virtualLEDs.setLEDCommand({
          squares: response.leds,
          clearOthers: response.status === 'accepted'
        });
      }

      // If accepted move
      if (response.status === 'accepted') {
        this._notifyMoveConfirmed(response);
      } else if (response.status === 'rejected') {
        if (response.leds) {
          this.virtualLEDs.flashIllegal(Object.keys(response.leds));
        }
      }

      this._notifyStateChange();
    } catch (err) {
      // Transmission failed (network error or simulated lost connection)
      await this._handleNetworkFailure(diff, bitmapBigInt, err);
    }
  }

  async _handleNetworkFailure(diff, bitmapBigInt, err) {
    this.retryCount++;
    this._notifySensorEvent({
      timestamp: new Date().toISOString(),
      type: 'NET_ERROR',
      error: err.message,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries
    });

    if (this.retryCount <= this.maxRetries) {
      this.state = ESP_STATES.RETRY;
      this.wifiStatus = 'RECONNECTING';
      this.hwLeds.wifi = false;
      this.virtualOLED.update({
        wifiStatus: 'RECONNECTING',
        message: `NET RETRY ${this.retryCount}/${this.maxRetries}`,
        isError: true,
        scanState: 'RETRY'
      });
      this._notifyStateChange();

      // Backoff and retry
      setTimeout(async () => {
        if (this.isRunning) {
          await this._transmitSensorEvent(diff, bitmapBigInt);
        }
      }, HARDWARE_CONFIG.RETRY_BACKOFF_MS * this.retryCount);
    } else {
      // Max retries exceeded
      this.state = ESP_STATES.ERROR;
      this.wifiStatus = 'OFFLINE';
      this.hwLeds.wifi = false;
      this.virtualOLED.update({
        wifiStatus: 'OFFLINE',
        message: 'ERR: NET OFFLINE',
        isError: true,
        scanState: 'ERROR'
      });
      this._notifyStateChange();
    }
  }

  _flashTxLed() {
    this.hwLeds.tx = true;
    this._notifyHwLedChange();
    setTimeout(() => {
      this.hwLeds.tx = false;
      this._notifyHwLedChange();
    }, 120);
  }

  _flashRxLed() {
    this.hwLeds.rx = true;
    this._notifyHwLedChange();
    setTimeout(() => {
      this.hwLeds.rx = false;
      this._notifyHwLedChange();
    }, 120);
  }

  onSensorEvent(cb) { this.listeners.sensorEvent.push(cb); }
  onStateChange(cb) { this.listeners.stateChange.push(cb); }
  onHwLedChange(cb) { this.listeners.hwLedChange.push(cb); }
  onMoveConfirmed(cb) { this.listeners.moveConfirmed.push(cb); }

  _notifySensorEvent(evt) { for (const cb of this.listeners.sensorEvent) cb(evt); }
  _notifyStateChange() {
    for (const cb of this.listeners.stateChange) {
      cb({
        state: this.state,
        wifiStatus: this.wifiStatus,
        retryCount: this.retryCount,
        interval: this.scanIntervalMs,
        debounce: this.debounceThreshold
      });
    }
  }
  _notifyHwLedChange() { for (const cb of this.listeners.hwLedChange) cb(this.hwLeds); }
  _notifyMoveConfirmed(moveData) { for (const cb of this.listeners.moveConfirmed) cb(moveData); }
}
