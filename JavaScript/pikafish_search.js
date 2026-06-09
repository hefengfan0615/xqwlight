/*
 * Pikafish Chinese Chess Engine - Search
 * Converted from Stockfish/Pikafish C++ search.cpp, tt.cpp, movepick.cpp
 */

import {
  MOVE_NONE, MOVE_NULL,
  fromSq, toSq, makeMove,
  NO_PIECE, WHITE, BLACK, COLOR_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  PIECE_TYPE_NB, PIECE_NB,
  VALUE_ZERO, VALUE_DRAW, VALUE_NONE, VALUE_INFINITE, VALUE_MATE,
  VALUE_MATED_IN_MAX_PLY, VALUE_MATE_IN_MAX_PLY, VALUE_KNOWN_WIN,
  makeScore, mgValue, egValue, SCORE_ZERO,
  colorOf, typeOf, fileOf, rankOf, makeSquare,
  MAX_PLY, MAX_MOVES,
  SQ_A0, SQ_NONE,
  PieceValue, MG, EG,
} from './pikafish_types.js';

import { evaluate } from './pikafish_evaluate.js';

// =============== Constants ===============

// Search limits
const TIME_FOREVER = 99999999;

// TT entry flags
const BOUND_NONE  = 0;
const BOUND_UPPER = 1;
const BOUND_LOWER = 2;
const BOUND_EXACT = 3;

// Improving state
const NOT_IMPROVING    = 0;
const MAYBE_IMPROVING  = 1;
const IMPROVING        = 2;

// =============== Transposition Table ===============

// Cluster of 3 TT entries (like C++: Cluster of 3)
const CLUSTER_ENTRIES = 3;

class TTEntry {
  constructor() {
    this.key16 = 0n;      // High 16 bits of key
    this.move = MOVE_NONE;
    this.value = 0;
    this.eval = 0;
    this.depth = 0;
    this.genBound = 0;    // generation | bound
  }

  clear() {
    this.key16 = 0n;
    this.move = MOVE_NONE;
    this.value = 0;
    this.eval = 0;
    this.depth = 0;
    this.genBound = 0;
  }
}

class TranspositionTable {
  constructor() {
    this.entries = [];     // Flat array of TTEntry
    this.clusterCount = 0;
    this.generation = 0;
    this.resize(256);     // Initial size: 256 clusters = 768 entries
  }

  resize(mbSize) {
    // mbSize in megabytes, but we use cluster count for simplicity
    const count = Math.max(1, mbSize * 1024); // rough clusters per MB
    this.clusterCount = count;
    this.entries = [];
    for (let i = 0; i < count * CLUSTER_ENTRIES; i++) {
      this.entries.push(new TTEntry());
    }
  }

  clear() {
    this.generation = (this.generation + 1) & 0xFF;
    for (const e of this.entries) e.clear();
  }

  // Get first entry of the cluster for key
  clusterIndex(key) {
    return Number(key % BigInt(this.clusterCount)) * CLUSTER_ENTRIES;
  }

