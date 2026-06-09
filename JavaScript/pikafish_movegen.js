/*
 * Pikafish Chinese Chess Engine - Move Generator
 * Converted from Stockfish/Pikafish C++ movegen.h/cpp
 */

import {
  MOVE_NONE,
  WHITE, BLACK,
  KING,
  fromSq, toSq, makeMove, isOkMove,
  VALUE_MATE, VALUE_DRAW,
} from './pikafish_types.js';

import {
  SquareBB, bbSet, bbTest, lsb,
  attacksByPieceType,
  rookAttacks, cannonAttacks, knightAttacks,
  bishopAttacks, advisorAttacks, kingAttacks, pawnAttacks,
} from './pikafish_bitboard.js';

/**
 * MoveList - a simple array wrapper for move generation
 */
export class MoveList {
  constructor() {
    this.moves = new Int32Array(128);
    this.size = 0;
  }

  push(m) {
    this.moves[this.size++] = m;
  }

  clear() {
    this.size = 0;
  }

  get(idx) {
    return this.moves[idx];
  }

  [Symbol.iterator]() {
    let i = 0;
    return { next: () => ({ value: this.moves[i], done: i++ >= this.size }) };
  }
}

/**
 * Generate all legal moves for position
 */
export function generateLegal(pos) {
  const list = new MoveList();
  pos.generateLegalMoves(list.moves);
  list.size = pos._moveCount || 0;

  // Regenerate properly
  list.clear();
  const moves = [];
  pos.generateLegalMoves(moves);
  for (const m of moves) list.push(m);
  return list;
}

/**
 * Generate pseudo-legal moves (all moves, some may be illegal)
 */
export function generateAll(pos) {
  const list = new MoveList();
  const moves = [];
  pos.generateMoves(moves);
  for (const m of moves) list.push(m);
  return list;
}

/**
 * Generate captures only
 */
export function generateCaptures(pos) {
  const list = new MoveList();
  const moves = [];
  pos.generateCaptures(moves);
  for (const m of moves) list.push(m);
  return list;
}

/**
 * Extraction helpers for move ordering
 */

// Move stages for staged move generation
export const STAGE_TT_MOVE = 0;
export const STAGE_GOOD_CAPTURES = 1;
export const STAGE_QUIET_MOVES = 2;
export const STAGE_BAD_CAPTURES = 3;
export const STAGE_DONE = 4;

/**
 * MovePicker - staged move generation for search
 */
export class MovePicker {
  constructor(pos, ttMove = MOVE_NONE, threshold = 0) {
    this.pos = pos;
    this.ttMove = ttMove;
    this.stage = STAGE_TT_MOVE;
    this.threshold = threshold;
    this.moves = [];
    this.idx = 0;
    this.goodCaptures = [];
    this.quietMoves = [];
    this.badCaptures = [];
    this.cur = [];
  }

  next() {
    if (this.stage === STAGE_TT_MOVE) {
      this.stage = STAGE_GOOD_CAPTURES;
      if (this.ttMove !== MOVE_NONE && this.pos.isPseudoLegal(
          this.ttMove, this.pos.board[fromSq(this.ttMove)],
          this.pos.board[fromSq(this.ttMove)] ? (this.pos.board[fromSq(this.ttMove)] & 7) : 0)) {
        return this.ttMove;
      }
      return this.next();
    }

    if (this.stage === STAGE_GOOD_CAPTURES) {
      if (this.goodCaptures.length === 0) {
        this.generateAndScore();
      }
      while (this.idx < this.goodCaptures.length) {
        return this.goodCaptures[this.idx++].move;
      }
      this.stage = STAGE_QUIET_MOVES;
      this.idx = 0;
      return this.next();
    }

    if (this.stage === STAGE_QUIET_MOVES) {
      while (this.idx < this.quietMoves.length) {
        return this.quietMoves[this.idx++].move;
      }
      this.stage = STAGE_BAD_CAPTURES;
      this.idx = 0;
      return this.next();
    }

    if (this.stage === STAGE_BAD_CAPTURES) {
      while (this.idx < this.badCaptures.length) {
        return this.badCaptures[this.idx++].move;
      }
      this.stage = STAGE_DONE;
    }

    return MOVE_NONE;
  }

  generateAndScore() {
    const us = this.pos.sideToMove;
    const them = us ^ 1;
    const ourPieces = this.pos.pieces(us);
    const enemyPieces = this.pos.pieces(them);

    let bbRef = { bb: ourPieces };
    let from;
    while ((from = this.pos.popLsbBB(bbRef)) !== SQ_NONE) {
      const pc = this.pos.board[from];
      const pt = pc & 7;

      let att = 0n;
      switch (pt) {
        case 1: att = rookAttacks(from, this.pos.occupied); break;
        case 3: att = cannonAttacks(from, this.pos.occupied); break;
        case 5: att = knightAttacks(from, this.pos.occupied); break;
        case 6: att = bishopAttacks(from, this.pos.occupied, us); break;
        case 2: att = advisorAttacks(from, us); break;
        case 7: att = kingAttacks(from, us); break;
        case 4: att = pawnAttacks(from, us); break;
      }

      att &= ~this.pos.byColorBB[us];

      let toRef = { bb: att };
      let to;
      while ((to = this.pos.popLsbBB(toRef)) !== SQ_NONE) {
        const m = makeMove(from, to);
        if (!this.pos.isLegalMove(m)) continue;

        const captured = this.pos.board[to];
        const score = this.scoreMove(m);

        if (captured !== 0) {
          if (score >= this.threshold) {
            this.goodCaptures.push({ move: m, score });
          } else {
            this.badCaptures.push({ move: m, score });
          }
        } else {
          this.quietMoves.push({ move: m, score });
        }
      }
    }

    // Sort
    this.goodCaptures.sort((a, b) => b.score - a.score);
    this.quietMoves.sort((a, b) => b.score - a.score);
    this.badCaptures.sort((a, b) => b.score - a.score);
  }

  scoreMove(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const captured = this.pos.board[to];
    const pc = this.pos.board[from];

    let score = 0;
    if (captured !== 0) {
      // MVV-LVA
      const capturedType = captured & 7;
      const pieceType = pc & 7;
      score = capturedType * 100 - pieceType;
    } else {
      // History-like heuristic
      score = 0;
    }
    return score;
  }
}