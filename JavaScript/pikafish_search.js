/*
 * Pikafish Chinese Chess Engine - Search (Alpha-Beta + TT)
 * Converted from Stockfish/Pikafish C++ search.h/cpp
 */

import {
  MAX_PLY, MAX_MOVES,
  MOVE_NONE, MOVE_NULL,
  COLOR_NB, SQUARE_NB, FILE_NB, RANK_NB,
  WHITE, BLACK,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  PieceValue,
  VALUE_ZERO, VALUE_DRAW, VALUE_KNOWN_WIN,
  VALUE_MATE, VALUE_INFINITE, VALUE_NONE,
  VALUE_MATE_IN_MAX_PLY, VALUE_MATED_IN_MAX_PLY,
  DEPTH_QS_CHECKS, DEPTH_QS_NO_CHECKS, DEPTH_QS_RECAPTURES,
  DEPTH_NONE, DEPTH_OFFSET,
  BOUND_NONE, BOUND_UPPER, BOUND_LOWER, BOUND_EXACT,
  fromSq, toSq, makeMove, isOkMove, mateIn, matedIn,
  colorOf, typeOf, makePiece,
} from './pikafish_types.js';

import {
  bbTest, lsb, popcount,
} from './pikafish_bitboard.js';

/**
 * Transposition Table entry
 */
class TTEntry {
  constructor() {
    this.key = 0n;
    this.move = MOVE_NONE;
    this.value = VALUE_NONE;
    this.depth = DEPTH_NONE;
    this.bound = BOUND_NONE;
    this.age = 0;
  }
}

/**
 * Transposition Table
 */
class TranspositionTable {
  constructor(mbSize = 16) {
    this.size = 0;
    this.entries = [];
    this.age = 0;
    this.resize(mbSize);
  }

  resize(mbSize) {
    // Each entry is ~32 bytes, so 1MB ≈ 32768 entries
    this.size = Math.floor(mbSize * 1024 * 1024 / 32);
    this.entries = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      this.entries[i] = new TTEntry();
    }
  }

  probe(key) {
    const idx = Number(key % BigInt(this.size));
    const entry = this.entries[idx];
    if (entry.key === key) {
      entry.age = this.age;
      return entry;
    }
    return null;
  }

  store(key, move, value, depth, bound) {
    const idx = Number(key % BigInt(this.size));
    const entry = this.entries[idx];

    // Replacement strategy: always replace unless same position and lower depth
    if (entry.key === key && entry.depth > depth) return;

    entry.key = key;
    entry.move = move;
    entry.value = value;
    entry.depth = depth;
    entry.bound = bound;
    entry.age = this.age;
  }

  newSearch() {
    this.age++;
  }

  hashFull() {
    let cnt = 0;
    for (let i = 0; i < Math.min(1000, this.size); i++) {
      if (this.entries[i].key !== 0n) cnt++;
    }
    return cnt / Math.min(1000, this.size);
  }
}

/**
 * CounterMove and History tables for move ordering
 */
class MoveOrderingTables {
  constructor() {
    this.counterMoves = [];
    this.historyTable = [];
    this.init();
  }

  init() {
    for (let i = 0; i < SQUARE_NB; i++) {
      this.counterMoves[i] = new Int32Array(SQUARE_NB).fill(MOVE_NONE);
      this.historyTable[i] = new Int32Array(SQUARE_NB).fill(0);
    }
  }

  updateHistory(move, depth) {
    const from = fromSq(move);
    const to = toSq(move);
    this.historyTable[from][to] += depth * depth;
  }

  getHistory(from, to) {
    return this.historyTable[from][to];
  }
}

/**
 * Move scoring utilities
 */
function scoreMove(pos, move, ttMove, counterMove, history) {
  if (move === ttMove) return 1000000;

  const from = fromSq(move);
  const to = toSq(move);
  const captured = pos.board[to];

  if (captured !== 0) {
    // MVV-LVA: Most Valuable Victim - Least Valuable Attacker
    const attacker = typeOf(pos.board[from]);
    const victim = typeOf(captured);
    return 100000 + victim * 100 - attacker;
  }

  if (move === counterMove) return 50000;

  // History heuristic
  return Math.min(history.getHistory(from, to), 40000);
}

