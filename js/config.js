/**
 * CHĀTURANGA Configuration & Hardware Constants
 */

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/**
 * Standard 64-square list in order a1..h8 (Index 0 to 63)
 * Exactly matches python-chess square index mapping:
 * a1 = 0, b1 = 1, ..., h1 = 7, a2 = 8, ..., h8 = 63
 */
export const SQUARES = [];
for (let r = 0; r < 8; r++) {
  for (let f = 0; f < 8; f++) {
    SQUARES.push(`${FILES[f]}${RANKS[r]}`);
  }
}

/**
 * Given square name (e.g. 'e4'), returns 0..63 index
 */
export function squareToIndex(sq) {
  if (!sq || sq.length !== 2) return -1;
  const file = sq[0].toLowerCase();
  const rank = sq[1];
  const fIdx = FILES.indexOf(file);
  const rIdx = RANKS.indexOf(rank);
  if (fIdx === -1 || rIdx === -1) return -1;
  return rIdx * 8 + fIdx;
}

/**
 * Given 0..63 index, returns square name (e.g. 'e4')
 */
export function indexToSquare(idx) {
  if (idx < 0 || idx >= 64) return null;
  return SQUARES[idx];
}

/**
 * Hardware & Simulation defaults
 */
export const HARDWARE_CONFIG = {
  // ESP32 scan cycle time in milliseconds
  DEFAULT_SCAN_INTERVAL_MS: 100,
  MIN_SCAN_INTERVAL_MS: 20,
  MAX_SCAN_INTERVAL_MS: 1000,

  // Debounce consecutive identical readings needed for stability
  DEFAULT_DEBOUNCE_CYCLES: 3,
  MIN_DEBOUNCE_CYCLES: 1,
  MAX_DEBOUNCE_CYCLES: 10,

  // Simulated Wi-Fi connection
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_BACKOFF_MS: 500,

  // Backend connection
  DEFAULT_BACKEND_URL: 'http://127.0.0.1:5000',
  MOCK_MODE_DEFAULT: true,

  // Standard starting FEN
  STARTING_FEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
};

/**
 * Standard starting pieces dictionary
 * Key: square (e.g. 'e1'), Value: piece character (e.g. 'K', 'p')
 */
export const STARTING_PIECES = {
  // Rank 1 (White pieces)
  a1: 'R', b1: 'N', c1: 'B', d1: 'Q', e1: 'K', f1: 'B', g1: 'N', h1: 'R',
  // Rank 2 (White pawns)
  a2: 'P', b2: 'P', c2: 'P', d2: 'P', e2: 'P', f2: 'P', g2: 'P', h2: 'P',
  // Rank 7 (Black pawns)
  a7: 'p', b7: 'p', c7: 'p', d7: 'p', e7: 'p', f7: 'p', g7: 'p', h7: 'p',
  // Rank 8 (Black pieces)
  a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r'
};