  // Probe: return TT entry if found
  probe(key, ttHit) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);

    for (let i = 0; i < CLUSTER_ENTRIES; i++) {
      const e = this.entries[idx + i];
      if (e.key16 === key16) {
        // Refresh generation
        e.genBound = (this.generation << 2) | (e.genBound & 3);
        if (ttHit) ttHit.value = true;
        return e;
      }
    }
    if (ttHit) ttHit.value = false;
    return null;
  }

  // Store: write into TT, replacing entries by age/depth strategy
  store(key, move, value, evalVal, depth, bound) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);

    // Find entry to replace: prefer empty, then same key, then lowest depth
    let replaceIdx = idx;
    let replaceDepth = -999;

    for (let i = 0; i < CLUSTER_ENTRIES; i++) {
      const e = this.entries[idx + i];
      const eGen = e.genBound >> 2;
      const eBound = e.genBound & 3;

      if (e.key16 === 0n || e.key16 === key16) {
        // Empty or same key: use this
        replaceIdx = idx + i;
        break;
      }

      // Age-based replacement: prefer entries from older generation
      // or same generation but lower depth
      const age = (this.generation - eGen) & 0xFF;
      const eDepth = (e.depth - 4 * (age > 3 ? 1 : 0));
      if (eDepth < replaceDepth) {
        replaceDepth = eDepth;
        replaceIdx = idx + i;
      } else if (age > 0) {
        // Slightly prefer older entries
        const adjustedDepth = eDepth - age;
        if (adjustedDepth < replaceDepth) {
          replaceDepth = adjustedDepth;
          replaceIdx = idx + i;
        }
      }
    }

    // Store
    const e = this.entries[replaceIdx];
    // Don't overwrite an entry of same position with lower depth
    if (e.key16 === key16 && depth < e.depth) return;

    if (move || e.key16 !== key16) {
      e.move = move;
    }
    e.key16 = key16;
    e.value = value;
    e.eval = evalVal;
    e.depth = depth;
    e.genBound = (this.generation << 2) | bound;
  }

  newSearch() {
    this.generation = (this.generation + 1) & 0xFF;
  }
}

// =============== History Tables ===============

class HistoryTables {
  constructor() {
    // [color][from_sq][to_sq]
    this.mainHistory = [];
    this.captureHistory = [];
    // [piece][to_sq]
    this.contHistory = [];  // continuation history
    // [piece][to_sq]
    this.counterMove = [];

    this.init();
  }

  init() {
    for (let c = 0; c < COLOR_NB; c++) {
      this.mainHistory[c] = [];
      this.captureHistory[c] = [];
      for (let i = 0; i < 90; i++) {
        this.mainHistory[c][i] = new Int16Array(90);
        this.captureHistory[c][i] = new Int16Array(90);
      }
    }
    for (let i = 0; i < PIECE_NB; i++) {
      this.contHistory[i] = new Int16Array(90);
      this.counterMove[i] = new Int32Array(90);
    }
  }

  clear() {
    this.init();
  }

  getHistory(c, m) {
    const from = fromSq(m), to = toSq(m);
    return this.mainHistory[c][from][to];
  }

  updateHistory(c, m, bonus) {
    const from = fromSq(m), to = toSq(m);
    const idx = c === WHITE ? 0 : 1;

    // Clamp bonus
    if (bonus > 1000) bonus = 1000;
    if (bonus < -1000) bonus = -1000;

    // Update main history
    const delta = bonus - this.mainHistory[idx][from][to] * Math.abs(bonus) / 1000;
    this.mainHistory[idx][from][to] += Math.round(delta);

    // Update capture history (simplified)
    this.captureHistory[idx][from][to] += Math.round(delta * 0.5);
  }

  getContHistory(pc, to) {
    return this.contHistory[pc][to];
  }

  updateContHistory(pc, to, bonus) {
    if (bonus > 500) bonus = 500;
    if (bonus < -500) bonus = -500;
    const delta = bonus - this.contHistory[pc][to] * Math.abs(bonus) / 500;
    this.contHistory[pc][to] += Math.round(delta);
  }

  getCounterMove(pc, to) {
    return this.counterMove[pc][to];
  }

  setCounterMove(pc, to, m) {
    this.counterMove[pc][to] = m;
  }
}

// =============== Stack ===============

class StackEntry {
  constructor() {
    this.pv = null;         // Not used directly in JS
    this.currentMove = MOVE_NONE;
    this.excludedMove = MOVE_NONE;
    this.killers = [MOVE_NONE, MOVE_NONE];
    this.staticEval = 0;
    this.statScore = 0;
    this.moveCount = 0;
    this.ttHit = false;
    this.inCheck = false;
    this.ttPv = false;
    this.excludedMovesChecked = false;
    this.improving = NOT_IMPROVING;
  }

