import test from 'node:test';
import assert from 'node:assert/strict';
import { SensorMatrix } from '../js/modules/sensorMatrix.js';
import { VirtualESP32, ESP_STATES } from '../js/modules/virtualESP32.js';
import { ApiService } from '../js/modules/apiService.js';
import { STARTING_PIECES } from '../js/config.js';

// Minimal mock peripherals for headless testing
class HeadlessLEDs {
  setLEDCommand() {}
  clearAll() {}
  flashIllegal() {}
}

class HeadlessOLED {
  update() {}
  showAlert() {}
}

test('VirtualESP32 debounces mechanical contact noise', async () => {
  const sensorMatrix = new SensorMatrix();
  sensorMatrix.initFromPieces(STARTING_PIECES);

  const apiService = new ApiService({ mode: 'MOCK' });
  apiService.setLatency(0); // Instant in unit test
  const leds = new HeadlessLEDs();
  const oled = new HeadlessOLED();

  const esp32 = new VirtualESP32(sensorMatrix, apiService, leds, oled);
  esp32.setDebounceCycles(3);
  esp32.init();
  esp32.stopScanLoop(); // Manual stepping for deterministic testing

  assert.equal(esp32.state, ESP_STATES.IDLE);
  assert.equal(esp32.lastCandidateBigInt, sensorMatrix.toBigInt());

  const recordedSensorEvents = [];
  esp32.onSensorEvent((e) => recordedSensorEvents.push(e));

  // 1. Simulate mechanical chatter: e2 sensor briefly flickers to 0 for 1 cycle
  sensorMatrix.setPhysicalPresence('e2', false);
  await esp32._scanTick(); // cycle 1 of candidate change

  assert.equal(esp32.candidateMatchCount, 1);
  assert.equal(esp32.state, ESP_STATES.DEBOUNCING);
  assert.equal(recordedSensorEvents.length, 0, 'No event should be dispatched after 1 cycle');

  // Chatter bounces back to 1 on next cycle
  sensorMatrix.setPhysicalPresence('e2', true);
  await esp32._scanTick(); // candidate reset to original
  assert.equal(esp32.candidateMatchCount, 1);
  assert.equal(recordedSensorEvents.length, 0, 'No event should be dispatched on bounce back');

  // 2. Real Piece Lift: e2 stays 0 for 3 consecutive cycles
  sensorMatrix.setPhysicalPresence('e2', false);

  await esp32._scanTick(); // Cycle 1
  assert.equal(esp32.candidateMatchCount, 1);
  assert.equal(recordedSensorEvents.length, 0);

  await esp32._scanTick(); // Cycle 2
  assert.equal(esp32.candidateMatchCount, 2);
  assert.equal(recordedSensorEvents.length, 0);

  await esp32._scanTick(); // Cycle 3 (Meets threshold!)
  assert.equal(esp32.candidateMatchCount, 3);
  assert.equal(recordedSensorEvents.length, 1, 'Stable event MUST be dispatched after 3 cycles');
  assert.equal(recordedSensorEvents[0].type, 'STABLE_CHANGE');
  assert.deepEqual(recordedSensorEvents[0].diff.lifted, ['e2']);
});
