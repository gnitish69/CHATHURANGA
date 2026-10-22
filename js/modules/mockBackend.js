/**
 * MockBackend Module
 * Implements a python-chess-compatible mock chess engine.
 * Serves as the authoritative source of chess truth in MOCK mode.
 * Generates official FEN, validates legal moves, checks legality, and creates LED/OLED hardware directives.
 */

import { FILES, RANKS, SQUARES, squareToIndex, indexToSquare, STARTING_PIECES, HARDWARE_CONFIG } from '../config.js';

export class MockBackend {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = { ...STARTING_PIECES };
    this.turn = 'w'; // 'w' or 'b'
    this.castling = { K: true, Q: true, k: true, q: true };
    this.enPassant = '-';
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.moveHistory = []; // [ { uci: 'e2e4', san: 'e4', fen: '...', player: 'white' } ]
    this.isCheck = false;
    this.isGameOver = false;
    this.statusMessage = 'Game started. White to move.';
  }

  getGameState() {
    return {
      fen: this.generateFEN(),
      turn: this.turn === 'w' ? 'white' : 'black',
      isCheck: this.isCheck,
      isGameOver: this.isGameOver,
      statusMessage: this.statusMessage,
      moveCount: this.moveHistory.length,
      history: [...this.moveHistory]
    };
  }

  /**
   * Process a sensor scan payload:
   * @param {Object} scanPayload { bitmap_hex, lifted: ['e2'], placed: ['e4'], ... }
   */
  processScan(scanPayload) {
    const diff = scanPayload.diff || scanPayload;
    const lifted = diff.lifted || [];
    const placed = diff.placed || [];

    // Case 1: Only 1 square lifted - Piece picked up
    if (lifted.length === 1 && placed.length === 0) {
      const fromSq = lifted[0];
      const piece = this.board[fromSq];
      if (!piece) {
        return {
          status: 'warning',
          reason: `Lifted empty square ${fromSq}`,
          leds: { [fromSq]: 'YELLOW' },
          oled_message: `EMPTY LIFT @ ${fromSq}`
        };
      }
      const isPieceWhite = piece === piece.toUpperCase();
      const currentTurnWhite = this.turn === 'w';

      if (isPieceWhite !== currentTurnWhite) {
        return {
          status: 'warning',
          reason: `Wrong turn! It is ${currentTurnWhite ? 'White' : 'Black'}'s turn to move.`,
          leds: { [fromSq]: 'RED' },
          oled_message: `WRONG TURN: ${fromSq}`
        };
      }

      // Valid lift: highlight source square and show valid destination options
      const legalMoves = this.getLegalMovesFrom(fromSq);
      const leds = { [fromSq]: 'YELLOW' };
      for (const m of legalMoves) {
        leds[m.to] = 'CYAN';
      }

      return {
        status: 'intermediate',
        lifted: fromSq,
        legalDestinations: legalMoves.map(m => m.to),
        leds,
        oled_message: `LIFT: ${piece} @ ${fromSq}`
      };
    }

    // Case 2: One lifted, one placed -> Standard move or simple capture
    if (lifted.length >= 1 && placed.length === 1) {
      const toSq = placed[0];
      // Candidate from square is the lifted square that had a piece matching active turn
      const fromSq = lifted.find(sq => {
        const p = this.board[sq];
        if (!p) return false;
        return (this.turn === 'w') === (p === p.toUpperCase());
      }) || lifted[0];

      return this.executeMove(fromSq, toSq);
    }

    // Case 3: Multiple sensors changed or unhandled combination
    if (lifted.length === 0 && placed.length === 0) {
      return { status: 'idle', oled_message: 'STANDBY' };
    }

    return {
      status: 'intermediate',
      lifted,
      placed,
      oled_message: 'SETTLING MOVE...'
    };
  }

  /**
   * Execute and validate a chess move
   * @param {string} fromSq
   * @param {string} toSq
   * @param {string} promotion Optional 'q', 'r', 'b', 'n'
   */
  executeMove(fromSq, toSq, promotion = 'q') {
    const piece = this.board[fromSq];
    if (!piece) {
      return {
        status: 'rejected',
        reason: `No piece at source square ${fromSq}`,
        leds: { [fromSq]: 'RED', [toSq]: 'RED' },
        oled_message: `ERR: NO PIECE @ ${fromSq}`
      };
    }

    const isWhite = piece === piece.toUpperCase();
    if ((this.turn === 'w') !== isWhite) {
      return {
        status: 'rejected',
        reason: `Turn violation: It is ${this.turn === 'w' ? 'White' : 'Black'}'s turn`,
        leds: { [fromSq]: 'RED', [toSq]: 'RED' },
        oled_message: `WRONG TURN (${this.turn === 'w' ? 'W' : 'B'})`
      };
    }

    // Check if move is in legal moves list
    const legalMoves = this.getLegalMoves();
    const candidateUci = `${fromSq}${toSq}`;
    const matchedMove = legalMoves.find(m =>
      m.from === fromSq && m.to === toSq && (!m.promotion || m.promotion.toLowerCase() === promotion.toLowerCase())
    );

    if (!matchedMove) {
      return {
        status: 'rejected',
        reason: `Illegal move ${candidateUci} for ${piece}`,
        leds: { [fromSq]: 'RED', [toSq]: 'RED' },
        oled_message: `ILLEGAL: ${candidateUci}`
      };
    }

    // Apply move to board
    const capturedPiece = this.board[toSq] || (matchedMove.isEnPassant ? (isWhite ? this.board[`${toSq[0]}5`] : this.board[`${toSq[0]}4`]) : null);

    delete this.board[fromSq];

    // En passant capture cleanup
    if (matchedMove.isEnPassant) {
      const victimSq = isWhite ? `${toSq[0]}5` : `${toSq[0]}4`;
      delete this.board[victimSq];
    }

    // Castling rook movement
    if (matchedMove.isCastling) {
      if (toSq === 'g1') { delete this.board['h1']; this.board['f1'] = 'R'; }
      if (toSq === 'c1') { delete this.board['a1']; this.board['d1'] = 'R'; }
      if (toSq === 'g8') { delete this.board['h8']; this.board['f8'] = 'r'; }
      if (toSq === 'c8') { delete this.board['a8']; this.board['d8'] = 'r'; }
    }

    // Pawn Promotion
    let placedPiece = piece;
    if (matchedMove.promotion) {
      placedPiece = isWhite ? matchedMove.promotion.toUpperCase() : matchedMove.promotion.toLowerCase();
    }
    this.board[toSq] = placedPiece;

    // Update castling rights
    if (piece === 'K') { this.castling.K = false; this.castling.Q = false; }
    if (piece === 'k') { this.castling.k = false; this.castling.q = false; }
    if (fromSq === 'h1' || toSq === 'h1') this.castling.K = false;
    if (fromSq === 'a1' || toSq === 'a1') this.castling.Q = false;
    if (fromSq === 'h8' || toSq === 'h8') this.castling.k = false;
    if (fromSq === 'a8' || toSq === 'a8') this.castling.q = false;

    // Update en passant square
    if (piece.toLowerCase() === 'p' && Math.abs(parseInt(fromSq[1]) - parseInt(toSq[1])) === 2) {
      const midRank = isWhite ? '3' : '6';
      this.enPassant = `${fromSq[0]}${midRank}`;
    } else {
      this.enPassant = '-';
    }

    // Halfmove clock & Fullmove number
    if (piece.toLowerCase() === 'p' || capturedPiece) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }

    if (this.turn === 'b') {
      this.fullmoveNumber++;
      this.turn = 'w';
    } else {
      this.turn = 'b';
    }

    // Check status for new side
    this.isCheck = this.isKingInCheck(this.turn);
    const opponentLegal = this.getLegalMoves();
    if (opponentLegal.length === 0) {
      this.isGameOver = true;
      this.statusMessage = this.isCheck ? `Checkmate! ${isWhite ? 'White' : 'Black'} wins!` : 'Stalemate! Game drawn.';
    } else if (this.isCheck) {
      this.statusMessage = `Check! ${this.turn === 'w' ? 'White' : 'Black'} king in check.`;
    } else {
      this.statusMessage = `${this.turn === 'w' ? 'White' : 'Black'} to move.`;
    }

    const uci = matchedMove.promotion ? `${fromSq}${toSq}${matchedMove.promotion}` : `${fromSq}${toSq}`;
    const san = this._computeSAN(matchedMove, piece, capturedPiece);
    const fen = this.generateFEN();

    const moveRecord = {
      uci,
      san,
      fen,
      from: fromSq,
      to: toSq,
      piece,
      captured: capturedPiece,
      turn: isWhite ? 'white' : 'black',
      isCheck: this.isCheck,
      isGameOver: this.isGameOver
    };
    this.moveHistory.push(moveRecord);

    const leds = {
      [fromSq]: 'YELLOW',
      [toSq]: 'GREEN'
    };
    if (this.isCheck) {
      const kingSq = this.findKing(this.turn);
      if (kingSq) leds[kingSq] = 'RED';
    }

    return {
      status: 'accepted',
      move_uci: uci,
      move_san: san,
      fen,
      turn: this.turn === 'w' ? 'white' : 'black',
      is_check: this.isCheck,
      is_game_over: this.isGameOver,
      leds,
      oled_message: `${san} (${this.turn === 'w' ? 'W' : 'B'})`
    };
  }

  /**
   * Find square of King for a side ('w' or 'b')
   */
  findKing(side) {
    const target = side === 'w' ? 'K' : 'k';
    for (const [sq, piece] of Object.entries(this.board)) {
      if (piece === target) return sq;
    }
    return null;
  }

  /**
   * Check if King is in check
   */
  isKingInCheck(side, testBoard = this.board) {
    const targetKing = side === 'w' ? 'K' : 'k';
    let kingSq = null;
    for (const [sq, piece] of Object.entries(testBoard)) {
      if (piece === targetKing) {
        kingSq = sq;
        break;
      }
    }
    if (!kingSq) return false;
    const opponentSide = side === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(kingSq, opponentSide, testBoard);
  }

  /**
   * Check if square is attacked by side
   */
  isSquareAttacked(targetSq, attackingSide, board = this.board) {
    const tF = FILES.indexOf(targetSq[0]);
    const tR = parseInt(targetSq[1]) - 1;

    for (const [sq, piece] of Object.entries(board)) {
      if (!piece) continue;
      const isWhite = piece === piece.toUpperCase();
      if ((attackingSide === 'w') !== isWhite) continue;

      const pType = piece.toLowerCase();
      const sF = FILES.indexOf(sq[0]);
      const sR = parseInt(sq[1]) - 1;
      const df = tF - sF;
      const dr = tR - sR;

      // Pawn attack
      if (pType === 'p') {
        const pDir = isWhite ? 1 : -1;
        if (dr === pDir && Math.abs(df) === 1) return true;
        continue;
      }

      // Knight attack
      if (pType === 'n') {
        if ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)) {
          return true;
        }
        continue;
      }

      // King attack
      if (pType === 'k') {
        if (Math.abs(df) <= 1 && Math.abs(dr) <= 1) return true;
        continue;
      }

      // Rook / Queen orthogonal attacks
      if (pType === 'r' || pType === 'q') {
        if (df === 0 || dr === 0) {
          if (this._isPathClear(sq, targetSq, board)) return true;
        }
      }

      // Bishop / Queen diagonal attacks
      if (pType === 'b' || pType === 'q') {
        if (Math.abs(df) === Math.abs(dr)) {
          if (this._isPathClear(sq, targetSq, board)) return true;
        }
      }
    }
    return false;
  }

  _isPathClear(fromSq, toSq, board) {
    const f1 = FILES.indexOf(fromSq[0]);
    const r1 = parseInt(fromSq[1]) - 1;
    const f2 = FILES.indexOf(toSq[0]);
    const r2 = parseInt(toSq[1]) - 1;

    const stepF = Math.sign(f2 - f1);
    const stepR = Math.sign(r2 - r1);

    let curF = f1 + stepF;
    let curR = r1 + stepR;

    while (curF !== f2 || curR !== r2) {
      const sq = `${FILES[curF]}${curR + 1}`;
      if (board[sq]) return false;
      curF += stepF;
      curR += stepR;
    }
    return true;
  }

  /**
   * Get all pseudo-legal moves for a specific square
   */
  getPseudoMovesFrom(fromSq, board = this.board) {
    const piece = board[fromSq];
    if (!piece) return [];
    const isWhite = piece === piece.toUpperCase();
    const pType = piece.toLowerCase();
    const f1 = FILES.indexOf(fromSq[0]);
    const r1 = parseInt(fromSq[1]) - 1;
    const moves = [];

    const addMove = (toSq, extra = {}) => {
      const destPiece = board[toSq];
      if (destPiece) {
        const destWhite = destPiece === destPiece.toUpperCase();
        if (destWhite === isWhite) return false; // Own piece blocked
      }
      moves.push({ from: fromSq, to: toSq, piece, ...extra });
      return !destPiece; // Continue ray if empty square
    };

    // 1. Pawn
    if (pType === 'p') {
      const dir = isWhite ? 1 : -1;
      const startRank = isWhite ? 1 : 6;
      const promoRank = isWhite ? 7 : 0;

      // 1 square forward
      const fwdR = r1 + dir;
      if (fwdR >= 0 && fwdR < 8) {
        const fwdSq = `${FILES[f1]}${fwdR + 1}`;
        if (!board[fwdSq]) {
          if (fwdR === promoRank) {
            for (const promo of ['q', 'r', 'b', 'n']) {
              moves.push({ from: fromSq, to: fwdSq, piece, promotion: promo });
            }
          } else {
            moves.push({ from: fromSq, to: fwdSq, piece });
            // 2 squares forward from start
            if (r1 === startRank) {
              const fwd2R = r1 + dir * 2;
              const fwd2Sq = `${FILES[f1]}${fwd2R + 1}`;
              if (!board[fwd2Sq]) {
                moves.push({ from: fromSq, to: fwd2Sq, piece });
              }
            }
          }
        }
      }

      // Diagonal captures & En Passant
      for (const df of [-1, 1]) {
        const capF = f1 + df;
        const capR = r1 + dir;
        if (capF >= 0 && capF < 8 && capR >= 0 && capR < 8) {
          const capSq = `${FILES[capF]}${capR + 1}`;
          const destPiece = board[capSq];
          if (destPiece && (destPiece === destPiece.toUpperCase()) !== isWhite) {
            if (capR === promoRank) {
              for (const promo of ['q', 'r', 'b', 'n']) {
                moves.push({ from: fromSq, to: capSq, piece, promotion: promo });
              }
            } else {
              moves.push({ from: fromSq, to: capSq, piece });
            }
          } else if (this.enPassant === capSq) {
            moves.push({ from: fromSq, to: capSq, piece, isEnPassant: true });
          }
        }
      }
    }

    // 2. Knight
    if (pType === 'n') {
      const deltas = [
        [-1, -2], [1, -2], [-2, -1], [2, -1],
        [-2, 1], [2, 1], [-1, 2], [1, 2]
      ];
      for (const [df, dr] of deltas) {
        const tf = f1 + df;
        const tr = r1 + dr;
        if (tf >= 0 && tf < 8 && tr >= 0 && tr < 8) {
          addMove(`${FILES[tf]}${tr + 1}`);
        }
      }
    }

    // 3. Bishop & Queen (diagonals)
    if (pType === 'b' || pType === 'q') {
      const diagDirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [df, dr] of diagDirs) {
        let curF = f1 + df;
        let curR = r1 + dr;
        while (curF >= 0 && curF < 8 && curR >= 0 && curR < 8) {
          const keepGoing = addMove(`${FILES[curF]}${curR + 1}`);
          if (!keepGoing) break;
          curF += df;
          curR += dr;
        }
      }
    }

    // 4. Rook & Queen (orthogonals)
    if (pType === 'r' || pType === 'q') {
      const orthoDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [df, dr] of orthoDirs) {
        let curF = f1 + df;
        let curR = r1 + dr;
        while (curF >= 0 && curF < 8 && curR >= 0 && curR < 8) {
          const keepGoing = addMove(`${FILES[curF]}${curR + 1}`);
          if (!keepGoing) break;
          curF += df;
          curR += dr;
        }
      }
    }

    // 5. King
    if (pType === 'k') {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          const tf = f1 + df;
          const tr = r1 + dr;
          if (tf >= 0 && tf < 8 && tr >= 0 && tr < 8) {
            addMove(`${FILES[tf]}${tr + 1}`);
          }
        }
      }

      // Castling
      if (isWhite) {
        if (fromSq === 'e1' && !this.isSquareAttacked('e1', 'b', board)) {
          if (this.castling.K && !board['f1'] && !board['g1'] && board['h1'] === 'R' &&
              !this.isSquareAttacked('f1', 'b', board) && !this.isSquareAttacked('g1', 'b', board)) {
            moves.push({ from: 'e1', to: 'g1', piece, isCastling: true });
          }
          if (this.castling.Q && !board['d1'] && !board['c1'] && !board['b1'] && board['a1'] === 'R' &&
              !this.isSquareAttacked('d1', 'b', board) && !this.isSquareAttacked('c1', 'b', board)) {
            moves.push({ from: 'e1', to: 'c1', piece, isCastling: true });
          }
        }
      } else {
        if (fromSq === 'e8' && !this.isSquareAttacked('e8', 'w', board)) {
          if (this.castling.k && !board['f8'] && !board['g8'] && board['h8'] === 'r' &&
              !this.isSquareAttacked('f8', 'w', board) && !this.isSquareAttacked('g8', 'w', board)) {
            moves.push({ from: 'e8', to: 'g8', piece, isCastling: true });
          }
          if (this.castling.q && !board['d8'] && !board['c8'] && !board['b8'] && board['a8'] === 'r' &&
              !this.isSquareAttacked('d8', 'w', board) && !this.isSquareAttacked('c8', 'w', board)) {
            moves.push({ from: 'e8', to: 'c8', piece, isCastling: true });
          }
        }
      }
    }

    return moves;
  }

  /**
   * Filter pseudo moves to only strictly legal moves (no moving into check)
   */
  getLegalMovesFrom(fromSq) {
    const pseudo = this.getPseudoMovesFrom(fromSq);
    const piece = this.board[fromSq];
    if (!piece) return [];
    const isWhite = piece === piece.toUpperCase();
    const side = isWhite ? 'w' : 'b';

    return pseudo.filter(m => {
      // Simulate move on shallow cloned board
      const testBoard = { ...this.board };
      delete testBoard[m.from];
      if (m.isEnPassant) {
        const victimSq = isWhite ? `${m.to[0]}5` : `${m.to[0]}4`;
        delete testBoard[victimSq];
      }
      testBoard[m.to] = m.promotion ? (isWhite ? m.promotion.toUpperCase() : m.promotion.toLowerCase()) : m.piece;
      return !this.isKingInCheck(side, testBoard);
    });
  }

  /**
   * Get all legal moves for active side
   */
  getLegalMoves() {
    const isWhiteTurn = this.turn === 'w';
    const legal = [];
    for (const [sq, piece] of Object.entries(this.board)) {
      if (!piece) continue;
      const isWhite = piece === piece.toUpperCase();
      if (isWhite === isWhiteTurn) {
        legal.push(...this.getLegalMovesFrom(sq));
      }
    }
    return legal;
  }

  /**
   * Generate authoritative standard FEN string
   */
  generateFEN() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let emptyCount = 0;
      let rowStr = '';
      for (let f = 0; f < 8; f++) {
        const sq = `${FILES[f]}${RANKS[r]}`;
        const piece = this.board[sq];
        if (!piece) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount;
            emptyCount = 0;
          }
          rowStr += piece;
        }
      }
      if (emptyCount > 0) rowStr += emptyCount;
      rows.push(rowStr);
    }

    let castleStr = '';
    if (this.castling.K) castleStr += 'K';
    if (this.castling.Q) castleStr += 'Q';
    if (this.castling.k) castleStr += 'k';
    if (this.castling.q) castleStr += 'q';
    if (!castleStr) castleStr = '-';

    return `${rows.join('/')} ${this.turn} ${castleStr} ${this.enPassant} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  _computeSAN(move, piece, captured) {
    if (move.isCastling) {
      return move.to === 'g1' || move.to === 'g8' ? 'O-O' : 'O-O-O';
    }
    const pType = piece.toUpperCase();
    let prefix = pType === 'P' ? '' : pType;
    let capStr = '';
    if (captured) {
      if (pType === 'P') prefix = move.from[0];
      capStr = 'x';
    }
    let promoStr = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
    let checkStr = this.isCheck ? (this.isGameOver ? '#' : '+') : '';
    return `${prefix}${capStr}${move.to}${promoStr}${checkStr}`;
  }
}