  reset() {
    this.currentMove = MOVE_NONE;
    this.excludedMove = MOVE_NONE;
    this.killers[0] = MOVE_NONE;
    this.killers[1] = MOVE_NONE;
    this.staticEval = 0;
    this.statScore = 0;
    this.moveCount = 0;
    this.ttHit = false;
    this.inCheck = false;
    this.ttPv = false;
    this.excludedMovesChecked = false;
    this.improving = NOT_IMPROVING;
  }
}

// =============== Search Context ===============

class SearchContext {
  constructor(pos) {
    this.pos = pos;
    this.nodes = 0;
    this.selDepth = 0;
    this.rootDepth = 0;
    this.stopFlag = false;
    this.startTime = 0;
    this.moveTime = TIME_FOREVER;
    this.maxDepth = 64;
    this.bestMove = MOVE_NONE;

    // Stack as array, indexed by ply
    this.stack = [];
    for (let i = 0; i < MAX_PLY + 4; i++) {
      this.stack.push(new StackEntry());
    }
  }

  // Check if time limit exceeded
  checkTime() {
    if (this.nodes & 4095) return; // Check every 4096 nodes
    if (this.stopFlag) return;
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.moveTime) {
      this.stopFlag = true;
    }
  }

  // Compute LMR reduction based on depth and move count
  reduction(improving, depth, moveCount) {
    // LMR formula from Pikafish
    let r = Math.log(depth) * Math.log(moveCount) / 1.95;
    r = Math.floor(r);
    if (r < 0) r = 0;

    // Adjust by improving state
    if (!improving) r++;
    if (r > depth - 1) r = depth - 1;

    return r;
  }
}

// =============== Move Scoring for Ordering ===============

function scoreMove(ss, pos, m, ttMove, history) {
  if (m === ttMove) return 1000000;

  const from = fromSq(m);
  const to = toSq(m);
  const captured = pos.board[to];
  const pc = pos.board[from];
  const c = pos.sideToMove;

  if (captured !== NO_PIECE) {
    // MVV-LVA for captures
    const capturedVal = PieceValue[MG][captured] || 0;
    const pieceVal = PieceValue[MG][pc] || 0;
    // SEE-based ordering
    if (pos.seeGE(m, 0)) {
      return 500000 + (capturedVal / 10) - (pieceVal / 100);
    } else {
      return 300000 + (capturedVal / 10) - (pieceVal / 100);
    }
  }

  // Quiets: killer first, then history
  if (ss.killers[0] === m) return 200000;
  if (ss.killers[1] === m) return 190000;

  return Math.min(180000, history.getHistory(c, m));
}

// =============== Staged Move Generation ===============

class MoveList {
  constructor() {
    this.moves = new Int32Array(128);
    this.size = 0;
  }
  push(m) { this.moves[this.size++] = m; }
  clear() { this.size = 0; }
}

// Generate all legal moves into MoveList
function generateAllMoves(pos, list) {
  list.clear();
  const moves = [];
  pos.generateLegalMoves(moves);
  for (const m of moves) list.push(m);
}

// Generate captures only
function generateCaptures(pos, list) {
  list.clear();
  const moves = [];
  pos.generateLegalCaptures(moves);
  for (const m of moves) list.push(m);
}

// =============== Main Search ===============

export default class Search {
  constructor() {
    this.tt = new TranspositionTable();
    this.history = new HistoryTables();
    this.nodes = 0;
    this.rootDepth = 0;
    this.bestMove = MOVE_NONE;
  }

  clear() {
    this.tt.clear();
    this.history.clear();
    this.nodes = 0;
    this.rootDepth = 0;
    this.bestMove = MOVE_NONE;
  }

