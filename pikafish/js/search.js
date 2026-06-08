"use strict";

// ============================================================
// Pikafish JS - Search
// Alpha-Beta with PVS, Null Move, LMR, Futility, QSearch
// ============================================================

const T = require('./types');
const MoveGen = require('./movegen');
const Eval = require('./evaluate');
const { MovePicker, scoreCaptures } = require('./movepicker');
const { TranspositionTable, HistoryTable, KillerTable, CounterMoveTable, ContinuationHistory, CaptureHistory } = require('./tables');

// Search tuning constants
const NULL_DEPTH = 3;
const NULL_REDUCTION = 4;
const RAZOR_MARGIN = 433;
const FUTILITY_MARGIN_1 = 186;
const HISTORY_PRUNE_THRESHOLD = -3000;
const MAX_PLY = T.MAX_PLY;
const RANDOMNESS = 8;

class Search {
  constructor(pos) {
    this.pos = pos;
    this.tt = new TranspositionTable(1 << 18);
    this.historyTable = new HistoryTable();
    this.killerTable = new KillerTable();
    this.counterMoveTable = new CounterMoveTable();
    this.continuationHistory = new ContinuationHistory();
    this.captureHistory = new CaptureHistory();
    this.nodes = 0;
    this.qnodes = 0;
    this.startTime = 0;
    this.timeLimit = 0;
    this.stopped = false;
    this.bestMove = T.MOVE_NONE;
    this.bestScore = -T.VALUE_INFINITE;
  }

  checkTime() {
    const elapsed = Date.now() - this.startTime;
    if (this.timeLimit > 0 && elapsed > this.timeLimit) {
      this.stopped = true;
    }
  }

  mateValue() {
    return -T.VALUE_MATE + this.pos.gamePly;
  }

