/*
 * Pikafish Chinese Chess Engine - Search
 * Converted from Stockfish/Pikafish C++ search.cpp
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
  MAX_PLY, MAX_MOVES, SQUARE_NB,
  SQ_NONE,
  PieceValue, MG, EG,
} from './pikafish_types.js';

import { evaluate } from './pikafish_evaluate.js';
import { SquareBB, lsb } from './pikafish_bitboard.js';

// =============== Constants ===============
const BOUND_NONE  = 0;
const BOUND_UPPER = 1;
const BOUND_LOWER = 2;
const BOUND_EXACT = 3;

// Pikafish-tuned constants
const futi_mar = 258, redu_1 = 1237, redu_2 = 886, redu_3 = 24539;
const st_bo_1 = 8, st_bo_2 = 332, st_bo_3 = 676, st_bo_4 = 3317;
const Futi_1 = 186, Razo_1 = 433, Razo_2 = 436;
const improv_1 = 4, improv_2 = 2, improv_3 = 5;
const decre_1 = 3, decre_2 = 2, decre_5 = 5;
const statsc_1 = 5589, decr_6 = 6145, decr_7 = 6578, decr_8 = 9, decr_9 = 24;
const singledecre_1 = 1, singledecre_2 = 17, singledecre_3 = 2;
const cutdecre_1 = 2, cutdecre_2 = 21, cutdecre_3 = 7;
const futi_depth = 8;
const Futi_cap_0 = 9, Futi_cap_1 = 196, Futi_cap_2 = 306, Futi_cap_3 = 336, Futi_cap_4 = 45;
const Futi_cap_5 = 6, Futi_cap_6 = 8, Futi_cap_7 = 904;
const Futi_par_1 = 142, Futi_par_2 = 165, Futi_par_3 = 60, Futi_par_4 = 28;
const Futi_par_5 = 49, Futi_par_6 = 12;
const lmrse_1 = 35, lmrse_2 = 4, lmrse_3 = 741, lmrse_4 = 65, lmrse_5 = 6;
const exten_1 = 4, exten_2 = 2, exten_7 = 1, exten_8 = 10, exten_9 = 2;
const exten_10 = 2, exten_11 = 1, exten_12 = 1, exten_13 = 1, exten_14 = 2;
const decr_10 = 6, decr_11 = 1, decr_12 = 1, decr_13 = 1, decr_14 = 3, decr_15 = 1;
const posr60cou = 129;

// =============== Move Generation Helpers ===============
function generateMoves(pos, list) {
  list.splice(0, list.length);
  for (const m of pos.generateLegalMovesFor()) list.push(m);
}

function *legalMovesIter(pos) {
  const us = pos.sideToMove;
  let bb = pos.pieces(us);
  while (bb !== 0n) {
    const from = lsb(bb);
    bb ^= SquareBB[from];
    const moves = pos.generateMovesForSquare(from);
    for (const m of moves) yield m;
  }
}

// =============== Transposition Table ===============
const CLUSTER_ENTRIES = 3;

class TTEntry {
  constructor() {
    this.key16 = 0n;
    this.move = MOVE_NONE;
    this.value = 0;
    this.eval = 0;
    this.depth = 0;
    this.genBound = 0;
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
    this.entries = [];
    this.clusterCount = 0;
    this.generation = 0;
    this.resize(256);
  }

  resize(mbSize) {
    this.clusterCount = mbSize * 1024;
    this.entries = [];
    for (let i = 0; i < this.clusterCount * CLUSTER_ENTRIES; i++)
      this.entries.push(new TTEntry());
  }

  clear() {
    this.generation = (this.generation + 1) & 0xFF;
    for (const e of this.entries) e.clear();
  }

  clusterIndex(key) {
    return Number(key % BigInt(this.clusterCount)) * CLUSTER_ENTRIES;
  }

  probe(key, ttHit) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);
    for (let i = 0; i < CLUSTER_ENTRIES; i++) {
      const e = this.entries[idx + i];
      if (e.key16 === key16) {
        e.genBound = (this.generation << 2) | (e.genBound & 3);
        if (ttHit) ttHit.value = true;
        return e;
      }
    }
    if (ttHit) ttHit.value = false;
    return null;
  }

  store(key, move, value, evalVal, depth, bound, genBoundPv) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);
    let replaceIdx = idx;
    let replaceScore = -Infinity;

    for (let i = 0; i < CLUSTER_ENTRIES; i++) {
      const e = this.entries[idx + i];
      const eGen = e.genBound >> 2;
      const age = (this.generation - eGen) & 0xFF;

      if (e.key16 === 0n || e.key16 === key16) {
        replaceIdx = idx + i;
        break;
      }

      const score = (e.depth - 4 * (age > 3 ? 1 : 0)) - age;
      if (score < replaceScore) {
        replaceScore = score;
        replaceIdx = idx + i;
      }
    }

    const e = this.entries[replaceIdx];
    if (e.key16 === key16 && depth < e.depth) return;

    e.key16 = key16;
    e.move = move;
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
class HistoryTable {
  constructor() {
    this.table = [];
    for (let i = 0; i < 90; i++) {
      this.table[i] = new Int16Array(90);
    }
  }
  get(from, to) { return this.table[from][to]; }
  update(from, to, bonus) {
    const delta = Math.round(bonus - this.table[from][to] * Math.abs(bonus) / 1000);
    this.table[from][to] += delta;
  }
  clear() {
    for (let i = 0; i < 90; i++) this.table[i].fill(0);
  }
}

class HistoryTables {
  constructor() {
    this.mainHistory = [new HistoryTable(), new HistoryTable()];
    this.captureHistory = new HistoryTable();
    this.contHistory = [];
    for (let i = 0; i < PIECE_NB; i++) {
      this.contHistory[i] = new HistoryTable();
    }
    this.counterMove = [];
    for (let i = 0; i < PIECE_NB; i++) {
      this.counterMove[i] = new Int32Array(90);
    }
  }
  clear() {
    for (const h of this.mainHistory) h.clear();
    this.captureHistory.clear();
    for (const h of this.contHistory) h.clear();
    for (let i = 0; i < PIECE_NB; i++) this.counterMove[i].fill(MOVE_NONE);
  }
}

// =============== Stack ===============
class StackEntry {
  constructor() {
    this.pv = null;
    this.currentMove = MOVE_NONE;
    this.excludedMove = MOVE_NONE;
    this.killers = [MOVE_NONE, MOVE_NONE];
    this.staticEval = VALUE_NONE;
    this.statScore = 0;
    this.moveCount = 0;
    this.ttHit = false;
    this.inCheck = false;
    this.ttPv = false;
    this.ply = 0;
    this.cutoffCnt = 0;
    this.doubleExtensions = 0;
  }
}

// =============== Search ===============
export default class Search {
  constructor() {
    this.tt = new TranspositionTable();
    this.history = new HistoryTables();
    this.nodes = 0;
    this.rootDepth = 0;
    this.bestMove = MOVE_NONE;
    this.selDepth = 0;

    this.stack = [];
    for (let i = 0; i < MAX_PLY + 10; i++) {
      this.stack.push(new StackEntry());
    }
  }

  clear() {
    this.tt.clear();
    this.history.clear();
    this.nodes = 0;
    this.rootDepth = 0;
    this.bestMove = MOVE_NONE;
    this.selDepth = 0;
  }

  // =============== Helpers ===============
  static mateIn(ply) { return VALUE_MATE - ply; }
  static matedIn(ply) { return -VALUE_MATE + ply; }

  valueToTT(v, ply) {
    return v >= VALUE_MATE_IN_MAX_PLY ? v + ply :
           v <= VALUE_MATED_IN_MAX_PLY ? v - ply : v;
  }

  valueFromTT(v, ply) {
    return v >= VALUE_MATE_IN_MAX_PLY ? v - ply :
           v <= VALUE_MATED_IN_MAX_PLY ? v + ply : v;
  }

  futilityMargin(d, improving) {
    return futi_mar * (d - (improving ? 1 : 0));
  }

  reduction(improving, depth, moveCount, delta, rootDelta) {
    const r = this.Reductions[depth] * this.Reductions[moveCount];
    return Math.floor((r + redu_1 - delta * 1024 / rootDelta) / 1024) + (!improving && r > redu_2 ? 1 : 0);
  }

  statBonus(d) {
    return Math.min((st_bo_1 * d + st_bo_2) * d - st_bo_3, st_bo_4);
  }

  futilityMoveCount(improving, depth) {
    return improving ? (improv_1 + depth * depth) : (improv_2 + depth * depth) / improv_3;
  }

  // =============== SEARCH ===============
  search(pos, options = {}) {
    this.nodes = 0;
    this.selDepth = 0;
    this.stopFlag = false;
    this.startTime = Date.now();
    this.moveTime = options.moveTime || 99999999;
    this.maxDepth = Math.min(options.maxDepth || 64, MAX_PLY - 1);

    this.tt.newSearch();

    // Get root moves
    const rootMoves = [];
    pos.generateLegalMoves(rootMoves);
    if (rootMoves.length === 0) return MOVE_NONE;

    // Initialize root move states
    const rm = rootMoves.map(m => ({
      move: m, score: -VALUE_INFINITE, avgScore: -VALUE_INFINITE, 
      previousScore: -VALUE_INFINITE, pv: [m]
    }));

    // Iterative deepening
    let bestValue = -VALUE_INFINITE;

    for (this.rootDepth = 1; this.rootDepth <= this.maxDepth; this.rootDepth++) {
      // Aspiration window
      let alpha = -VALUE_INFINITE;
      let beta = VALUE_INFINITE;
      let delta = 12;

      if (this.rootDepth >= 4 && rm[0].avgScore !== -VALUE_INFINITE) {
        const prev = rm[0].avgScore;
        delta = 12 + Math.floor(prev * prev / 29027);
        alpha = Math.max(prev - delta, -VALUE_INFINITE);
        beta = Math.min(prev + delta, VALUE_INFINITE);
      }

      while (true) {
        const ss = this.stack[0];
        ss.ply = 0;
        ss.inCheck = pos.inCheck();
        ss.staticEval = VALUE_NONE;
        ss.ttHit = false;
        ss.ttPv = true;

        bestValue = this.searchRoot(pos, ss, alpha, beta, this.rootDepth, rm);

        if (this.stopFlag) break;

        // Sort root moves by score
        rm.sort((a, b) => b.score - a.score);

        if (bestValue <= alpha) {
          beta = (alpha + beta) / 2;
          alpha = Math.max(bestValue - delta, -VALUE_INFINITE);
        } else if (bestValue >= beta) {
          beta = Math.min(bestValue + delta, VALUE_INFINITE);
        } else {
          break;
        }
        delta += Math.floor(delta / 4) + 2;

        if (alpha >= beta) {
          alpha = -VALUE_INFINITE;
          beta = VALUE_INFINITE;
        }
      }

      if (this.stopFlag) break;
    }

    this.bestMove = rm.length > 0 && rm[0].score > -VALUE_INFINITE ? rm[0].move : (rm[0] ? rm[0].move : MOVE_NONE);
    return this.bestMove;
  }

  // =============== Root Search ===============
  searchRoot(pos, ss, alpha, beta, depth, rootMoves) {
    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;

    ss.inCheck = pos.inCheck();

    // Check for stop
    if (this.nodes % 4096 === 0 && Date.now() - this.startTime >= this.moveTime) {
      this.stopFlag = true;
      return VALUE_ZERO;
    }

    for (const rm of rootMoves) {
      const m = rm.move;
      ss.currentMove = m;

      if (!pos.doMove(m)) continue;
      this.nodes++;

      let value;
      if (bestValue === -VALUE_INFINITE) {
        // First move: full window search
        const nextSS = this.stack[1];
        value = -this.searchPV(pos, nextSS, -beta, -alpha, depth - 1);
      } else {
        // Zero window search
        const nextSS = this.stack[1];
        value = -this.searchNonPV(pos, nextSS, -alpha - 1, -alpha, depth - 1);

        if (value > alpha && value < beta) {
          // Re-search with full window
          const nextSS = this.stack[1];
          value = -this.searchPV(pos, nextSS, -beta, -alpha, depth - 1);
        }
      }

      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;

      rm.score = value;
      rm.avgScore = rm.avgScore === -VALUE_INFINITE ? value : Math.floor((2 * value + rm.avgScore) / 3);

      if (value > bestValue) {
        bestValue = value;
        bestMove = m;

        if (value > alpha) {
          alpha = value;
          if (value >= beta) break;
        }
      }
    }

    return bestValue;
  }

  // =============== PV Search ===============
  searchPV(pos, ss, alpha, beta, depth) {
    // C++: depth <= 0 → qsearch
    if (depth <= 0) return this.qsearchPV(pos, ss, alpha, beta);

    ss.ply = Array.from(this.stack).findIndex(s => s === ss);
    if (ss.ply < 0) ss.ply = 0;
    ss.inCheck = pos.inCheck();
    ss.moveCount = 0;

    this.nodes++;
    if (this.nodes % 4096 === 0 && Date.now() - this.startTime >= this.moveTime) {
      this.stopFlag = true;
      return VALUE_ZERO;
    }

    if (ss.ply >= MAX_PLY) return evaluate(pos);

    // Draw / repetition
    let result = VALUE_ZERO;
    if (pos.ruleJudge(result, ss.ply)) return result === VALUE_DRAW ? VALUE_DRAW - 1 + (this.nodes & 2) : result;

    // Mate distance pruning
    alpha = Math.max(Search.matedIn(ss.ply), alpha);
    beta = Math.min(Search.mateIn(ss.ply + 1), beta);
    if (alpha >= beta) return alpha;

    // TT probe
    const excludedMove = ss.excludedMove;
    const posKey = excludedMove === MOVE_NONE ? pos.key() : pos.key() ^ BigInt(excludedMove);
    let ttHit = { value: false };
    const tte = this.tt.probe(posKey, ttHit);
    ss.ttHit = ttHit.value;

    let ttValue = VALUE_NONE;
    let ttMove = MOVE_NONE;
    if (ss.ttHit) {
      ttValue = this.valueFromTT(tte.value, ss.ply);
      ttMove = tte.move;
    }

    // Early TT cutoff for non-PV (not applicable here since this is PV, but we still check)
    if (ss.ttHit && tte.depth >= depth && ttValue !== VALUE_NONE) {
      const bound = tte.genBound & 3;
      if (bound === BOUND_EXACT) return ttValue;
      if (bound === BOUND_LOWER && ttValue >= beta) return ttValue;
      if (bound === BOUND_UPPER && ttValue <= alpha) return ttValue;
    }

    // Static evaluation
    let evalVal, improving, improvement;
    const prevSq = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;

    if (ss.inCheck) {
      ss.staticEval = evalVal = VALUE_NONE;
      improving = false;
      improvement = 0;
    } else if (ss.ttHit) {
      ss.staticEval = evalVal = tte.eval;
      if (evalVal === VALUE_NONE) ss.staticEval = evalVal = evaluate(pos);
      if (ttValue !== VALUE_NONE && (tte.genBound & (ttValue > evalVal ? BOUND_LOWER : BOUND_UPPER))) {
        evalVal = ttValue;
      }
    } else {
      ss.staticEval = evalVal = evaluate(pos);
      if (excludedMove === MOVE_NONE) {
        this.tt.store(posKey, MOVE_NONE, VALUE_NONE, evalVal, 0, BOUND_NONE, false);
      }
    }

    // Improvement
    improvement = 0;
    if (ss.ply >= 2 && this.stack[ss.ply - 2].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 2].staticEval;
    } else if (ss.ply >= 4 && this.stack[ss.ply - 4].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 4].staticEval;
    } else {
      improvement = improv_1;
    }
    improving = improvement > 0;

    // Razoring (non-PV only)
    // Futility pruning
    if (!ss.ttPv && depth < futi_depth && evalVal - this.futilityMargin(depth, improving) >= beta && evalVal >= beta) {
      return evalVal;
    }

    // Null move pruning (non-PV only)

    // PV node: if no ttMove, reduce depth
    if (!ttMove) depth -= decre_1;
    if (ttMove && depth > 1) {
      depth -= Math.min(Math.floor((depth - tte.depth) / decre_2), decre_5);
    }
    if (depth <= 0) return this.qsearchPV(pos, ss, alpha, beta);

    // Move generation
    const moves = [];
    pos.generateLegalMoves(moves);

    // Score and sort moves
    const scoredMoves = moves.map(m => ({
      move: m,
      score: this.scoreMove(ss, pos, m, ttMove)
    }));
    scoredMoves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let bound = BOUND_UPPER;

    for (let i = 0; i < scoredMoves.length; i++) {
      const m = scoredMoves[i].move;
      if (m === excludedMove) continue;

      moveCount++;
      ss.moveCount = moveCount;

      const capture = pos.board[toSq(m)] !== NO_PIECE;
      const movedPiece = pos.board[fromSq(m)];
      const givesCheck = pos.givesCheck(m);

      let extension = 0;
      let newDepth = depth - 1;

      // Singular extension
      if (depth >= exten_1 && m === ttMove && !excludedMove && Math.abs(ttValue) < VALUE_KNOWN_WIN
          && (tte.genBound & BOUND_LOWER) && tte.depth >= depth - 3) {
        const singularBeta = ttValue - (exten_2 + (ss.ttPv ? 1 : 0)) * depth;
        const singularDepth = Math.floor((depth - 1) / 2);
        ss.excludedMove = m;
        const v = this.searchNonPV(pos, ss, singularBeta - 1, singularBeta, singularDepth);
        ss.excludedMove = MOVE_NONE;
        if (v < singularBeta) {
          extension = exten_7;
          if (v < singularBeta - 2 && ss.doubleExtensions <= exten_8) extension = exten_9;
        } else if (singularBeta >= beta) {
          return singularBeta;
        }
      } else if (givesCheck && depth > 10 && Math.abs(ss.staticEval) > 59) {
        extension = exten_12;
      }
      newDepth += extension;
      ss.doubleExtensions = (this.stack[ss.ply - 1] ? this.stack[ss.ply - 1].doubleExtensions : 0) + (extension === exten_14 ? 1 : 0);

      ss.currentMove = m;

      if (!pos.doMove(m)) continue;

      this.nodes++;
      const nextSS = this.stack[ss.ply + 1];
      nextSS.ttPv = false;
      nextSS.excludedMove = MOVE_NONE;
      this.stack[ss.ply + 2] && (this.stack[ss.ply + 2].killers = [MOVE_NONE, MOVE_NONE]);

      let value;

      // LMR
      if (depth >= 2 && moveCount > 1 + (ss.ply <= 1 ? 1 : 0)) {
        let r = this.reduction(improving, depth, moveCount, beta - alpha, this.rootDelta || 100);

        if (ss.ttPv) r -= singledecre_1 + Math.floor(singledecre_2 / (singledecre_3 + depth));
        if ((ss.ply > 0 && this.stack[ss.ply - 1].moveCount > decr_10)) r -= decr_11;
        if (capture) r += decr_12;

        r -= Math.floor(ss.statScore / (decr_6 + decr_7 * (depth > decr_8 && depth < decr_9 ? 1 : 0)));

        const d = Math.max(1, Math.min(newDepth - r, newDepth + 1));
        value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, d);

        if (value > alpha && d < newDepth) {
          const doDeeper = value > (alpha + lmrse_1 + lmrse_2 * (newDepth - d));
          const doEvenDeeper = value > (alpha + lmrse_3 + lmrse_4 * (newDepth - d));
          const doShallower = value < bestValue + newDepth;
          newDepth += doDeeper - doShallower + doEvenDeeper;
          if (newDepth > d) {
            value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, newDepth);
          }
        }
      } else if (moveCount > 1) {
        value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, newDepth);
      }

      // PV re-search
      if (moveCount === 1 || (value > alpha && value < beta)) {
        const nextSS = this.stack[ss.ply + 1];
        value = -this.searchPV(pos, nextSS, -beta, -alpha, Math.min(depth, newDepth));
      }

      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = m;
          if (value < beta) {
            alpha = value;
            if (depth > 2 && depth < 7 && beta < VALUE_KNOWN_WIN && alpha > -VALUE_KNOWN_WIN) {
              depth--;
            }
          } else {
            ss.cutoffCnt++;
            break;
          }
        }
      } else {
        ss.cutoffCnt = 0;
      }
    }

    if (moveCount === 0) {
      bestValue = excludedMove ? alpha : Search.matedIn(ss.ply);
    }

    // TT save
    if (excludedMove === MOVE_NONE) {
      this.tt.store(posKey, bestMove, this.valueToTT(bestValue, ss.ply), ss.staticEval, depth,
        bestValue >= beta ? BOUND_LOWER : (bestMove ? BOUND_EXACT : BOUND_UPPER), false);
    }

    return bestValue;
  }

  // =============== Non-PV Search ===============
  searchNonPV(pos, ss, alpha, beta, depth) {
    // C++: depth <= 0 → qsearch
    if (depth <= 0) return this.qsearchNonPV(pos, ss, alpha, beta);

    ss.ply = Array.from(this.stack).findIndex(s => s === ss);
    if (ss.ply < 0) ss.ply = 0;
    ss.inCheck = pos.inCheck();
    ss.moveCount = 0;

    this.nodes++;
    if (this.nodes % 4096 === 0 && Date.now() - this.startTime >= this.moveTime) {
      this.stopFlag = true;
      return VALUE_ZERO;
    }

    if (ss.ply >= MAX_PLY) return ss.inCheck ? VALUE_DRAW - 1 + (this.nodes & 2) : evaluate(pos);

    // Draw
    let result = VALUE_ZERO;
    if (pos.ruleJudge(result, ss.ply)) return result === VALUE_DRAW ? VALUE_DRAW - 1 + (this.nodes & 2) : result;

    // Mate distance pruning
    alpha = Math.max(Search.matedIn(ss.ply), alpha);
    beta = Math.min(Search.mateIn(ss.ply + 1), beta);
    if (alpha >= beta) return alpha;

    // TT probe
    const excludedMove = ss.excludedMove;
    const posKey = excludedMove === MOVE_NONE ? pos.key() : pos.key() ^ BigInt(excludedMove);
    let ttHit = { value: false };
    const tte = this.tt.probe(posKey, ttHit);
    ss.ttHit = ttHit.value;

    let ttValue = VALUE_NONE;
    let ttMove = MOVE_NONE;
    if (ss.ttHit) {
      ttValue = this.valueFromTT(tte.value, ss.ply);
      ttMove = tte.move;
    }

    // Early TT cutoff
    if (ss.ttHit && tte.depth >= depth && ttValue !== VALUE_NONE) {
      const bound = tte.genBound & 3;
      if (bound === BOUND_EXACT) return ttValue;
      if (bound === BOUND_LOWER && ttValue >= beta) return ttValue;
      if (bound === BOUND_UPPER && ttValue <= alpha) return ttValue;
    }

    // Static evaluation
    let evalVal, improving, improvement;
    const prevSq = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;

    if (ss.inCheck) {
      ss.staticEval = evalVal = VALUE_NONE;
      improving = false;
      improvement = 0;
    } else if (ss.ttHit) {
      ss.staticEval = evalVal = tte.eval;
      if (evalVal === VALUE_NONE) ss.staticEval = evalVal = evaluate(pos);
      if (ttValue !== VALUE_NONE && (tte.genBound & (ttValue > evalVal ? BOUND_LOWER : BOUND_UPPER))) {
        evalVal = ttValue;
      }
    } else {
      ss.staticEval = evalVal = evaluate(pos);
      if (excludedMove === MOVE_NONE) {
        this.tt.store(posKey, MOVE_NONE, VALUE_NONE, false, BOUND_NONE, 0, MOVE_NONE, evalVal);
      }
    }

    improvement = 0;
    if (ss.ply >= 2 && this.stack[ss.ply - 2].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 2].staticEval;
    } else if (ss.ply >= 4 && this.stack[ss.ply - 4].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 4].staticEval;
    } else {
      improvement = improv_1;
    }
    improving = improvement > 0;

    // Razoring
    if (!improving && evalVal < alpha - Razo_1 - Razo_2 * depth * depth) {
      const v = this.qsearchNonPV(pos, ss, alpha - 1, alpha);
      if (v < alpha) return v;
    }

    // Futility pruning
    if (!ss.ttPv && depth < futi_depth && evalVal - this.futilityMargin(depth, improving) >= beta && evalVal >= beta) {
      return evalVal;
    }

    // Null move pruning
    if (ss.ply > 0 && evalVal >= beta && evalVal >= ss.staticEval && !excludedMove) {
      const R = 3 + Math.floor(depth / 3) + Math.min(Math.floor((evalVal - beta) / 281), 2);
      ss.currentMove = MOVE_NULL;
      if (pos.doNullMove()) {
        const nextSS = this.stack[ss.ply + 1];
        const nullValue = -this.searchNonPV(pos, nextSS, -beta, -beta + 1, depth - R);
        pos.undoNullMove();
        if (nullValue >= beta) {
          if (nullValue >= VALUE_MATE_IN_MAX_PLY) nullValue = beta;
          return nullValue;
        }
      }
    }

    // Move generation
    const moves = [];
    pos.generateLegalMoves(moves);

    const scoredMoves = moves.map(m => ({
      move: m,
      score: this.scoreMove(ss, pos, m, ttMove)
    }));
    scoredMoves.sort((a, b) => b.score - a.score);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;

    for (let i = 0; i < scoredMoves.length; i++) {
      const m = scoredMoves[i].move;
      if (m === excludedMove) continue;

      moveCount++;
      ss.moveCount = moveCount;

      const capture = pos.board[toSq(m)] !== NO_PIECE;
      const movedPiece = pos.board[fromSq(m)];
      const givesCheck = pos.givesCheck(m);

      let extension = 0;
      let newDepth = depth - 1;

      // Pruning at shallow depth
      if (bestValue > VALUE_MATED_IN_MAX_PLY) {
        const moveCountPruning = moveCount >= this.futilityMoveCount(improving, depth);
        const lmrDepth = Math.max(newDepth - this.reduction(improving, depth, moveCount, beta - alpha, this.rootDelta || 100), 0);

        if (capture || givesCheck) {
          if (!givesCheck && lmrDepth < Futi_cap_0 && !ss.inCheck
              && ss.staticEval + Futi_cap_1 + Futi_cap_2 * lmrDepth + PieceValue[EG][pos.board[toSq(m)]] < alpha) {
            continue;
          }
          if (!pos.seeGE(m, -Futi_cap_3 * depth + Futi_cap_4)) continue;
        } else {
          if (lmrDepth < Futi_cap_6) {
            const hist = this.history.contHistory[movedPiece].get(fromSq(m), toSq(m));
            if (hist < -Futi_cap_7 * (depth - 1)) continue;
          }
          if (!ss.inCheck && lmrDepth < Futi_par_6
              && ss.staticEval + Futi_par_1 + Futi_par_2 * lmrDepth <= alpha) {
            continue;
          }
          if (!pos.seeGE(m, -Futi_par_4 * lmrDepth * lmrDepth - Futi_par_5 * lmrDepth)) continue;
        }
      }

      ss.currentMove = m;

      if (!pos.doMove(m)) continue;

      this.nodes++;
      const nextSS = this.stack[ss.ply + 1];
      nextSS.ttPv = false;
      nextSS.excludedMove = MOVE_NONE;
      this.stack[ss.ply + 2] && (this.stack[ss.ply + 2].killers = [MOVE_NONE, MOVE_NONE]);

      let value;

      if (depth >= 2 && moveCount > 1) {
        let r = this.reduction(improving, depth, moveCount, beta - alpha, this.rootDelta || 100);
        if (ss.ttPv) r -= singledecre_1 + Math.floor(singledecre_2 / (singledecre_3 + depth));
        if (ss.ply > 0 && this.stack[ss.ply - 1].moveCount > decr_10) r -= decr_11;
        if (capture) r += decr_12;

        r -= Math.floor(ss.statScore / (decr_6 + decr_7 * (depth > decr_8 && depth < decr_9 ? 1 : 0)));

        // Clamp reduction
        const d = Math.max(1, Math.min(newDepth - r, newDepth + 1));
        value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, d);

        if (value > alpha && d < newDepth) {
          value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, newDepth);
        }
      } else {
        value = -this.searchNonPV(pos, nextSS, -(alpha + 1), -alpha, newDepth);
      }

      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = m;
          if (value >= beta) {
            ss.cutoffCnt++;
            break;
          }
          alpha = value;
        }
      } else {
        ss.cutoffCnt = 0;
      }
    }

    if (moveCount === 0) {
      bestValue = excludedMove ? alpha : Search.matedIn(ss.ply);
    }

    // TT save
    if (excludedMove === MOVE_NONE) {
      this.tt.store(posKey, bestMove, this.valueToTT(bestValue, ss.ply), ss.staticEval, depth,
        bestValue >= beta ? BOUND_LOWER : (bestMove ? BOUND_EXACT : BOUND_UPPER), false);
    }

    return bestValue;
  }

  // =============== QSearch ===============
  qsearchPV(pos, ss, alpha, beta) {
    ss.ply = Array.from(this.stack).findIndex(s => s === ss);
    if (ss.ply < 0) ss.ply = 0;
    ss.inCheck = pos.inCheck();

    this.nodes++;
    if (this.nodes % 4096 === 0 && Date.now() - this.startTime >= this.moveTime) {
      this.stopFlag = true;
      return VALUE_ZERO;
    }

    if (ss.ply >= MAX_PLY) return ss.inCheck ? VALUE_ZERO : evaluate(pos);

    // Draw
    let result = VALUE_ZERO;
    if (pos.ruleJudge(result, ss.ply)) return result === VALUE_DRAW ? VALUE_DRAW - 1 + (this.nodes & 2) : result;

    // Stand pat
    let bestValue = ss.inCheck ? -VALUE_INFINITE : evaluate(pos);
    if (bestValue >= beta) return bestValue;
    if (bestValue > alpha) alpha = bestValue;

    // Generate captures
    const moves = [];
    pos.generateLegalMoves(moves);
    const captures = moves.filter(m => {
      const captured = pos.board[toSq(m)];
      return captured !== NO_PIECE && pos.seeGE(m, 0);
    });

    // Score and sort
    const scored = captures.map(m => ({
      move: m,
      score: PieceValue[EG][pos.board[toSq(m)]] - PieceValue[EG][pos.board[fromSq(m)]] / 100
    }));
    scored.sort((a, b) => b.score - a.score);

    for (const { move: m } of scored) {
      if (!pos.doMove(m)) continue;
      this.nodes++;
      const nextSS = this.stack[ss.ply + 1];
      const value = -this.qsearchPV(pos, nextSS, -beta, -alpha);
      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;
      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          alpha = value;
          if (value >= beta) break;
        }
      }
    }

    return bestValue;
  }

  qsearchNonPV(pos, ss, alpha, beta) {
    ss.ply = Array.from(this.stack).findIndex(s => s === ss);
    if (ss.ply < 0) ss.ply = 0;
    ss.inCheck = pos.inCheck();

    this.nodes++;
    if (this.nodes % 4096 === 0 && Date.now() - this.startTime >= this.moveTime) {
      this.stopFlag = true;
      return VALUE_ZERO;
    }

    if (ss.ply >= MAX_PLY) return ss.inCheck ? VALUE_ZERO : evaluate(pos);

    let result = VALUE_ZERO;
    if (pos.ruleJudge(result, ss.ply)) return result === VALUE_DRAW ? VALUE_DRAW - 1 + (this.nodes & 2) : result;

    let bestValue = ss.inCheck ? -VALUE_INFINITE : evaluate(pos);
    if (bestValue >= beta) return bestValue;
    if (bestValue > alpha) alpha = bestValue;

    const moves = [];
    pos.generateLegalMoves(moves);
    const captures = moves.filter(m => {
      const captured = pos.board[toSq(m)];
      return captured !== NO_PIECE && pos.seeGE(m, 0);
    });

    const scored = captures.map(m => ({
      move: m,
      score: PieceValue[EG][pos.board[toSq(m)]] - PieceValue[EG][pos.board[fromSq(m)]] / 100
    }));
    scored.sort((a, b) => b.score - a.score);

    for (const { move: m } of scored) {
      if (!pos.doMove(m)) continue;
      this.nodes++;
      const nextSS = this.stack[ss.ply + 1];
      const value = -this.qsearchNonPV(pos, nextSS, -beta, -alpha);
      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;
      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          alpha = value;
          if (value >= beta) break;
        }
      }
    }

    return bestValue;
  }

  // =============== Move Scoring ===============
  scoreMove(ss, pos, m, ttMove) {
    if (m === ttMove) return 10000000;

    const from = fromSq(m);
    const to = toSq(m);
    const captured = pos.board[to];
    const pc = pos.board[from];

    if (captured !== NO_PIECE) {
      return 5000000 + PieceValue[EG][captured] - PieceValue[EG][pc] / 100;
    }

    // Quiets
    if (ss.killers[0] === m) return 2000000;
    if (ss.killers[1] === m) return 1900000;

    return Math.min(1800000, this.history.mainHistory[pos.sideToMove].get(from, to));
  }

  // Pre-compute LMR reduction table
  static initReductions() {
    const r = new Int32Array(MAX_MOVES);
    for (let i = 1; i < MAX_MOVES; i++) {
      r[i] = Math.floor((redu_3 / 1000.0 + Math.log(1) / 2) * Math.log(i));
    }
    return r;
  }
}

// Initialize reductions table
Search.prototype.Reductions = Search.initReductions();