  /**
   * search(pos, options) - Main entry point for search
   * options: { moveTime, maxDepth }
   * Returns best move
   */
  search(pos, options = {}) {
    const ctx = new SearchContext(pos);
    ctx.nodes = 0;
    ctx.stopFlag = false;
    ctx.startTime = Date.now();
    ctx.moveTime = options.moveTime || TIME_FOREVER;
    ctx.maxDepth = options.maxDepth || 64;

    this.tt.newSearch();

    // Iterative deepening
    ctx.rootDepth = 0;
    let bestValue = -VALUE_INFINITE;
    let delta = 16; // aspiration window delta

    for (let depth = 1; depth <= ctx.maxDepth; depth++) {
      ctx.rootDepth = depth;

      // Aspiration window
      let alpha = -VALUE_INFINITE;
      let beta = VALUE_INFINITE;
      if (depth >= 4) {
        alpha = Math.max(-VALUE_INFINITE, bestValue - delta);
        beta = Math.min(VALUE_INFINITE, bestValue + delta);
      }

      while (true) {
        const ss = ctx.stack[0]; // Root stack
        ss.reset();
        ss.inCheck = pos.inCheck();

        const value = this.searchRoot(pos, ctx, ss, alpha, beta, depth);

        if (ctx.stopFlag) break;

        // Aspiration window handling
        if (value <= alpha) {
          // Fail low: widen window
          beta = (alpha + beta) / 2;
          alpha = Math.max(-VALUE_INFINITE, value - delta);
          delta += delta / 2;
          if (beta < alpha) beta = VALUE_INFINITE;
        } else if (value >= beta) {
          // Fail high: widen window
          beta = Math.min(VALUE_INFINITE, value + delta);
          delta += delta / 2;
        } else {
          // Exact score
          bestValue = value;
          break;
        }

        if (delta > 1000) {
          // Window too wide, just use full window
          alpha = -VALUE_INFINITE;
          beta = VALUE_INFINITE;
        }
      }

      if (ctx.stopFlag) break;

      bestValue = ctx.stack[0].pvValue || bestValue;
    }

    this.nodes = ctx.nodes;
    this.rootDepth = ctx.rootDepth;
    this.bestMove = ctx.bestMove;
    return ctx.bestMove;
  }

  // =============== Root Search ===============

  searchRoot(pos, ctx, ss, alpha, beta, depth) {
    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;

    // Generate root moves
    const rootMoves = new MoveList();
    generateAllMoves(pos, rootMoves);

    if (rootMoves.size === 0) {
      return pos.inCheck() ? -VALUE_MATE + ss.ply : VALUE_DRAW;
    }

    // Score and sort root moves
    const scoredMoves = [];
    for (let i = 0; i < rootMoves.size; i++) {
      const m = rootMoves.moves[i];
      scoredMoves.push({
        move: m,
        score: -VALUE_INFINITE,
      });
    }

    for (let i = 0; i < scoredMoves.length && !ctx.stopFlag; i++) {
      const moveInfo = scoredMoves[i];

      ss.currentMove = moveInfo.move;
      ss.ply = 0;

      if (!pos.doMove(moveInfo.move)) continue;

      ctx.nodes++;

      let value;
      if (i === 0) {
        // First move: full window search
        value = -this.searchPV(pos, ctx, ctx.stack[1], -beta, -alpha, depth - 1);
      } else {
        // Zero window search to see if better
        value = -this.searchNonPV(pos, ctx, ctx.stack[1], -alpha - 1, -alpha, depth - 1);
        if (value > alpha && value < beta) {
          // Re-search with full window
          value = -this.searchPV(pos, ctx, ctx.stack[1], -beta, -alpha, depth - 1);
        }
      }

      pos.undoMove(moveInfo.move);

      if (ctx.stopFlag) return VALUE_ZERO;

      moveInfo.score = value;

      if (value > bestValue) {
        bestValue = value;
        bestMove = moveInfo.move;

        if (value > alpha) {
          alpha = value;

          // Record PV
          ss.pvValue = value;
        }
      }

      if (alpha >= beta) break;
    }

    ctx.bestMove = bestMove;
    return bestValue;
  }

