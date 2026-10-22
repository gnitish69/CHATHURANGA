import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiService } from '../js/modules/apiService.js';

test('ApiService operates in MOCK mode with traffic inspection', async () => {
  const api = new ApiService({ mode: 'MOCK' });
  api.setLatency(0);

  const traffic = [];
  api.onTraffic(entry => traffic.push(entry));

  // 1. Fetch Game State
  const gameState = await api.getGameState();
  assert.equal(gameState.turn, 'white');
  assert.equal(gameState.isCheck, false);

  assert.equal(traffic.length, 1);
  assert.equal(traffic[0].status, 200);
  assert.equal(traffic[0].method, 'GET');

  // 2. Send scan payload
  const scanResult = await api.sendHardwareScan({
    timestamp: Date.now(),
    bitmap_hex: '0xFFFF00000000FFFF',
    diff: { lifted: ['e2'], placed: ['e4'] },
    debounced: true
  });

  assert.equal(scanResult.status, 'accepted');
  assert.equal(scanResult.move_uci, 'e2e4');

  assert.equal(traffic.length, 2);
  assert.equal(traffic[1].status, 200);
  assert.equal(traffic[1].method, 'POST');
});

test('ApiService simulates lost connection and network failures', async () => {
  const api = new ApiService({ mode: 'MOCK' });
  api.setLatency(0);
  api.setSimulateOffline(true);

  const traffic = [];
  api.onTraffic(entry => traffic.push(entry));

  await assert.rejects(
    async () => {
      await api.sendHardwareScan({
        timestamp: Date.now(),
        bitmap_hex: '0xFFFF00000000FFFF',
        diff: { lifted: ['e2'], placed: ['e4'] }
      });
    },
    /network/i
  );

  assert.equal(traffic.length, 1);
  assert.equal(traffic[0].status, 0);
  assert.equal(traffic[0].statusText, 'CONNECTION_FAILED');
});
