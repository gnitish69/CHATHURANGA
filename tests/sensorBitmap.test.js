import test from 'node:test';
import assert from 'node:assert/strict';
import { squareToIndex, indexToSquare, SQUARES, STARTING_PIECES } from '../js/config.js';
import { SensorMatrix } from '../js/modules/sensorMatrix.js';

test('Square index mapping matches python-chess bitboard standard', () => {
  // Test LSB and MSB corners
  assert.equal(squareToIndex('a1'), 0, 'a1 should be index 0 (bit 0)');
  assert.equal(squareToIndex('b1'), 1, 'b1 should be index 1 (bit 1)');
  assert.equal(squareToIndex('h1'), 7, 'h1 should be index 7 (bit 7)');
  assert.equal(squareToIndex('a2'), 8, 'a2 should be index 8 (bit 8)');
  assert.equal(squareToIndex('e4'), 28, 'e4 should be index 28 (rank 4, file e -> 3*8 + 4 = 28)');
  assert.equal(squareToIndex('a8'), 56, 'a8 should be index 56');
  assert.equal(squareToIndex('h8'), 63, 'h8 should be index 63 (bit 63, MSB)');

  // Roundtrip test
  for (let i = 0; i < 64; i++) {
    const sq = indexToSquare(i);
    assert.equal(squareToIndex(sq), i, `Roundtrip failed for index ${i} (${sq})`);
  }
});

test('Initial board setup generates standard 64-bit occupancy bitmap', () => {
  const matrix = new SensorMatrix();
  matrix.initFromPieces(STARTING_PIECES);

  // Initial count must be exactly 32 pieces
  assert.equal(matrix.getOccupiedCount(), 32, 'Initial board must have 32 occupied sensors');

  // Hex string must be 0xFFFF00000000FFFF
  // Bits 0..15 (ranks 1 & 2) = 1 (0xFFFF)
  // Bits 16..47 (ranks 3..6) = 0 (0x00000000)
  // Bits 48..63 (ranks 7 & 8) = 1 (0xFFFF)
  const hex = matrix.toHex();
  assert.equal(hex, '0xFFFF00000000FFFF', 'Initial position hex bitmap mismatch');

  // Verify byte array (rank 1 to 8)
  const bytes = matrix.toBytes();
  assert.equal(bytes.length, 8);
  assert.equal(bytes[0], 0xFF, 'Rank 1 should be 0xFF');
  assert.equal(bytes[1], 0xFF, 'Rank 2 should be 0xFF');
  assert.equal(bytes[2], 0x00, 'Rank 3 should be 0x00');
  assert.equal(bytes[3], 0x00, 'Rank 4 should be 0x00');
  assert.equal(bytes[4], 0x00, 'Rank 5 should be 0x00');
  assert.equal(bytes[5], 0x00, 'Rank 6 should be 0x00');
  assert.equal(bytes[6], 0xFF, 'Rank 7 should be 0xFF');
  assert.equal(bytes[7], 0xFF, 'Rank 8 should be 0xFF');
});

test('Physical presence updates and diff calculation', () => {
  const matrix = new SensorMatrix();
  matrix.initFromPieces(STARTING_PIECES);
  const initialBigInt = matrix.toBigInt();

  // Pick up pawn from e2
  matrix.setPhysicalPresence('e2', false);
  assert.equal(matrix.getSensorState('e2'), 0);
  assert.equal(matrix.getOccupiedCount(), 31);

  // Place pawn on e4
  matrix.setPhysicalPresence('e4', true);
  assert.equal(matrix.getSensorState('e4'), 1);
  assert.equal(matrix.getOccupiedCount(), 32);

  const movedBigInt = matrix.toBigInt();

  // Compute diff
  const diff = SensorMatrix.computeDiff(initialBigInt, movedBigInt);
  assert.deepEqual(diff.lifted, ['e2']);
  assert.deepEqual(diff.placed, ['e4']);
  assert.equal(diff.changedCount, 2);
});

test('Sensor Debug Mode allows manual override independent of pieces', () => {
  const matrix = new SensorMatrix();
  matrix.initFromPieces(STARTING_PIECES);

  // Enable debug mode
  matrix.setDebugMode(true);
  assert.equal(matrix.debugMode, true);

  // d4 is empty physically, force sensor to 1 (e.g. stuck reed switch)
  assert.equal(matrix.getSensorState('d4'), 0);
  matrix.toggleDebugSensor('d4');
  assert.equal(matrix.getSensorState('d4'), 1);
  assert.equal(matrix.getOccupiedCount(), 33);

  // e2 has piece physically, force sensor to 0 (e.g. missing magnet)
  assert.equal(matrix.getSensorState('e2'), 1);
  matrix.toggleDebugSensor('e2');
  assert.equal(matrix.getSensorState('e2'), 0);

  // Exit debug mode clears overrides
  matrix.setDebugMode(false);
  assert.equal(matrix.getSensorState('d4'), 0);
  assert.equal(matrix.getSensorState('e2'), 1);
  assert.equal(matrix.getOccupiedCount(), 32);
});