  // =============== PV Search (principal variation) ===============

  searchPV(pos, ctx, ss, alpha, beta, depth) {
    ss.ply = 1; // Will be adjusted per level
    const result = this._searchPV(pos, ctx, ss, alpha, beta, depth, 0);
    return result;
  }

  _searchPV(pos, ctx, ss, alpha, beta, depth, plySkipped) {
    // Actually, let me use a proper recursive implementation with ply tracking
    // The key fix: pass ply explicitly
    return this.searchPVImpl(pos, ctx, ss, alpha, beta, depth, 0);
  }

  searchPVImpl(pos, ctx, ss, alpha, beta, depth, ply) {
    ss.ply = ply;
    ss.ttHit = false;
    ss.inCheck = pos.inCheck();

    ctx.checkTime();
    if (ctx.stopFlag) return VALUE_ZERO;

    // Mate distance pruning
    if (ply >= MAX_PLY - 1) {
      return evaluate(pos);
    }

    // Check for draw
    if (pos.isDraw(ply)) return VALUE_DRAW;

    // TT probe
    let ttValue = VALUE_NONE;
    let ttMove = MOVE_NONE;
    let ttHit = false;

    const tte = this.tt.probe(pos.key());
    if (tte && tte.move !== MOVE_NONE) {
      ttMove = tte.move;
      ttHit = true;
      ss.ttHit = true;
    }

    // TT cut (PV nodes)
    if (ttHit && tte.depth >= depth) {
      ttValue = tte.value;
      const bound = tte.genBound & 3;

      // Adjust mate values
      if (ttValue >= VALUE_MATE_IN_MAX_PLY) ttValue -= ply;
      else if (ttValue <= VALUE_MATED_IN_MAX_PLY) ttValue += ply;

      if (bound === BOUND_EXACT) return ttValue;
      if (bound === BOUND_LOWER && ttValue >= beta) return ttValue;
      if (bound === BOUND_UPPER && ttValue <= alpha) return ttValue;
    }

    // Evaluate position
    let improving = false;
    if (!ss.inCheck) {
      ss.staticEval = evaluate(pos);

      // Check previous ply for improving
      if (ply >= 2) {
        const prevSq = ctx.stack[ply - 2];
        if (prevSq.staticEval !== 0) {
          improving = ss.staticEval > prevSq.staticEval;
        }
      }

      if (ttHit && tte.eval !== VALUE_NONE) {
        ss.staticEval = tte.eval;
      }
    } else {
      ss.staticEval = -VALUE_INFINITE;
    }

    // Razoring
    if (!ss.inCheck && depth <= 1 && ss.staticEval + 500 < alpha) {
      const v = this.qsearchPV(pos, ctx, ss, alpha, beta, ply);
      if (v <= alpha) return v;
    }

    // Futility pruning
    if (!ss.inCheck && depth <= 4 && ss.staticEval + 120 * depth <= alpha) {
      const v = this.qsearchPV(pos, ctx, ss, alpha, beta, ply);
      if (v < beta) return v;
    }

    // Null move pruning
    if (!ss.inCheck && depth >= 2 && !pos.hasRepetition()) {
      const R = 3 + depth / 3;
      if (pos.doNullMove()) {
        const nullPly = ply + 1;
        const nextSS = ctx.stack[nullPly];
        nextSS.staticEval = 0;
        const nullValue = -this.searchNonPV(pos, ctx, nextSS, -beta, -beta + 1, depth - R, nullPly);
        pos.undoNullMove();

        if (ctx.stopFlag) return VALUE_ZERO;

        if (nullValue >= beta) {
          if (depth < 12) return nullValue;
          // Verification search
          const v = this.searchNonPV(pos, ctx, ss, beta - 1, beta, depth - R, ply);
          if (v >= beta) return nullValue;
        }
      }
    }

    // Move generation and search
    const moveList = new MoveList();
    generateAllMoves(pos, moveList);

    // Score and sort
    const moves = [];
    for (let i = 0; i < moveList.size; i++) {
      moves.push({
        move: moveList.moves[i],
        score: scoreMove(ss, pos, moveList.moves[i], ttMove, this.history),
      });
    }
    moves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let bound = BOUND_UPPER;

    for (let i = 0; i < moves.length && !ctx.stopFlag; i++) {
      const m = moves[i].move;

      if (m === ss.excludedMove) continue;

      ss.currentMove = m;

      if (!pos.doMove(m)) continue;

      ctx.nodes++;
      moveCount++;
      ss.moveCount = moveCount;

      // LMR
      let extension = 0;
      let newDepth = depth - 1 + extension;

      // Late Move Reduction
      let doLMR = depth >= 3 && moveCount > 3;

      const nextSS = ctx.stack[ply + 1];
      nextSS.reset();
      nextSS.inCheck = pos.inCheck();

      let value;
      if (i === 0) {
        // First move: full window
        value = -this.searchPVImpl(pos, ctx, nextSS, -beta, -alpha, newDepth, ply + 1);
      } else {
        // LMR
        let r = this.lmrReduction(improving, depth, moveCount);

        // Zero window with reduction
        value = -this.searchNonPV(pos, ctx, nextSS, -alpha - 1, -alpha, newDepth - r, ply + 1);

        if (value > alpha) {
          // Re-search without reduction
          value = -this.searchNonPV(pos, ctx, nextSS, -alpha - 1, -alpha, newDepth, ply + 1);
        }

        if (value > alpha && value < beta) {
          // PV re-search
          value = -this.searchPVImpl(pos, ctx, nextSS, -beta, -alpha, newDepth, ply + 1);
        }
      }

      pos.undoMove(m);

      if (ctx.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          alpha = value;
          bound = BOUND_EXACT;

          // Update history
          if (pos.board[toSq(m)] === NO_PIECE) {
            this.history.updateHistory(pos.sideToMove ^ 1, m, depth * depth);
          }
        }
      }

      if (alpha >= beta) {
        bound = BOUND_LOWER;
        // Update killers and history
        if (pos.board[toSq(m)] === NO_PIECE) {
          ss.killers[1] = ss.killers[0];
          ss.killers[0] = m;
          this.history.updateHistory(pos.sideToMove ^ 1, m, depth * depth);
        }
        break;
      }
    }