/**
 * Search statistics and limits
 */
class SearchLimits {
  constructor() {
    this.depth = 0;
    this.nodes = 0;
    this.moveTime = 0;
    this.timeLeft = [0, 0];
    this.increment = [0, 0];
    this.movesToGo = 0;
    this.infinite = false;
    this.startTime = 0;
    this.maxNodes = 0;
    this.maxDepth = 64;
  }
}

/**
 * Main Search class
 */
export class Search {
  constructor() {
    this.tt = new TranspositionTable(16);
    this.history = new MoveOrderingTables();
    this.nodes = 0;
    this.tbHits = 0;
    this.limits = new SearchLimits();
    this.rootDepth = 0;
    this.bestMove = MOVE_NONE;

    // Search state stack
    this.stack = [];
    for (let i = 0; i <= MAX_PLY + 4; i++) {
      this.stack.push({
        pv: new Int32Array(MAX_PLY + 1),
        currentMove: MOVE_NONE,
        excludedMove: MOVE_NONE,
        killers: [MOVE_NONE, MOVE_NONE],
        staticEval: 0,
        doubleExtensions: 0,
      });
    }

    // Killer moves [ply][0/1]
    this.killers = [];
    for (let i = 0; i <= MAX_PLY + 4; i++) {
      this.killers[i] = [MOVE_NONE, MOVE_NONE];
    }
  }

  clear() {
    this.tt = new TranspositionTable(16);
    this.history = new MoveOrderingTables();
    this.nodes = 0;
    for (let i = 0; i <= MAX_PLY + 4; i++) {
      this.killers[i] = [MOVE_NONE, MOVE_NONE];
    }
  }

  /**
   * Main search entry point
   */
  search(pos, limits) {
    this.limits = { ...this.limits, ...limits };
    this.nodes = 0;
    this.tbHits = 0;
    this.bestMove = MOVE_NONE;
    this.limits.startTime = Date.now();

    pos.initState();
    this.tt.newSearch();

    // Iterative deepening
    const maxDepth = this.limits.maxDepth || 64;
    let bestValue = VALUE_ZERO;

    for (let depth = 1; depth <= maxDepth; depth++) {
      this.rootDepth = depth;

      // Aspiration window
      let alpha = -VALUE_INFINITE;
      let beta = VALUE_INFINITE;
      let delta = 25;

      if (depth >= 5) {
        alpha = Math.max(bestValue - delta, -VALUE_INFINITE);
        beta = Math.min(bestValue + delta, VALUE_INFINITE);
      }

      while (true) {
        bestValue = this.searchRoot(pos, depth, alpha, beta);

        if (this.isStop()) break;

        // Aspiration window failed
        if (bestValue <= alpha) {
          alpha = Math.max(bestValue - delta, -VALUE_INFINITE);
          delta += delta / 2;
        } else if (bestValue >= beta) {
          beta = Math.min(bestValue + delta, VALUE_INFINITE);
          delta += delta / 2;
        } else {
          break; // Window is good
        }
      }

      if (this.isStop()) break;

      // Time management
      const elapsed = Date.now() - this.limits.startTime;
      if (this.limits.moveTime > 0 && elapsed >= this.limits.moveTime / 3) {
        // Only continue if we don't have a reliable best move yet
        if (depth >= 3 && !this.isMateValue(bestValue))
          break;
      }
    }

    return this.bestMove;
  }

  isMateValue(v) {
    return Math.abs(v) >= VALUE_MATE_IN_MAX_PLY;
  }

