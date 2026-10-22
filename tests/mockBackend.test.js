import test from 'node:test';
import assert from 'node:assert/strict';
import { MockBackend } from '../js/modules/mockBackend.js';
import { HARDWARE_CONFIG } from '../js/config.js';

test('MockBackend initializes to official standard starting position', () => {
  const backend = new MockBackend();
  const state = backend.getGameState();

  assert.equal(state.fen, HARDWARE_CONFIG.STARTING_FEN);
  assert.equal(state.turn, 'white');
  assert.equal(state.isCheck, false);
  assert.equal(state.isGameOver, false);
  assert.equal(state.moveCount, 0);
});

test('MockBackend validates and executes legal chess moves', () => {
  const backend = new MockBackend();

  // Move 1: White plays e2e4
  const res1 = backend.executeMove('e2', 'e4');
  assert.equal(res1.status, 'accepted');
  assert.equal(res1.move_uci, 'e2e4');
  assert.equal(res1.move_san, 'e4');
  assert.equal(res1.turn, 'black');
  assert.equal(backend.enPassant, 'e3');

  // Move 2: Black plays e7e5
  const res2 = backend.executeMove('e7', 'e5');
  assert.equal(res2.status, 'accepted');
  assert.equal(res2.move_uci, 'e7e5');
  assert.equal(res2.move_san, 'e5');
  assert.equal(res2.turn, 'white');
  assert.equal(backend.enPassant, 'e6');

  // Move 3: White plays Knight g1f3
  const res3 = backend.executeMove('g1', 'f3');
  assert.equal(res3.status, 'accepted');
  assert.equal(res3.move_san, 'Nf3');
  assert.equal(res3.turn, 'black');
});

test('MockBackend rejects turn violations and illegal piece moves', () => {
  const backend = new MockBackend();

  // 1. Black attempts to move on White's turn
  const turnViolation = backend.executeMove('e7', 'e5');
  assert.equal(turnViolation.status, 'rejected');
  assert.match(turnViolation.reason, /turn/i);

  // 2. White attempts illegal pawn jump e2 to e5 (3 squares forward)
  const illegalPawn = backend.executeMove('e2', 'e5');
  assert.equal(illegalPawn.status, 'rejected');
  assert.match(illegalPawn.reason, /illegal/i);

  // 3. White attempts to move Rook a1 through pawn on a2
  const blockedRook = backend.executeMove('a1', 'a3');
  assert.equal(blockedRook.status, 'rejected');

  // Verify board remained in initial state after rejected moves
  assert.equal(backend.generateFEN(), HARDWARE_CONFIG.STARTING_FEN);
});

test('MockBackend processes physical sensor scan events', () => {
  const backend = new MockBackend();

  // User picks up e2 pawn
  const liftScan = backend.processScan({
    lifted: ['e2'],
    placed: []
  });

  assert.equal(liftScan.status, 'intermediate');
  assert.equal(liftScan.lifted, 'e2');
  assert.deepEqual(liftScan.legalDestinations.sort(), ['e3', 'e4'].sort());
  assert.equal(liftScan.leds['e2'], 'YELLOW');
  assert.equal(liftScan.leds['e3'], 'CYAN');
  assert.equal(liftScan.leds['e4'], 'CYAN');

  // User places piece on e4
  const placeScan = backend.processScan({
    lifted: ['e2'],
    placed: ['e4']
  });

  assert.equal(placeScan.status, 'accepted');
  assert.equal(placeScan.move_uci, 'e2e4');
  assert.equal(backend.turn, 'b');
});