  qsearch(alpha, beta, depth = 0) {
    this.qnodes++;
    this.checkTime();
    if (this.stopped) return alpha;

    if (this.pos.repetition() >= 1) return T.VALUE_DRAW;

    const standPat = Eval.evaluate(this.pos);

    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    if (depth <= T.DEPTH_QS_RECAPTURES) return standPat;

    const inCheck = this.pos.checkers();
    let moves;

    if (inCheck) {
      moves = MoveGen.generateLegalMoves(this.pos);
    } else {
      const allCaptures = MoveGen.generateMoves(this.pos, true);
      const legalCaptures = [];
      for (const m of allCaptures) {
        if (this.pos.legalMove(m)) {
          const captured = this.pos.board[T.to_sq(m)];
          const attacker = this.pos.board[T.from_sq(m)];
          if (captured !== T.NO_PIECE) {
            const captPt = T.type_of_piece(captured);
            const attPt = T.type_of_piece(attacker);
            if (T.PieceValue[0][attPt] <= T.PieceValue[0][captPt] + 50) {
              legalCaptures.push(m);
            }
          }
        }
      }
      moves = legalCaptures;
    }

    moves = scoreCaptures(moves, this.pos, this.captureHistory);

    for (const m of moves) {
      this.pos.makeMove(m);
      const score = -this.qsearch(-beta, -alpha, depth - 1);
      this.pos.undoMove();

      if (this.stopped) return alpha;

      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) return alpha;
      }
    }

    return inCheck ? this.mateValue() : standPat;
  }

  search(alpha, beta, depth, ply = 0, cutNode = false) {
    this.nodes++;
    this.checkTime();
    if (this.stopped) return alpha;

    const inCheck = this.pos.checkers();
    const isPV = (beta - alpha) > 1;

    if (this.pos.repetition() >= 1 && ply > 0) return T.VALUE_DRAW;

    const mateAlpha = Math.max(alpha, this.mateValue());
    if (mateAlpha >= beta) return mateAlpha;

    // TT probe
    let ttMove = T.MOVE_NONE;
    let ttValue = T.VALUE_NONE;
    const ttHit = this.tt.probe(this.pos.zobristKey);
    if (ttHit) {
      ttMove = ttHit.move;
      ttValue = this.adjustTTValue(ttHit.value, ply);
      if (ttHit.depth >= depth) {
        if (ttHit.flag === T.BOUND_EXACT) return ttValue;
        if (ttHit.flag === T.BOUND_LOWER && ttValue >= beta) return ttValue;
        if (ttHit.flag === T.BOUND_UPPER && ttValue <= alpha) return ttValue;
      }
    }

    // Drop to qsearch at depth 0
    if (depth <= 0) {
      return this.qsearch(alpha, beta);
    }

    // Razoring (simplified)
    if (!inCheck && !isPV && depth <= 3) {
      const staticEval = Eval.evaluate(this.pos);
      if (depth === 1 && staticEval - RAZOR_MARGIN < beta) {
        const v = this.qsearch(alpha, beta);
        if (v < beta) return v;
      }
    }

    // Null move pruning
    if (!inCheck && !isPV && depth >= NULL_DEPTH &&
        this.hasNonPawnMaterial(this.pos.sideToMove)) {
      const R = NULL_REDUCTION + Math.floor(depth / 4);
      this.pos.makeNullMove();
      let nullValue = -this.search(-beta, 1 - beta, depth - R, ply + 1, !cutNode);
      this.pos.undoMove();

      if (this.stopped) return alpha;

      if (nullValue >= beta) {
        if (nullValue >= T.VALUE_MATE_IN_MAX_PLY) nullValue = beta;
        return nullValue;
      }
    }

    // Internal iterative reduction
    if (isPV && ttMove === T.MOVE_NONE && depth >= 3) {
      depth--;
    }

    // Futility pruning
    if (!inCheck && !isPV && depth <= 3) {
      const staticEval = Eval.evaluate(this.pos);
      if (staticEval + FUTILITY_MARGIN_1 * depth < alpha) {
        return this.qsearch(alpha, beta);
      }
    }

    // Move picker
    const mp = new MovePicker(
      this.pos, ttMove, depth, this.killerTable, this.historyTable,
      this.counterMoveTable, this.continuationHistory, this.captureHistory
    );

    let bestMove = T.MOVE_NONE;
    let bestValue = -T.VALUE_INFINITE;
    let movesSearched = 0;
    const quietsTried = [];

    while (true) {
      const m = mp.nextMove();
      if (m === T.MOVE_NONE) break;

      if (!this.pos.legalMove(m)) continue;
      this.pos.makeMove(m);

      let newDepth = depth - 1;
      let score;

      if (movesSearched === 0) {
        // Principal variation: full window
        score = -this.search(-beta, -alpha, newDepth, ply + 1, false);
      } else {
        // Late move reductions
        let reduction = 0;
        if (depth >= 3 && movesSearched >= 3 && !this.pos.checkers()) {
          const hist = this.historyTable.get(this.pos.sideToMove, T.from_sq(m), T.to_sq(m));
          if (hist < 0) {
            reduction = 1;
          }
        }

        if (reduction > 0) {
          score = -this.search(-alpha - 1, -alpha, newDepth - reduction, ply + 1, true);
          if (score > alpha && reduction > 0) {
            score = -this.search(-alpha - 1, -alpha, newDepth, ply + 1, !cutNode);
          }
        } else {
          score = -this.search(-alpha - 1, -alpha, newDepth, ply + 1, !cutNode);
        }

        if (score > alpha && score < beta) {
          score = -this.search(-beta, -alpha, newDepth, ply + 1, false);
        }
      }

      this.pos.undoMove();

      if (this.stopped) return alpha;

      movesSearched++;

      if (score > bestValue) {
        bestValue = score;
        bestMove = m;

        if (bestValue >= beta) {
          if (!this.pos.board[T.to_sq(m)]) {
            this.killerTable.set(ply, m);
            this.historyTable.update(this.pos.sideToMove, T.from_sq(m), T.to_sq(m), depth * depth);
            for (const q of quietsTried) {
              this.historyTable.update(this.pos.sideToMove, T.from_sq(q), T.to_sq(q), -depth * depth);
            }
          }
          break;
        }

        if (bestValue > alpha) {
          alpha = bestValue;
        }
      }

      if (!this.pos.board[T.to_sq(m)]) {
        quietsTried.push(m);
      }
    }

    // Store in TT
    let flag = T.BOUND_UPPER;
    if (bestValue >= beta) flag = T.BOUND_LOWER;
    else if (bestMove !== T.MOVE_NONE) flag = T.BOUND_EXACT;

    this.tt.store(this.pos.zobristKey, depth, flag,
      this.adjustTTValueForStore(bestValue, ply),
      Eval.evaluate(this.pos), bestMove);

    return bestValue;
  }

  adjustTTValue(ttValue, ply) {
    if (ttValue >= T.VALUE_MATE_IN_MAX_PLY) return ttValue + ply;
    if (ttValue <= -T.VALUE_MATE_IN_MAX_PLY) return ttValue - ply;
    return ttValue;
  }

  adjustTTValueForStore(value, ply) {
    if (value >= T.VALUE_MATE_IN_MAX_PLY) return value - ply;
    if (value <= -T.VALUE_MATE_IN_MAX_PLY) return value + ply;
    return value;
  }

  hasNonPawnMaterial(color) {
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = this.pos.board[sq];
      if (pc === T.NO_PIECE || T.color_of(pc) !== color) continue;
      const pt = T.type_of_piece(pc);
      if (pt !== T.PAWN && pt !== T.KING) return true;
    }
    return false;
  }

  searchIterativeDeepening(maxDepth, timeLimit) {
    this.tt.newSearch();
    this.killerTable.clear();
    this.nodes = 0;
    this.qnodes = 0;
    this.startTime = Date.now();
    this.timeLimit = timeLimit;
    this.stopped = false;
    this.bestMove = T.MOVE_NONE;
    this.bestScore = -T.VALUE_INFINITE;

    let completedDepth = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      this.checkTime();
      if (this.stopped) break;

      let alpha = -T.VALUE_INFINITE;
      let beta = T.VALUE_INFINITE;
      let delta = 25;

      if (this.bestScore !== -T.VALUE_INFINITE && depth >= 3) {
        alpha = Math.max(-T.VALUE_INFINITE, this.bestScore - delta);
        beta = Math.min(T.VALUE_INFINITE, this.bestScore + delta);
      }

      while (true) {
        const score = this.search(alpha, beta, depth);

        if (this.stopped) break;

        if (score <= alpha) {
          beta = (alpha + beta) / 2;
          alpha = Math.max(-T.VALUE_INFINITE, alpha - delta);
          delta += delta / 2;
        } else if (score >= beta) {
          beta = Math.min(T.VALUE_INFINITE, beta + delta);
          delta += delta / 2;
          const ttHit = this.tt.probe(this.pos.zobristKey);
          if (ttHit && ttHit.move !== T.MOVE_NONE) {
            this.bestMove = ttHit.move;
          }
        } else {
          this.bestScore = score;
          const ttHit = this.tt.probe(this.pos.zobristKey);
          if (ttHit && ttHit.move !== T.MOVE_NONE) {
            this.bestMove = ttHit.move;
          }
          break;
        }
      }

      completedDepth = depth;

      if (Math.abs(this.bestScore) >= T.VALUE_MATE_IN_MAX_PLY) break;

      const elapsed = Date.now() - this.startTime;
      if (elapsed > this.timeLimit * 0.7 && depth >= 4) break;
    }

    return {
      bestMove: this.bestMove,
      score: this.bestScore,
      depth: completedDepth,
      nodes: this.nodes,
      qnodes: this.qnodes,
      time: Date.now() - this.startTime
    };
  }
}

