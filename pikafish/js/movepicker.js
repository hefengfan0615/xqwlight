"use strict";

// ============================================================
// Pikafish JS - Move Picker
// Ordered move generation for search
// ============================================================

const T = require('./types');
const MoveGen = require('./movegen');

// Scoring constants
const GoodCaptureScore = 1000000;
const KillerScore1 = 900000;
const KillerScore2 = 800000;
const CounterMoveScore = 700000;

class MovePicker {
  constructor(pos, ttMove, depth, killerTable, historyTable, counterMoveTable,
              continuationHistory, captureHistory) {
    this.pos = pos;
    this.ttMove = ttMove;
    this.depth = depth;
    this.killerTable = killerTable;
    this.historyTable = historyTable;
    this.counterMoveTable = counterMoveTable;
    this.continuationHistory = continuationHistory;
    this.captureHistory = captureHistory;

    this.moves = [];
    this.scores = [];
    this.index = 0;
    this.stage = 'TT'; // Stages: TT, KILLERS, COUNTER, QUIETS, BAD_CAPTURES

    // If in check, generate all legal moves immediately (evasion)
    if (pos.checkers()) {
      this.moves = MoveGen.generateLegalMoves(pos);
      this.scoreMoves(this.moves);
      this.sortMoves();
      this.stage = 'EVASION';
      return;
    }
  }

  // Score a list of moves
  scoreMoves(moves) {
    this.scores = [];
    for (const m of moves) {
      let score = 0;
      const to = T.to_sq(m);
      const from = T.from_sq(m);
      const pc = this.pos.board[from];
      const captured = this.pos.board[to];

      if (captured !== T.NO_PIECE) {
        // Capture: MVV-LVA + capture history
        const captPt = T.type_of_piece(captured);
        const mvv = T.PieceValue[0][captPt] * 6;
        const lva = T.PieceValue[0][T.type_of_piece(pc)];
        const hist = this.captureHistory ?
          this.captureHistory.get(pc, to, captPt) : 0;
        score = GoodCaptureScore + mvv - lva + hist;
      } else {
        // Quiet: history + killer/counter
        score = this.historyTable.get(this.pos.sideToMove, from, to);
      }

      this.scores.push(score);
    }
  }

  // Sort moves by score (descending)
  sortMoves() {
    // Shell sort
    const n = this.moves.length;
    let h = 1;
    while (h < Math.floor(n / 3)) h = 3 * h + 1;
    while (h >= 1) {
      for (let i = h; i < n; i++) {
        const tmpMove = this.moves[i];
        const tmpScore = this.scores[i];
        let j = i;
        while (j >= h && this.scores[j - h] < tmpScore) {
          this.moves[j] = this.moves[j - h];
          this.scores[j] = this.scores[j - h];
          j -= h;
        }
        this.moves[j] = tmpMove;
        this.scores[j] = tmpScore;
      }
      h = Math.floor(h / 3);
    }
  }

  // Get next move
  nextMove() {
    if (this.stage === 'EVASION') {
      if (this.index < this.moves.length) {
        const m = this.moves[this.index++];
        return m;
      }
      return T.MOVE_NONE;
    }

    // Stage 1: TT move
    if (this.stage === 'TT') {
      this.stage = 'KILLERS';
      if (this.ttMove !== T.MOVE_NONE && this.pos.legalMove(this.ttMove)) {
        return this.ttMove;
      }
    }

    // Stage 2: Killer moves
    if (this.stage === 'KILLERS') {
      this.stage = 'GENERATE';
      const killers = this.killerTable.get(this.pos.gamePly);
      for (const km of killers) {
        if (km !== T.MOVE_NONE && km !== this.ttMove && this.pos.legalMove(km)) {
          return km;
        }
      }
    }

    // Stage 3: Generate and sort all remaining moves
    if (this.stage === 'GENERATE') {
      this.stage = 'MAIN';
      const allMoves = MoveGen.generateLegalMoves(this.pos);
      this.moves = [];
      this.scores = [];
      for (const m of allMoves) {
        if (m === this.ttMove) continue;
        const killers = this.killerTable.get(this.pos.gamePly);
        if (killers.includes(m)) continue;
        this.moves.push(m);
      }
      this.scoreMoves(this.moves);
      this.sortMoves();
      this.index = 0;
    }

    // Main stage: return sorted moves
    if (this.stage === 'MAIN') {
      if (this.index < this.moves.length) {
        return this.moves[this.index++];
      }
    }

    return T.MOVE_NONE;
  }
}

// Move scoring for quiescence search (captures only, sorted by SEE-like value)
function scoreCaptures(moves, pos, captureHistory) {
  const scored = [];
  for (const m of moves) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = pos.board[from];
    const captured = pos.board[to];
    if (captured === T.NO_PIECE) continue;

    const captPt = T.type_of_piece(captured);
    const mvv = T.PieceValue[0][captPt] * 6;
    const lva = T.PieceValue[0][T.type_of_piece(pc)];
    const hist = captureHistory ? captureHistory.get(pc, to, captPt) : 0;

    scored.push({ move: m, score: mvv - lva + hist });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.move);
}

module.exports = { MovePicker, scoreCaptures };