    // No legal moves
    if (moveCount === 0 && !ss.excludedMove) {
      return ss.inCheck ? -VALUE_MATE + ply : VALUE_DRAW;
    }

    // Store to TT
    const ttVal = bestValue >= VALUE_MATE_IN_MAX_PLY ? bestValue + ply :
                  bestValue <= VALUE_MATED_IN_MAX_PLY ? bestValue - ply :
                  bestValue;
    this.tt.store(pos.key(), bestMove, ttVal, ss.staticEval, depth, bound);

    return bestValue;
  }

  // =============== Non-PV Search ===============

  searchNonPV(pos, ctx, ss, alpha, beta, depth, ply) {
    ss.ply = ply;
    ss.ttHit = false;
    ss.inCheck = pos.inCheck();

    ctx.checkTime();
    if (ctx.stopFlag) return VALUE_ZERO;

    if (ply >= MAX_PLY - 1) {
      return evaluate(pos);
    }

    if (pos.isDraw(ply)) return VALUE_DRAW;

    // TT probe
    let ttMove = MOVE_NONE;
    const tte = this.tt.probe(pos.key());
    if (tte && tte.move !== MOVE_NONE) {
      ttMove = tte.move;
      ss.ttHit = true;
    }

    // TT cut
    if (ss.ttHit && tte.depth >= depth) {
      let ttValue = tte.value;
      const bound = tte.genBound & 3;

      if (ttValue >= VALUE_MATE_IN_MAX_PLY) ttValue -= ply;
      else if (ttValue <= VALUE_MATED_IN_MAX_PLY) ttValue += ply;

      if (bound === BOUND_EXACT) return ttValue;
      if (bound === BOUND_LOWER && ttValue >= beta) return ttValue;
      if (bound === BOUND_UPPER && ttValue <= alpha) return ttValue;
    }

    // Evaluate
    let improving = false;
    if (!ss.inCheck) {
      ss.staticEval = evaluate(pos);

      if (ply >= 2) {
        const prevSS = ctx.stack[ply - 2];
        if (prevSS.staticEval !== 0) {
          improving = ss.staticEval > prevSS.staticEval;
        }
      }

      if (ss.ttHit && tte.eval !== VALUE_NONE) {
        ss.staticEval = tte.eval;
      }
    } else {
      ss.staticEval = -VALUE_INFINITE;
    }

    // Razoring
    if (!ss.inCheck && depth <= 1 && ss.staticEval + 500 < alpha) {
      const v = this.qsearchNonPV(pos, ctx, ss, alpha, beta, ply);
      if (v <= alpha) return v;
    }

    // Futility pruning
    if (!ss.inCheck && depth <= 4 && ss.staticEval + 120 * depth <= alpha) {
      return this.qsearchNonPV(pos, ctx, ss, alpha, beta, ply);
    }

    // Null move pruning
    if (!ss.inCheck && depth >= 2 && !pos.hasRepetition()) {
      const R = 3 + depth / 3;
      if (pos.doNullMove()) {
        const nullPly = ply + 1;
        const nullSS = ctx.stack[nullPly];
        nullSS.staticEval = 0;
        const nullValue = -this.searchNonPV(pos, ctx, nullSS, -beta, -beta + 1, depth - R, nullPly);
        pos.undoNullMove();

        if (ctx.stopFlag) return VALUE_ZERO;

        if (nullValue >= beta) {
          return nullValue;
        }
      }
    }

    // Move generation
    const moveList = new MoveList();
    generateAllMoves(pos, moveList);

    const moves = [];
    for (let i = 0; i < moveList.size; i++) {
      moves.push({
        move: moveList.moves[i],
        score: scoreMove(ss, pos, moveList.moves[i], ttMove, this.history),
      });
    }
    moves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let bound = BOUND_UPPER;

    for (let i = 0; i < moves.length && !ctx.stopFlag; i++) {
      const m = moves[i].move;
      if (m === ss.excludedMove) continue;

      ss.currentMove = m;

      // SEE pruning for quiets at low depth
      if (depth <= 3 && pos.board[toSq(m)] === NO_PIECE) {
        if (!pos.seeGE(m, -50 * depth * depth)) continue;
      }

      if (!pos.doMove(m)) continue;

      ctx.nodes++;
      moveCount++;
      ss.moveCount = moveCount;

      const nextSS = ctx.stack[ply + 1];
      nextSS.reset();
      nextSS.inCheck = pos.inCheck();

      // LMR
      let newDepth = depth - 1;
      let r = 0;
      if (depth >= 3 && moveCount > 1) {
        r = this.lmrReduction(improving, depth, moveCount);
      }

      let value = -this.searchNonPV(pos, ctx, nextSS, -alpha - 1, -alpha, newDepth - r, ply + 1);

      if (r > 0 && value > alpha) {
        value = -this.searchNonPV(pos, ctx, nextSS, -alpha - 1, -alpha, newDepth, ply + 1);
      }

      pos.undoMove(m);

      if (ctx.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          alpha = value;
          bound = BOUND_EXACT;
        }
      }

      if (alpha >= beta) {
        bound = BOUND_LOWER;
        if (pos.board[toSq(m)] === NO_PIECE) {
          ss.killers[1] = ss.killers[0];
          ss.killers[0] = m;
          this.history.updateHistory(pos.sideToMove ^ 1, m, depth * depth);
        }
        break;
      }
    }

    if (moveCount === 0) {
      return ss.inCheck ? -VALUE_MATE + ply : VALUE_DRAW;
    }

    // Store to TT
    const ttVal = bestValue >= VALUE_MATE_IN_MAX_PLY ? bestValue + ply :
                  bestValue <= VALUE_MATED_IN_MAX_PLY ? bestValue - ply :
                  bestValue;
    this.tt.store(pos.key(), bestMove, ttVal, ss.staticEval, depth, bound);

    return bestValue;
  }

  // =============== QSearch (quiescence search) ===============

  qsearchPV(pos, ctx, ss, alpha, beta, ply) {
    ss.ply = ply;
    ctx.checkTime();
    if (ctx.stopFlag) return VALUE_ZERO;

    if (ply >= MAX_PLY - 1) return evaluate(pos);
    if (pos.isDraw(ply)) return VALUE_DRAW;

    // Stand pat
    const standPat = evaluate(pos);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    // Generate captures
    const moveList = new MoveList();
    generateCaptures(pos, moveList);

    // Only search good captures (SEE >= 0)
    const goodCaptures = [];
    for (let i = 0; i < moveList.size; i++) {
      const m = moveList.moves[i];
      if (pos.seeGE(m, 0)) {
        goodCaptures.push({ move: m, score: scoreMove(ss, pos, m, MOVE_NONE, this.history) });
      }
    }
    goodCaptures.sort((a, b) => b.score - a.score);

    for (let i = 0; i < goodCaptures.length && !ctx.stopFlag; i++) {
      const m = goodCaptures[i].move;
      if (!pos.doMove(m)) continue;

      ctx.nodes++;
      const value = -this.qsearchPV(pos, ctx, ss, -beta, -alpha, ply + 1);
      pos.undoMove(m);

      if (ctx.stopFlag) return VALUE_ZERO;
      if (value >= beta) return value;
      if (value > alpha) alpha = value;
    }

    return alpha;
  }

  qsearchNonPV(pos, ctx, ss, alpha, beta, ply) {
    ss.ply = ply;
    ctx.checkTime();
    if (ctx.stopFlag) return VALUE_ZERO;

    if (ply >= MAX_PLY - 1) return evaluate(pos);
    if (pos.isDraw(ply)) return VALUE_DRAW;

    const standPat = evaluate(pos);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    const moveList = new MoveList();
    generateCaptures(pos, moveList);

    const goodCaptures = [];
    for (let i = 0; i < moveList.size; i++) {
      const m = moveList.moves[i];
      if (pos.seeGE(m, 0)) {
        goodCaptures.push({ move: m, score: scoreMove(ss, pos, m, MOVE_NONE, this.history) });
      }
    }
    goodCaptures.sort((a, b) => b.score - a.score);

    for (let i = 0; i < goodCaptures.length && !ctx.stopFlag; i++) {
      const m = goodCaptures[i].move;
      if (!pos.doMove(m)) continue;

      ctx.nodes++;
      const value = -this.qsearchNonPV(pos, ctx, ss, -beta, -alpha, ply + 1);
      pos.undoMove(m);

      if (ctx.stopFlag) return VALUE_ZERO;
      if (value >= beta) return value;
      if (value > alpha) alpha = value;
    }

    return alpha;
  }

  // =============== LMR Reduction ===============

  lmrReduction(improving, depth, moveCount) {
    // Pikafish LMR: reduction = log(depth) * log(moveCount) / redu_1
    const redu_1 = 1.95;
    let r = Math.log(depth) * Math.log(moveCount) / redu_1;
    r = Math.floor(r);
    if (r < 0) r = 0;

    if (!improving) r++;

    // Don't reduce below 1
    if (r >= depth) r = depth - 1;
    if (r < 0) r = 0;

    return r;
  }
}