// Convert move to UCI format
function moveToUci(move) {
  if (move === T.MOVE_NONE) return "(none)";
  const from = T.from_sq(move);
  const to = T.to_sq(move);
  const files = "abcdefghi";
  const ranks = "0123456789";
  return files[T.file_of(from)] + ranks[T.rank_of(from)] +
         files[T.file_of(to)] + ranks[T.rank_of(to)];
}

// Parse UCI move string
function uciToMove(pos, str) {
  const files = {a: T.FILE_A, b: T.FILE_B, c: T.FILE_C, d: T.FILE_D, e: T.FILE_E,
                 f: T.FILE_F, g: T.FILE_G, h: T.FILE_H, i: T.FILE_I};
  const ranks = {'0': T.RANK_0, '1': T.RANK_1, '2': T.RANK_2, '3': T.RANK_3, '4': T.RANK_4,
                 '5': T.RANK_5, '6': T.RANK_6, '7': T.RANK_7, '8': T.RANK_8, '9': T.RANK_9};

  if (str.length < 4) return T.MOVE_NONE;

  const fromFile = files[str[0]];
  const fromRank = ranks[str[1]];
  const toFile = files[str[2]];
  const toRank = ranks[str[3]];

  if (fromFile === undefined || fromRank === undefined ||
      toFile === undefined || toRank === undefined) return T.MOVE_NONE;

  const from = T.make_square(fromFile, fromRank);
  const to = T.make_square(toFile, toRank);

  return T.make_move(from, to);
}

module.exports = { Search, moveToUci, uciToMove };