  /**
   * Root search - returns the best value after searching all root moves
   */
  searchRoot(pos, depth, alpha, beta) {
    const us = pos.sideToMove;
    const rootMoves = [];
    pos.generateLegalMoves(rootMoves);

    if (rootMoves.length === 0) {
      return pos.inCheck() ? matedIn(0) : VALUE_DRAW;
    }

    // Score moves for ordering
    const scoredMoves = rootMoves.map(m => {
      const from = fromSq(m);
      const to = toSq(m);
      let score = 0;

      // Best move from previous iteration
      if (m === this.bestMove) score += 100000;
      // TT move
      const tte = this.tt.probe(pos.key());
      if (tte && tte.move === m) score += 90000;
      // Captures
      const captured = pos.board[to];
      if (captured !== 0) {
        score += 80000 + typeOf(captured) * 100;
      }
      // History
      score += this.history.getHistory(from, to);

      return { move: m, score };
    });

    scoredMoves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = scoredMoves.length > 0 ? scoredMoves[0].move : MOVE_NONE;

    for (let i = 0; i < scoredMoves.length; i++) {
      const m = scoredMoves[i].move;

      pos.doMove(m);
      this.nodes++;

      let value;
      if (i === 0) {
        // Full window search for first move
        value = -this.searchPV(pos, depth - 1, -beta, -alpha, 1);
      } else {
        // Zero window search for remaining moves (LMR)
        value = -this.searchNonPV(pos, depth - 1, -alpha - 1, -alpha, 1);

        // Re-search if zero window fails high
        if (value > alpha) {
          value = -this.searchPV(pos, depth - 1, -beta, -alpha, 1);
        }
      }

      pos.undoMove(m);

      if (this.isStop()) return bestValue;

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          alpha = value;

          if (value >= beta) {
            // Update history for cut node
            this.history.updateHistory(m, depth);
            this.bestMove = m;
            break;
          }
        }
      }
    }

    this.bestMove = bestMove;
    return bestValue;
  }

  /**
   * PV search (within aspiration window, principal variation)
   */
  searchPV(pos, depth, alpha, beta, ply) {
    this.nodes++;

    if (pos.hasRepetition()) return VALUE_DRAW;

    // Check timeout
    if (this.nodes % 1024 === 0 && this.isStop()) return VALUE_DRAW;

    // Mate distance pruning
    alpha = Math.max(alpha, matedIn(ply));
    beta = Math.min(beta, mateIn(ply + 1));
    if (alpha >= beta) return alpha;

    // Transposition table probe
    let ttMove = MOVE_NONE;
    let ttValue = VALUE_NONE;
    const tte = this.tt.probe(pos.key());
    if (tte) {
      ttMove = tte.move;
      if (tte.depth >= depth) {
        ttValue = this.valueFromTT(tte.value, ply);
        if (tte.bound === BOUND_EXACT) return ttValue;
        if (tte.bound === BOUND_LOWER) alpha = Math.max(alpha, ttValue);
        if (tte.bound === BOUND_UPPER) beta = Math.min(beta, ttValue);
        if (alpha >= beta) return ttValue;
      }
    }

    // Checkmate / Stalemate detection
    const inCheck = pos.inCheck();
    if (inCheck) depth++;

    if (depth <= 0) {
      return this.qsearch(pos, alpha, beta, ply);
    }

    // Generate moves
    const moves = [];
    pos.generateLegalMoves(moves);

    if (moves.length === 0) {
      return inCheck ? matedIn(ply) : VALUE_DRAW;
    }

    // Move ordering
    const counterMove = this.history.counterMoves[
      pos.board[toSq(pos.st.lastMove || 0)] || 0]?.[
      fromSq(pos.st.lastMove || 0)] || MOVE_NONE;

    const scoredMoves = moves.map(m => ({
      move: m,
      score: scoreMove(pos, m, ttMove, counterMove, this.history)
    }));
    scoredMoves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;

    for (let i = 0; i < scoredMoves.length; i++) {
      const m = scoredMoves[i].move;
      moveCount++;

      // Extensions
      let extension = 0;
      if (pos.givesCheck(m)) extension = 1;

      const newDepth = depth - 1 + extension;

      pos.doMove(m);

      let value;
      if (moveCount === 1) {
        // Principal variation
        value = -this.searchPV(pos, newDepth, -beta, -alpha, ply + 1);
      } else {
        // LMR (Late Move Reductions)
        let reduction = 0;
        if (depth >= 3 && moveCount > 3 && !pos.board[toSq(m)]) {
          reduction = 1 + Math.floor(Math.log(depth) * Math.log(moveCount) / 2);
          reduction = Math.min(reduction, depth - 1);
        }

        // Zero window search with reduction
        value = -this.searchNonPV(pos, newDepth - reduction, -alpha - 1, -alpha, ply + 1);

        // Re-search if needed
        if (value > alpha && reduction > 0) {
          value = -this.searchNonPV(pos, newDepth, -alpha - 1, -alpha, ply + 1);
        }
        if (value > alpha) {
          value = -this.searchPV(pos, newDepth, -beta, -alpha, ply + 1);
        }
      }

      pos.undoMove(m);

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          alpha = value;

          // Update PV
          this.stack[ply].pv[0] = m;
          for (let j = 0; j < this.stack[ply + 1].pv.length && this.stack[ply + 1].pv[j] !== 0; j++) {
            this.stack[ply].pv[j + 1] = this.stack[ply + 1].pv[j];
          }

          if (value >= beta) {
            // Beta cutoff
            this.updateKillers(m, ply);
            this.history.updateHistory(m, depth);

            this.tt.store(pos.key(), m, this.valueToTT(value, ply), depth, BOUND_LOWER);
            return value;
          }
        }
      }
    }

    // Store in TT
    const bound = bestMove !== MOVE_NONE ? BOUND_EXACT : BOUND_UPPER;
    this.tt.store(pos.key(), bestMove, this.valueToTT(bestValue, ply), depth, bound);

    return bestValue;
  }

  /**
   * Non-PV search (zero window / narrow window)
   */
  searchNonPV(pos, depth, alpha, beta, ply) {
    this.nodes++;

    if (pos.hasRepetition()) return VALUE_DRAW;

    // Check timeout
    if (this.nodes % 1024 === 0 && this.isStop()) return VALUE_DRAW;

    // Mate distance pruning
    alpha = Math.max(alpha, matedIn(ply));
    beta = Math.min(beta, mateIn(ply + 1));
    if (alpha >= beta) return alpha;

    // Transposition table probe
    let ttMove = MOVE_NONE;
    const tte = this.tt.probe(pos.key());
    if (tte) {
      ttMove = tte.move;
      if (tte.depth >= depth) {
        const ttValue = this.valueFromTT(tte.value, ply);
        if (tte.bound === BOUND_EXACT) return ttValue;
        if (tte.bound === BOUND_LOWER) alpha = Math.max(alpha, ttValue);
        if (tte.bound === BOUND_UPPER) beta = Math.min(beta, ttValue);
        if (alpha >= beta) return ttValue;
      }
    }

    const inCheck = pos.inCheck();
    if (inCheck) depth++;

    if (depth <= 0) {
      return this.qsearch(pos, alpha, beta, ply);
    }

    // Null move pruning
    if (!inCheck && depth >= 2 && !pos.pieces(pos.sideToMove)) {
      // Simplified: skip
    }

    // Generate moves
    const moves = [];
    pos.generateLegalMoves(moves);

    if (moves.length === 0) {
      return inCheck ? matedIn(ply) : VALUE_DRAW;
    }

    // Move ordering
    const counterMove = MOVE_NONE;
    const scoredMoves = moves.map(m => ({
      move: m,
      score: scoreMove(pos, m, ttMove, counterMove, this.history)
    }));
    scoredMoves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;

    for (let i = 0; i < scoredMoves.length; i++) {
      const m = scoredMoves[i].move;
      moveCount++;

      // Extensions
      let extension = 0;
      if (pos.givesCheck(m)) extension = 1;

      // Futility pruning
      if (!inCheck && depth <= 4 && bestValue > VALUE_MATED_IN_MAX_PLY) {
        const staticEval = this.evaluateSimple(pos);
        const futilityMargin = 100 * depth;
        if (!pos.board[toSq(m)] && staticEval + futilityMargin <= alpha) {
          continue;
        }
      }

      // LMR
      let reduction = 0;
      if (depth >= 3 && moveCount > 3 && !pos.board[toSq(m)]) {
        reduction = 1 + Math.floor(Math.log(depth) * Math.log(moveCount) / 2);
        reduction = Math.min(reduction, depth - 1);
      }

      const newDepth = Math.max(0, depth - 1 + extension - reduction);

      pos.doMove(m);

      let value;
      if (reduction > 0) {
        value = -this.searchNonPV(pos, newDepth, -alpha - 1, -alpha, ply + 1);
        if (value > alpha) {
          value = -this.searchNonPV(pos, depth - 1 + extension, -alpha - 1, -alpha, ply + 1);
        }
      } else {
        value = -this.searchNonPV(pos, depth - 1 + extension, -alpha - 1, -alpha, ply + 1);
      }

      pos.undoMove(m);

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          if (value >= beta) {
            this.updateKillers(m, ply);
            this.history.updateHistory(m, depth);
            this.tt.store(pos.key(), m, this.valueToTT(value, ply), depth, BOUND_LOWER);
            return value;
          }
          alpha = value;
        }
      }
    }

    const bound = bestMove !== MOVE_NONE ? BOUND_UPPER : BOUND_UPPER;
    this.tt.store(pos.key(), bestMove, this.valueToTT(bestValue, ply), depth, bound);
    return bestValue;
  }

  /**
   * Quiescence search - handles captures to avoid horizon effect
   */
  qsearch(pos, alpha, beta, ply) {
    this.nodes++;

    if (this.nodes % 1024 === 0 && this.isStop()) return VALUE_DRAW;

    // Stand pat evaluation
    let standPat = this.evaluateSimple(pos);

    if (standPat >= beta) return standPat;
    if (alpha < standPat) alpha = standPat;

    // Generate captures only
    const captures = [];
    pos.generateCaptures(captures);

    // Filter legal captures and order by MVV-LVA
    const legalCaptures = [];
    for (const m of captures) {
      if (pos.isLegalMove(m)) {
        const captured = pos.board[toSq(m)];
        const score = typeOf(captured) * 100 - typeOf(pos.board[fromSq(m)]);
        legalCaptures.push({ move: m, score });
      }
    }
    legalCaptures.sort((a, b) => b.score - a.score);

    for (const { move: m } of legalCaptures) {
      // SEE pruning
      if (!pos.seeGE(m, 0)) continue;

      pos.doMove(m);

      const value = -this.qsearch(pos, -beta, -alpha, ply + 1);

      pos.undoMove(m);

      if (value >= beta) return beta;
      if (value > alpha) alpha = value;
    }

    return alpha;
  }

  /**
   * Simple evaluation wrapper
   */
  evaluateSimple(pos) {
    let score = 0;
    const us = pos.sideToMove;

    // Material count
    for (let c = 0; c < COLOR_NB; c++) {
      const sign = c === WHITE ? 1 : -1;
      for (let pt = 1; pt <= BISHOP; pt++) {
        score += sign * pos.pieceCount[c][pt] * PieceValue[1][makePiece(c, pt)];
      }
    }

    return us === WHITE ? score : -score;
  }

  /**
   * Score for TT values (adjusting for mate distance)
   */
  valueToTT(v, ply) {
    if (v >= VALUE_MATE_IN_MAX_PLY) return v + ply;
    if (v <= VALUE_MATED_IN_MAX_PLY) return v - ply;
    return v;
  }

  valueFromTT(v, ply) {
    if (v >= VALUE_MATE_IN_MAX_PLY) return v - ply;
    if (v <= VALUE_MATED_IN_MAX_PLY) return v + ply;
    return v;
  }

  /**
   * Update killer moves
   */
  updateKillers(move, ply) {
    if (this.killers[ply][0] !== move) {
      this.killers[ply][1] = this.killers[ply][0];
      this.killers[ply][0] = move;
    }
  }

  /**
   * Check for search stop conditions
   */
  isStop() {
    // Node limit
    if (this.limits.maxNodes > 0 && this.nodes >= this.limits.maxNodes) return true;

    // Time limit
    if (this.limits.moveTime > 0) {
      const elapsed = Date.now() - this.limits.startTime;
      if (elapsed >= this.limits.moveTime) return true;
    }

    // Infinite search
    if (this.limits.infinite) return false;

    return false;
  }

  /**
   * Get PV line as move array
   */
  getPV() {
    return Array.from(this.stack[0].pv).filter(m => m !== 0);
  }
}

// Default export
export default Search;

/**
 * Create a simple search function for the UI
 */
export function think(pos, timeMs = 1000) {
  const search = new Search();
  const move = search.search(pos, { moveTime: timeMs, maxDepth: 64 });
  return move;
}