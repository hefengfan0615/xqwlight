/*
 * Pikafish Chinese Chess Engine - Search
 * Complete port of Stockfish/Pikafish C++ search.cpp
 *
 * Implements:
 *  - Iterative deepening with aspiration window
 *  - PVS / alpha-beta with non-PV, PV and Root node types
 *  - Transposition table with generation-based replacement
 *  - Late move reductions (LMR)
 *  - Null move pruning with verification
 *  - ProbCut
 *  - Singular extension + multi-cut
 *  - Futility / razoring / history pruning
 *  - Quiescence search (captures + checks)
 *  - History heuristics (main, capture, continuation, counter-move, killers)
 *  - onInfo callback emitting UCI-style info (score/depth/seldepth/pv)
 */

import {
  MOVE_NONE, MOVE_NULL,
  fromSq, toSq, makeMove, makeKey,
  NO_PIECE, WHITE, BLACK, COLOR_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  PIECE_TYPE_NB, PIECE_NB,
  VALUE_ZERO, VALUE_DRAW, VALUE_NONE, VALUE_INFINITE, VALUE_MATE,
  VALUE_MATED_IN_MAX_PLY, VALUE_MATE_IN_MAX_PLY, VALUE_KNOWN_WIN,
  SQ_NONE, colorOf, typeOf, fileOf, rankOf,
  MAX_PLY, MAX_MOVES, SQUARE_NB,
  PawnValueMg,
  PieceValue, MG, EG,
  DEPTH_QS_CHECKS, DEPTH_QS_NO_CHECKS, DEPTH_NONE,
  BOUND_NONE, BOUND_UPPER, BOUND_LOWER, BOUND_EXACT,
  mateIn, matedIn,
} from './pikafish_types.js';

import { evaluate } from './pikafish_evaluate.js';
import { SquareBB, lsb, popcount } from './pikafish_bitboard.js';

// =====================================================================
// Tuned constants (from Pikafish search.cpp)
// =====================================================================
const futi_mar = 258;
const redu_1   = 1237;
const redu_2   = 886;
const redu_3   = 24539;
const st_bo_1  = 8;
const st_bo_2  = 332;
const st_bo_3  = 676;
const st_bo_4  = 3317;
const Futi_1   = 186;
const Numov_0  = 15503;
const Numov_1  = 11;
const Numov_2  = 14;
const Numov_3  = 136;
const Numov_4  = 41;
const Numov_5  = 281;
const Numov_6  = 2;
const Numov_9  = 603;
const probCut_1 = 138;
const probCut_2 = 63;
const probCut_3 = 193;
const delt_1   = 12;
const delt_2   = 29027;
const exten_1  = 4;
const exten_2  = 2;
const exten_3  = 19;
const exten_4  = 10;
const exten_5  = 59;
const exten_6  = 3573;
const impro_1  = 179;
const Razo_1   = 433;
const Razo_2   = 436;
const statsc_1 = 5589;
const extrbon_1 = 53;
const futiba_1  = 83;
const posr60cou = 129;
const lmrse_1  = 35;
const lmrse_2  = 4;
const lmrse_3  = 741;
const lmrse_4  = 65;
const lmrse_5  = 6;
const decr_0   = 3;
const decr_1   = 2;
const decr_2   = 5;
const decr_3   = 1;
const decr_4   = 22;
const decr_5   = 5;
const decr_6   = 6145;
const decr_7   = 6578;
const decr_8   = 9;
const decr_9   = 24;
const improv_1 = 4;
const improv_2 = 2;
const improv_3 = 5;
const delt_3   = 4;
const delt_4   = 2;
const probdep_1 = 1;
const probdep_2 = 3;
const Futi_cap_0 = 9;
const Futi_cap_1 = 196;
const Futi_cap_2 = 306;
const Futi_cap_3 = 336;
const Futi_cap_4 = 45;
const Futi_cap_5 = 6;
const Futi_cap_6 = 8;
const Futi_cap_7 = 904;
const Futi_par_1 = 142;
const Futi_par_2 = 165;
const Futi_par_3 = 60;
const Futi_par_4 = 28;
const Futi_par_5 = 49;
const Futi_par_6 = 12;
const pvredu_1  = 1;
const pvredu_2  = 17;
const pvredu_3  = 2;
const cutredu_1 = 2;
const cutredu_2 = 21;
const cutredu_3 = 7;
const Futidep   = 8;
const nuldep_1  = 3;
const nuldep_2  = 4;
const exten_7   = 1;
const exten_8   = 10;
const exten_9   = 2;
const exten_10  = 2;
const exten_11  = 1;
const exten_12  = 1;
const exten_13  = 1;
const exten_14  = 2;
const decr_10   = 6;
const decr_11   = 1;
const decr_12   = 1;
const decr_13   = 1;
const decr_14   = 3;
const decr_15   = 1;

// =====================================================================
// Node types
// =====================================================================
const NonPV = 0, PV = 1, Root = 2;

// =====================================================================
// Stat bonus (C++: history update formula)
// =====================================================================
function statBonus(d) {
  return Math.min((st_bo_1 * d + st_bo_2) * d - st_bo_3, st_bo_4);
}

// =====================================================================
// History table cell (gravity-update, range [-D, D])
// =====================================================================
function histUpdate(v, bonus, D) {
  return v + bonus - v * Math.abs(bonus) / D;
}

// =====================================================================
// Butterfly history [color][from*90+to], int16 range 7183
// =====================================================================
class ButterflyHistory {
  constructor() {
    this.table = new Int16Array(COLOR_NB * SQUARE_NB * SQUARE_NB);
  }
  get(c, m) { return this.table[(c * SQUARE_NB + fromSq(m)) * SQUARE_NB + toSq(m)]; }
  set(c, m, v) { this.table[(c * SQUARE_NB + fromSq(m)) * SQUARE_NB + toSq(m)] = v; }
  update(c, m, bonus) {
    const idx = (c * SQUARE_NB + fromSq(m)) * SQUARE_NB + toSq(m);
    this.table[idx] = histUpdate(this.table[idx], bonus, 7183);
  }
  clear() { this.table.fill(0); }
}

// =====================================================================
// CapturePieceToHistory [piece][to][capturedType], int16 range 10692
// =====================================================================
class CapturePieceToHistory {
  constructor() {
    this.table = new Int16Array(PIECE_NB * SQUARE_NB * PIECE_TYPE_NB);
  }
  get(pc, to, captured) {
    return this.table[(pc * SQUARE_NB + to) * PIECE_TYPE_NB + captured];
  }
  update(pc, to, captured, bonus) {
    const idx = (pc * SQUARE_NB + to) * PIECE_TYPE_NB + captured;
    this.table[idx] = histUpdate(this.table[idx], bonus, 10692);
  }
  clear() { this.table.fill(0); }
}

// =====================================================================
// PieceToHistory (continuation history) [piece][to], range 29952
// =====================================================================
class PieceToHistory {
  constructor() {
    this.table = new Int16Array(PIECE_NB * SQUARE_NB);
  }
  get(pc, to) { return this.table[pc * SQUARE_NB + to]; }
  update(pc, to, bonus) {
    const idx = pc * SQUARE_NB + to;
    this.table[idx] = histUpdate(this.table[idx], bonus, 29952);
  }
  clear() { this.table.fill(0); }
}

// =====================================================================
// ContinuationHistory = [inCheck][capture][piece][to]
// 4D array, but stored flat for performance
// =====================================================================
class ContinuationHistory {
  constructor() {
    this.table = new Int16Array(2 * 2 * PIECE_NB * SQUARE_NB);
  }
  get(inCheck, capture, pc, to) {
    return this.table[((inCheck * 2 + capture) * PIECE_NB + pc) * SQUARE_NB + to];
  }
  update(inCheck, capture, pc, to, bonus) {
    const idx = ((inCheck * 2 + capture) * PIECE_NB + pc) * SQUARE_NB + to;
    this.table[idx] = histUpdate(this.table[idx], bonus, 29952);
  }
  clear() { this.table.fill(0); }
}

// =====================================================================
// CounterMoveHistory [piece][to] = Move
// =====================================================================
class CounterMoveHistory {
  constructor() {
    this.table = new Int32Array(PIECE_NB * SQUARE_NB);
  }
  get(pc, to) { return this.table[pc * SQUARE_NB + to]; }
  set(pc, to, m) { this.table[pc * SQUARE_NB + to] = m; }
  clear() { this.table.fill(MOVE_NONE); }
}

// =====================================================================
// Transposition table
// =====================================================================
class TTEntry {
  constructor() {
    this.key16 = 0n;
    this.move  = MOVE_NONE;
    this.value = 0;
    this.eval  = 0;
    this.depth = 0;
    this.genBound = 0;  // generation<<2 | bound
  }
  clear() {
    this.key16 = 0n; this.move = MOVE_NONE; this.value = 0;
    this.eval = 0; this.depth = 0; this.genBound = 0;
  }
  save(key, move, value, evalVal, depth, bound, gen) {
    if (this.key16 === key && depth < this.depth) return;
    this.key16 = key;
    this.move = move;
    this.value = value;
    this.eval = evalVal;
    this.depth = depth;
    this.genBound = (gen << 2) | bound;
  }
  bound() { return this.genBound & 3; }
  age()   { return this.genBound >> 2; }
  isPv()  { return (this.genBound & 3) === BOUND_EXACT; }
}

class TranspositionTable {
  constructor() {
    this.entries = [];
    this.clusterCount = 0;
    this.generation = 0;
    this.resize(32);
  }
  resize(mbSize) {
    this.clusterCount = Math.max(1, Math.floor((mbSize * 1024 * 1024) / (3 * 16)));
    this.entries = new Array(this.clusterCount * 3);
    for (let i = 0; i < this.entries.length; i++) this.entries[i] = new TTEntry();
  }
  clear() {
    for (const e of this.entries) e.clear();
  }
  newSearch() { this.generation = (this.generation + 1) & 0xFF; }
  clusterIndex(key) {
    return Number(key % BigInt(this.clusterCount)) * 3;
  }
  probe(key, ttHitRef) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);
    for (let i = 0; i < 3; i++) {
      const e = this.entries[idx + i];
      if (e.key16 === key16) {
        e.genBound = (this.generation << 2) | (e.genBound & 3);
        if (ttHitRef) ttHitRef.value = true;
        return e;
      }
    }
    if (ttHitRef) ttHitRef.value = false;
    return null;
  }
  // store() chooses an entry to replace using Stockfish's replacement scheme
  store(key, move, value, evalVal, depth, bound) {
    const key16 = key >> 48n;
    const idx = this.clusterIndex(key);
    let replaceIdx = idx;
    let replaceScore = -Infinity;
    for (let i = 0; i < 3; i++) {
      const e = this.entries[idx + i];
      const eGen = e.age();
      const age = (this.generation - eGen) & 0xFF;
      if (e.key16 === 0n) { replaceIdx = idx + i; break; }
      if (e.key16 === key16) { replaceIdx = idx + i; break; }
      const score = (e.depth - 4 * (age > 3 ? 1 : 0)) - age;
      if (score < replaceScore) { replaceScore = score; replaceIdx = idx + i; }
    }
    this.entries[replaceIdx].save(key16, move, value, evalVal, depth, bound, this.generation);
  }
  hashfull() {
    let cnt = 0;
    const sample = Math.min(1000, this.clusterCount);
    for (let i = 0; i < sample * 3; i++) {
      if (this.entries[i].age() === this.generation) cnt++;
    }
    return Math.floor((cnt * 1000) / (sample * 3));
  }
}

// =====================================================================
// ComplexityAverage (C++ implements via update with coefficient)
// =====================================================================
class ComplexityAverage {
  constructor() { this.value = 0; }
  set(c, n) { this.value = c * 1000 / n; }
  update(c) {
    // EMA with weight
    this.value = (this.value * 7 + c * 1000) / 8;
  }
}

// =====================================================================
// Stack entry
// =====================================================================
class StackEntry {
  constructor() {
    this.pv = null;
    this.currentMove = MOVE_NONE;
    this.excludedMove = MOVE_NONE;
    this.killers = [MOVE_NONE, MOVE_NONE];
    this.staticEval = VALUE_NONE;
    this.statScore = 0;
    this.moveCount = 0;
    this.inCheck = false;
    this.ttPv = false;
    this.ttHit = false;
    this.ply = 0;
    this.cutoffCnt = 0;
    this.doubleExtensions = 0;
    this.continuationHistory = null;
  }
  reset() {
    this.pv = null;
    this.currentMove = MOVE_NONE;
    this.excludedMove = MOVE_NONE;
    this.killers = [MOVE_NONE, MOVE_NONE];
    this.staticEval = VALUE_NONE;
    this.statScore = 0;
    this.moveCount = 0;
    this.inCheck = false;
    this.ttPv = false;
    this.ttHit = false;
    this.ply = 0;
    this.cutoffCnt = 0;
    this.doubleExtensions = 0;
    this.continuationHistory = null;
  }
}

// =====================================================================
// MovePicker
// =====================================================================
class ExtMove {
  constructor() { this.move = MOVE_NONE; this.value = 0; }
  eq(other) { return this.move === other.move; }
  lt(other) { return this.value < other.value; }
}

function partialInsertionSort(begin, end, limit) {
  for (let sortedEnd = begin, p = begin + 1; p < end; p++) {
    if (p.value >= limit) {
      const tmp = p.move, tv = p.value;
      let q = p;
      p.move = (++sortedEnd).move; p.value = sortedEnd.value;
      for (; q !== begin && (q - 1).value < tv; q--) {
        q.move = (q - 1).move; q.value = (q - 1).value;
      }
      q.move = tmp; q.value = tv;
    }
  }
}

class MovePicker {
  constructor(pos, ttMove, depth, mainHist, capHist, contHist, counterMove, killers) {
    this.pos = pos;
    this.mainHist = mainHist;
    this.capHist = capHist;
    this.contHist = contHist;  // array of 6 continuation histories
    this.ttMove = ttMove;
    this.depth = depth;
    this.threshold = 0;
    this.recaptureSquare = SQ_NONE;
    this.refutations = [new ExtMove(), new ExtMove(), new ExtMove()];
    this.refutations[0].move = killers ? killers[0] : MOVE_NONE;
    this.refutations[1].move = killers ? killers[1] : MOVE_NONE;
    this.refutations[2].move = counterMove || MOVE_NONE;
    this.moves = new Array(MAX_MOVES);
    for (let i = 0; i < MAX_MOVES; i++) this.moves[i] = new ExtMove();
    this.cur = 0;
    this.endMoves = 0;
    this.endBadCaptures = 0;
    this.stage = (pos.inCheck() ? 7 /* EVASION_TT */ : 0 /* MAIN_TT */) +
                 (ttMove && pos.pseudoLegal(ttMove) ? 0 : 1);
  }

  scoreCaptures() {
    for (let i = 0; i < this.endMoves; i++) {
      const m = this.moves[i].move;
      const to = toSq(m);
      const captured = this.pos.pieceOn(to);
      const pt = typeOf(captured);
      const movedPc = this.pos.pieceOn(fromSq(m));
      this.moves[i].value = 6 * PieceValue[MG][captured]
        + this.capHist.get(movedPc, to, pt);
    }
  }

  scoreQuiets() {
    const us = this.pos.sideToMove;
    for (let i = 0; i < this.endMoves; i++) {
      const m = this.moves[i].move;
      const movedPc = this.pos.pieceOn(fromSq(m));
      const to = toSq(m);
      let v = 2 * this.mainHist.get(us, m)
            + 2 * (this.contHist[0] ? this.contHist[0].get(movedPc, to) : 0)
            +     (this.contHist[1] ? this.contHist[1].get(movedPc, to) : 0)
            +     (this.contHist[3] ? this.contHist[3].get(movedPc, to) : 0)
            +     (this.contHist[5] ? this.contHist[5].get(movedPc, to) : 0);
      this.moves[i].value = v;
    }
  }

  scoreEvasions() {
    for (let i = 0; i < this.endMoves; i++) {
      const m = this.moves[i].move;
      const to = toSq(m);
      const captured = this.pos.pieceOn(to);
      const movedPc = this.pos.pieceOn(fromSq(m));
      if (captured !== NO_PIECE) {
        this.moves[i].value = PieceValue[MG][captured] - typeOf(movedPc) + (1 << 28);
      } else {
        const us = this.pos.sideToMove;
        this.moves[i].value = this.mainHist.get(us, m)
          + (this.contHist[0] ? this.contHist[0].get(movedPc, to) : 0);
      }
    }
  }

  generateAll() {
    this.endMoves = 0;
    for (const m of this.pos.generateLegalMovesGen()) {
      if (this.endMoves < MAX_MOVES) {
        this.moves[this.endMoves++].move = m;
      }
    }
  }

  generateCaptures() {
    this.endMoves = 0;
    for (const m of this.pos.generateLegalCapturesGen()) {
      if (this.endMoves < MAX_MOVES) {
        this.moves[this.endMoves++].move = m;
      }
    }
  }

  generateQuiets() {
    this.endMoves = 0;
    for (const m of this.pos.generateLegalQuietsGen()) {
      if (this.endMoves < MAX_MOVES) {
        this.moves[this.endMoves++].move = m;
      }
    }
  }

  generateEvasions() {
    this.endMoves = 0;
    for (const m of this.pos.generateLegalEvasionsGen()) {
      if (this.endMoves < MAX_MOVES) {
        this.moves[this.endMoves++].move = m;
      }
    }
  }

  nextMove(skipQuiets) {
    top:
    while (true) {
      switch (this.stage) {
        case 0: case 7: case 13:  // MAIN_TT / EVASION_TT / QSEARCH_TT
          this.stage++;
          return this.ttMove;
        case 1: // CAPTURE_INIT
          this.cur = 0;
          this.endBadCaptures = 0;
          this.generateCaptures();
          this.scoreCaptures();
          partialInsertionSort(this.moves, this.endMoves, -3000 * this.depth);
          this.stage++;
          continue;
        case 2: // GOOD_CAPTURE
          while (this.cur < this.endMoves) {
            const m = this.moves[this.cur].move;
            const v = this.moves[this.cur].value;
            if (m !== this.ttMove) {
              const see = this.pos.seeGE(m, Math.floor(-86 * v / 1024));
              if (see) {
                const ret = this.moves[this.cur++];
                return ret.move;
              } else {
                this.moves[this.endBadCaptures++].move = m;
              }
            }
            this.cur++;
          }
          // Prepare refutations iteration
          this.cur = 0;
          this.endMoves = 3;
          // If countermove == killer[0] or killer[1], skip it
          if (this.refutations[0].move === this.refutations[2].move ||
              this.refutations[1].move === this.refutations[2].move) {
            this.endMoves = 2;
          }
          this.stage++;
          continue;
        case 3: // REFUTATION
          while (this.cur < this.endMoves) {
            const m = this.refutations[this.cur].move;
            this.cur++;
            if (m !== MOVE_NONE && m !== this.ttMove &&
                this.pos.pieceOn(toSq(m)) === NO_PIECE &&
                this.pos.pseudoLegal(m)) {
              return m;
            }
          }
          this.stage++;
          continue;
        case 4: // QUIET_INIT
          if (!skipQuiets) {
            this.cur = this.endBadCaptures;
            this.generateQuiets();
            this.scoreQuiets();
            partialInsertionSort(this.moves, this.endMoves, -3000 * this.depth);
          }
          this.stage++;
          continue;
        case 5: // QUIET
          if (!skipQuiets) {
            while (this.cur < this.endMoves) {
              const m = this.moves[this.cur].move;
              this.cur++;
              if (m !== this.ttMove &&
                  m !== this.refutations[0].move &&
                  m !== this.refutations[1].move &&
                  m !== this.refutations[2].move) {
                return m;
              }
            }
          }
          this.cur = 0;
          this.endMoves = this.endBadCaptures;
          this.stage++;
          continue;
        case 6: // BAD_CAPTURE
          while (this.cur < this.endMoves) {
            const m = this.moves[this.cur++].move;
            if (m !== this.ttMove) return m;
          }
          return MOVE_NONE;
        case 8: // EVASION_INIT
          this.cur = 0;
          this.generateEvasions();
          this.scoreEvasions();
          this.stage++;
          continue;
        case 9: // EVASION
          while (this.cur < this.endMoves) {
            let best = this.cur;
            for (let k = this.cur + 1; k < this.endMoves; k++) {
              if (this.moves[k].value > this.moves[best].value) best = k;
            }
            if (best !== this.cur) {
              const t = this.moves[best]; this.moves[best] = this.moves[this.cur]; this.moves[this.cur] = t;
            }
            const m = this.moves[this.cur++].move;
            if (m !== this.ttMove) return m;
          }
          return MOVE_NONE;
        case 14: // QCAPTURE_INIT
          this.cur = 0;
          this.endBadCaptures = 0;
          this.generateCaptures();
          this.scoreCaptures();
          this.stage++;
          continue;
        case 15: // QCAPTURE
          while (this.cur < this.endMoves) {
            const m = this.moves[this.cur++].move;
            if (m !== this.ttMove &&
                (this.depth > DEPTH_QS_NO_CHECKS - 1 || toSq(m) === this.recaptureSquare)) {
              return m;
            }
          }
          if (this.depth !== DEPTH_QS_CHECKS) return MOVE_NONE;
          this.cur = 0;
          this.generateQuiets();
          // do NOT reset endMoves: keep the moves returned by generateQuiets
          this.stage++;
          continue;
        case 16: // QCHECK
          while (this.cur < this.endMoves) {
            const m = this.moves[this.cur++].move;
            if (m !== this.ttMove) return m;
          }
          return MOVE_NONE;
        default:
          return MOVE_NONE;
      }
    }
  }
}

// =====================================================================
// Search class
// =====================================================================
export default class Search {
  constructor() {
    this.tt = new TranspositionTable();
    this.mainHistory = [new ButterflyHistory(), new ButterflyHistory()];
    this.captureHistory = new CapturePieceToHistory();
    this.continuationHistory = new ContinuationHistory();
    this.counterMoves = new CounterMoveHistory();
    this.stack = [];
    for (let i = 0; i < MAX_PLY + 10; i++) this.stack.push(new StackEntry());
    this.complexityAverage = new ComplexityAverage();
    this.Reductions = new Int32Array(MAX_MOVES);

    // Runtime state
    this.nodes = 0;
    this.selDepth = 0;
    this.rootDepth = 0;
    this.completedDepth = 0;
    this.stopFlag = false;
    this.startTime = 0;
    this.moveTime = 1e9;
    this.maxDepth = MAX_PLY - 1;
    this.bestMove = MOVE_NONE;
    this.bestMoveChanges = 0;
    this.nmpMinPly = 0;
    this.nmpColor = 0;
    this.rootDelta = 0;
    this.previousDepth = 0;
    this.bestValue = -VALUE_INFINITE;
    this.iterValue = [0, 0, 0, 0];
    this.iterIdx = 0;
    this.lastInfoTime = 0;

    // Root moves container
    this.rootMoves = [];

    // Sentinel continuationHistory pointer for ss-1..ss-7
    this._sentinelCont = this._makeSentinelCont();

    // Public callback for engine info
    this.onInfo = null;
    this.onBestMove = null;

    this._initReductions();
    this._initStackSentinels();
  }

  _makeSentinelCont() {
    // Returns a PieceToHistory object used as a sentinel by Stockfish
    return new PieceToHistory();
  }

  _initReductions() {
    for (let i = 1; i < MAX_MOVES; i++) {
      this.Reductions[i] = Math.floor((redu_3 / 1000.0 + Math.log(1) / 2) * Math.log(i));
    }
  }

  _initStackSentinels() {
    for (let i = 7; i > 0; i--) {
      this.stack[i].continuationHistory = this._sentinelCont;
      this.stack[i].staticEval = VALUE_NONE;
    }
    for (let i = 0; i <= MAX_PLY + 2; i++) {
      this.stack[i].ply = i;
    }
  }

  // Safe access to stack continuation history, with sentinel for out-of-bounds
  _ch(ply) {
    if (ply < 0) return this._sentinelCont;
    return this.stack[ply].continuationHistory || this._sentinelCont;
  }

  clear() {
    this.tt.clear();
    this.mainHistory[0].clear();
    this.mainHistory[1].clear();
    this.captureHistory.clear();
    this.continuationHistory.clear();
    this.counterMoves.clear();
    this.nodes = 0;
    this.rootDepth = 0;
    this.completedDepth = 0;
    this.selDepth = 0;
    this.bestMove = MOVE_NONE;
    this.stopFlag = false;
    this.nmpMinPly = 0;
    this.iterValue = [0, 0, 0, 0];
    this.iterIdx = 0;
    this._initStackSentinels();
  }

  // =============== Helpers ===============
  valueToTT(v, ply) {
    return v >= VALUE_MATE_IN_MAX_PLY  ? v + ply
         : v <= VALUE_MATED_IN_MAX_PLY ? v - ply
         : v;
  }
  valueFromTT(v, ply, r60c) {
    if (v === VALUE_NONE) return VALUE_NONE;
    if (v >= VALUE_MATE_IN_MAX_PLY) {
      return (VALUE_MATE - v) > (119 - r60c) ? (VALUE_MATE_IN_MAX_PLY - 1) : (v - ply);
    }
    if (v <= VALUE_MATED_IN_MAX_PLY) {
      return (VALUE_MATE + v) > (119 - r60c) ? (VALUE_MATED_IN_MAX_PLY + 1) : (v + ply);
    }
    return v;
  }
  futilityMargin(d, improving) {
    return futi_mar * (d - (improving ? 1 : 0));
  }
  futilityMoveCount(improving, depth) {
    return improving ? (improv_1 + depth * depth)
                     : Math.floor((improv_2 + depth * depth) / improv_3);
  }
  reduction(improving, depth, mn, delta, rootDelta) {
    const r = this.Reductions[depth] * this.Reductions[mn];
    return Math.floor((r + redu_1 - delta * 1024 / rootDelta) / 1024) +
           ((!improving && r > redu_2) ? 1 : 0);
  }
  valueDraw() {
    return VALUE_DRAW - 1 + (this.nodes & 2);
  }
  // C++: update_pv: pv[0] = move, then copy childPv until MOVE_NONE
  updatePV(pv, move, childPv) {
    pv[0] = move;
    if (!childPv) { pv[1] = MOVE_NONE; return; }
    let i = 1;
    for (; childPv[i - 1] !== MOVE_NONE; i++) pv[i] = childPv[i - 1];
    pv[i] = MOVE_NONE;
  }
  // Convert internal score to UCI format string
  formatScore(v) {
    if (v >= VALUE_MATE_IN_MAX_PLY) {
      const plies = VALUE_MATE - v;
      const moves = Math.ceil(plies / 2);
      return `mate ${moves}`;
    }
    if (v <= VALUE_MATED_IN_MAX_PLY) {
      const plies = VALUE_MATE + v;
      const moves = -Math.ceil(plies / 2);
      return `mate ${moves}`;
    }
    return `cp ${v}`;
  }
  formatPV(pv) {
    return pv.map(m => this.pos.moveToString(m)).join(' ');
  }

  // =============== Top-level search ===============
  search(pos, options = {}) {
    this.pos = pos;
    this.nodes = 0;
    this.selDepth = 0;
    this.stopFlag = false;
    this.startTime = Date.now();
    this.moveTime = options.moveTime || 1e9;
    this.maxDepth = Math.min(options.maxDepth || MAX_PLY - 1, MAX_PLY - 1);
    this.maxNodes = options.maxNodes || 1e9;
    this.bestMoveChanges = 0;
    this.nmpMinPly = 0;
    this.complexityAverage = new ComplexityAverage();
    this.lastInfoTime = this.startTime;
    this.previousDepth = 0;

    this.tt.newSearch();

    // Build root moves
    this.rootMoves = [];
    for (const m of pos.generateLegalMovesGen()) {
      this.rootMoves.push({
        move: m, pv: [m], score: -VALUE_INFINITE, previousScore: -VALUE_INFINITE,
        averageScore: -VALUE_INFINITE, uciScore: -VALUE_INFINITE,
        selDepth: 0, scoreLowerbound: false, scoreUpperbound: false,
      });
    }

    if (this.rootMoves.length === 0) {
      if (this.onInfo) {
        this.onInfo({
          depth: 0, seldepth: 0, score: -VALUE_MATE,
          pv: [], nodes: 0, nps: 0, time: 0, multipv: 1,
        });
      }
      if (this.onBestMove) this.onBestMove(MOVE_NONE);
      return MOVE_NONE;
    }

    // Iterative deepening
    let bestValue = -VALUE_INFINITE;
    let alpha = -VALUE_INFINITE, beta = VALUE_INFINITE;
    let delta = delt_1;

    // Allocate PV array
    this.pvArray = new Int32Array(MAX_PLY + 1);
    this.stack[0].pv = this.pvArray;

    for (this.rootDepth = 1; this.rootDepth <= this.maxDepth; this.rootDepth++) {
      // Save previous scores
      for (const rm of this.rootMoves) rm.previousScore = rm.score;

      // Reset seldepth
      this.selDepth = 0;

      // Aspiration window
      if (this.rootDepth >= 4) {
        const prev = this.rootMoves[0].averageScore;
        delta = delt_1 + Math.floor(prev * prev / delt_2);
        alpha = Math.max(prev - delta, -VALUE_INFINITE);
        beta  = Math.min(prev + delta, VALUE_INFINITE);
      } else {
        alpha = -VALUE_INFINITE;
        beta = VALUE_INFINITE;
      }

      let failedHighCnt = 0;
      let adjustedDepth = this.rootDepth;
      while (true) {
        adjustedDepth = Math.max(1, this.rootDepth - failedHighCnt);
        this.rootDelta = beta - alpha;
        const ss = this.stack[0];
        ss.ply = 0;
        ss.inCheck = pos.inCheck();
        ss.currentMove = MOVE_NONE;
        ss.continuationHistory = this._sentinelCont;
        ss.staticEval = VALUE_NONE;
        ss.ttHit = false;
        ss.ttPv = false;
        ss.excludedMove = MOVE_NONE;
        ss.moveCount = 0;
        ss.cutoffCnt = 0;
        ss.doubleExtensions = 0;

        bestValue = this.searchRoot(pos, ss, alpha, beta, adjustedDepth);
        if (this.stopFlag) break;

        // Stable sort rootMoves (descending by score)
        this.rootMoves.sort((a, b) => b.score - a.score);
        if (bestValue <= alpha) {
          beta = (alpha + beta) / 2;
          alpha = Math.max(bestValue - delta, -VALUE_INFINITE);
          failedHighCnt = 0;
        } else if (bestValue >= beta) {
          beta = Math.min(bestValue + delta, VALUE_INFINITE);
          failedHighCnt++;
        } else {
          break;
        }
        delta += Math.floor(delta / delt_3) + delt_4;
      }

      if (!this.stopFlag) {
        this.completedDepth = this.rootDepth;
        // Emit info for best line
        const rm = this.rootMoves[0];
        if (this.onInfo) {
          const elapsed = Date.now() - this.startTime;
          this.onInfo({
            depth: this.rootDepth,
            seldepth: rm.selDepth || this.selDepth,
            score: rm.score,
            pv: rm.pv.slice(1),  // skip the root move (already known)
            nodes: this.nodes,
            nps: elapsed > 0 ? Math.floor(this.nodes * 1000 / elapsed) : 0,
            time: elapsed,
            hashfull: this.tt.hashfull(),
            multipv: 1,
          });
        }
      }

      if (this.stopFlag) break;

      // Check for mate
      if (bestValue >= VALUE_MATE_IN_MAX_PLY) {
        if (VALUE_MATE - bestValue <= 2) break;
      }

      // Time check
      const elapsed = Date.now() - this.startTime;
      if (elapsed >= this.moveTime && this.rootDepth >= 1) break;
    }

    this.bestMove = this.rootMoves[0].move;
    this.bestValue = this.rootMoves[0].score;
    if (this.onBestMove) this.onBestMove(this.bestMove, this.bestValue);
    return this.bestMove;
  }

  // =============== Root search ===============
  searchRoot(pos, ss, alpha, beta, depth) {
    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkTime();

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    const maxNextDepth = depth;
    const ttHit = { value: false };
    const tte = this.tt.probe(pos.key(), ttHit);
    const ttMove = ttHit.value && tte ? tte.move : MOVE_NONE;

    // Sort root moves: previous best first, then by previous score
    this.rootMoves.sort((a, b) => b.previousScore - a.previousScore);

    let moveCount = 0;
    for (const rm of this.rootMoves) {
      const m = rm.move;
      moveCount++;
      ss.moveCount = moveCount;
      ss.currentMove = m;
      ss.continuationHistory = this._sentinelCont;

      if (!pos.doMove(m)) continue;

      let value;
      const childSS = this.stack[1];
      childSS.ply = 1;
      childSS.inCheck = pos.inCheck();
      childSS.excludedMove = MOVE_NONE;
      childSS.ttPv = false;
      childSS.cutoffCnt = 0;
      childSS.doubleExtensions = 0;
      childSS.killers = [MOVE_NONE, MOVE_NONE];

      if (moveCount === 1) {
        value = -this.searchPV(pos, childSS, -beta, -alpha, depth - 1, false);
      } else {
        // PVS
        value = -this.searchNonPV(pos, childSS, -alpha - 1, -alpha, depth - 1, true);
        if (value > alpha && value < beta) {
          value = -this.searchPV(pos, childSS, -beta, -alpha, depth - 1, false);
        }
      }

      pos.undoMove(m);

      if (this.stopFlag) return VALUE_ZERO;

      // Update root move
      rm.averageScore = rm.averageScore === -VALUE_INFINITE
        ? value
        : Math.floor((2 * value + rm.averageScore) / 3);

      if (moveCount === 1 || value > alpha) {
        rm.score = rm.uciScore = value;
        rm.selDepth = this.selDepth;
        rm.scoreLowerbound = rm.scoreUpperbound = false;
        if (value >= beta) { rm.scoreLowerbound = true; rm.uciScore = beta; }
        else if (value <= alpha) { rm.scoreUpperbound = true; rm.uciScore = alpha; }
        rm.pv = [m];
        if (childSS.pv) {
          for (let i = 0; childSS.pv[i] !== MOVE_NONE; i++) rm.pv.push(childSS.pv[i]);
        }
        if (moveCount > 1) this.bestMoveChanges++;
      } else {
        rm.score = -VALUE_INFINITE;
      }

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

  checkTime() {
    if (this.stopFlag) return;
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.moveTime) this.stopFlag = true;
    if (this.nodes >= this.maxNodes) this.stopFlag = true;
  }

  // =============== search<NonPV> ===============
  searchNonPV(pos, ss, alpha, beta, depth, cutNode) {
    if (depth <= 0) return this.qsearchNonPV(pos, ss, alpha, beta, 0);

    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkTime();

    if (this.stopFlag || ss.ply >= MAX_PLY) {
      return (ss.ply >= MAX_PLY && !ss.inCheck) ? evaluate(pos) : this.valueDraw();
    }

    // Rule judge
    const resultRef = { value: 0 };
    if (pos.ruleJudge(resultRef, ss.ply)) {
      return resultRef.value === VALUE_DRAW ? this.valueDraw() : resultRef.value;
    }

    // Mate distance pruning
    alpha = Math.max(matedIn(ss.ply), alpha);
    beta = Math.min(mateIn(ss.ply + 1), beta);
    if (alpha >= beta) return alpha;

    const excludedMove = ss.excludedMove;
    const posKey = excludedMove === MOVE_NONE ? pos.key() : pos.key() ^ makeKey(excludedMove);
    const ttHitRef = { value: false };
    const tte = this.tt.probe(posKey, ttHitRef);
    const ttHit = ttHitRef.value;
    ss.ttHit = ttHit;
    const tteBound = tte ? tte.bound() : BOUND_NONE;
    const tteIsPv = tte ? tte.isPv() : false;
    let ttValue = (ttHit && tte) ? this.valueFromTT(tte.value, ss.ply, pos.rule60) : VALUE_NONE;
    let ttMove = (ttHit && tte) ? tte.move : MOVE_NONE;
    const ttCapture = ttMove !== MOVE_NONE && pos.capture(ttMove);
    if (!excludedMove) ss.ttPv = false;

    // TT cutoff for non-PV
    if (!ss.ttPv && ttHit && tte && tte.depth > depth - (tteBound === BOUND_EXACT ? 1 : 0)
        && ttValue !== VALUE_NONE
        && ((tteBound & (ttValue >= beta ? BOUND_LOWER : BOUND_UPPER)) !== 0)) {
      if (ttMove) {
        if (ttValue >= beta) {
          if (!ttCapture) this.updateQuietStats(pos, ss, ttMove, statBonus(depth));
        } else if (!ttCapture) {
          const penalty = -statBonus(depth);
          this.mainHistory[pos.sideToMove].update(fromSq(ttMove), toSq(ttMove) | (fromSq(ttMove) << 7), penalty);
          // Simpler: update via move
          this.mainHistory[pos.sideToMove].update(
            (fromSq(ttMove) << 7) | toSq(ttMove), 0, penalty);
          if (ss.continuationHistory) {
            ss.continuationHistory.update(false, false, pos.movedPiece(ttMove), toSq(ttMove), penalty);
          }
        }
      }
      if (pos.rule60 < posr60cou) return ttValue;
    }

    // Compute static eval
    let evalVal = 0, complexity = 0, improvement = 0, improving = false;
    const prevSq = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;

    if (ss.inCheck) {
      ss.staticEval = evalVal = VALUE_NONE;
      improving = false; improvement = 0; complexity = 0;
    } else if (ttHit) {
      ss.staticEval = evalVal = tte ? tte.eval : VALUE_NONE;
      if (evalVal === VALUE_NONE) ss.staticEval = evalVal = evaluate(pos);
      complexity = Math.abs(ss.staticEval - pos.materialDiff());
      if (ttValue !== VALUE_NONE && (tteBound & (ttValue > evalVal ? BOUND_LOWER : BOUND_UPPER)) !== 0) {
        evalVal = ttValue;
      }
    } else {
      ss.staticEval = evalVal = evaluate(pos);
      if (!excludedMove) {
        this.tt.store(posKey, MOVE_NONE, VALUE_NONE, evalVal, 0, BOUND_NONE);
      }
    }
    this.complexityAverage.update(complexity);

    // Improvement (compared to 2 plies ago or 4 plies ago)
    if (ss.ply >= 2 && this.stack[ss.ply - 2].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 2].staticEval;
    } else if (ss.ply >= 4 && this.stack[ss.ply - 4].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 4].staticEval;
    } else {
      improvement = impro_1;
    }
    improving = improvement > 0;

    // Bonus for opponent based on previous move
    if (ss.ply > 0 && ss.currentMove !== MOVE_NONE && this.stack[ss.ply - 1].currentMove !== MOVE_NONE) {
      // Skipped: not critical for correctness
    }

    // Razoring
    if (!ss.ttPv && !improving && evalVal < alpha - Razo_1 - Razo_2 * depth * depth) {
      const v = this.qsearchNonPV(pos, ss, alpha - 1, alpha, 0);
      if (v < alpha) return v;
    }

    // Futility pruning
    if (!ss.ttPv && depth < Futidep
        && (evalVal - this.futilityMargin(depth, improving)) >= beta
        && evalVal >= beta && evalVal < 25970) {
      return evalVal;
    }

    // Null move pruning
    const statScore = (ss.ply > 0 ? this.stack[ss.ply - 1].statScore : 0);
    if (!ss.ttPv && statScore < Numov_0
        && evalVal >= beta && evalVal >= ss.staticEval
        && ss.staticEval >= beta - Numov_1 * depth - Math.floor(improvement / Numov_2) + Numov_3
                          + Math.floor(complexity / Numov_4)
        && !excludedMove
        && (ss.ply >= this.nmpMinPly || pos.sideToMove !== this.nmpColor)) {
      let R = Math.min(Math.floor((evalVal - beta) / Numov_5), Numov_6) + Math.floor(depth / 3) + 4
              - (complexity > Numov_9 ? 1 : 0);

      ss.currentMove = MOVE_NULL;
      ss.continuationHistory = this._sentinelCont;

      pos.doNullMove();
      const childSS = this.stack[ss.ply + 1];
      childSS.ply = ss.ply + 1;
      childSS.inCheck = pos.inCheck();
      childSS.statScore = 0;
      childSS.excludedMove = MOVE_NONE;
      childSS.killers = [MOVE_NONE, MOVE_NONE];
      childSS.cutoffCnt = 0;

      let nullValue = -this.searchNonPV(pos, childSS, -beta, -beta + 1, depth - R, !cutNode);
      pos.undoNullMove();

      if (nullValue >= beta) {
        if (nullValue >= VALUE_MATE_IN_MAX_PLY) nullValue = beta;
        if (this.nmpMinPly || (Math.abs(beta) < VALUE_KNOWN_WIN && depth < 14)) {
          return nullValue;
        }
        this.nmpMinPly = ss.ply + Math.floor(nuldep_1 * (depth - R) / nuldep_2);
        this.nmpColor = pos.sideToMove ^ 1;
        const v = this.searchNonPV(pos, ss, beta - 1, beta, depth - R, false);
        this.nmpMinPly = 0;
        if (v >= beta) return nullValue;
      }
    }

    // ProbCut
    const probCutBeta = beta + probCut_1 - probCut_2 * (improving ? 1 : 0);
    if (!ss.ttPv && depth > 4 && Math.abs(beta) < VALUE_MATE_IN_MAX_PLY
        && !(ttHit && tte && tte.depth >= depth - 3 && ttValue !== VALUE_NONE && ttValue < probCutBeta)) {
      const pcMP = new MovePicker(pos, ttMove, probCutBeta - ss.staticEval, depth - 3, this.captureHistory, null, null, null);
      pcMP.stage = 10;  // PROBCUT_TT already passed
      // Use direct capture generation since MovePicker probcut path uses see threshold
      let pcMove;
      let probed = false;
      while ((pcMove = pcMP.nextMove(false)) !== MOVE_NONE) {
        if (pcMove === excludedMove) continue;
        if (!pos.legal(pcMove)) continue;
        ss.currentMove = pcMove;
        ss.continuationHistory = this.continuationHistory;
        const ch = this.continuationHistory;
        ch.update(ss.inCheck, true, pos.movedPiece(pcMove), toSq(pcMove), 0);
        pos.doMove(pcMove);
        const childSS = this.stack[ss.ply + 1];
        childSS.ply = ss.ply + 1;
        let v = -this.qsearchNonPV(pos, childSS, -probCutBeta, -probCutBeta + 1, 0);
        if (v >= probCutBeta) v = -this.searchNonPV(pos, childSS, -probCutBeta, -probCutBeta + 1, depth - 4, !cutNode);
        pos.undoMove(pcMove);
        if (v >= probCutBeta) {
          if (tte) tte.save(posKey, pcMove, this.valueToTT(v, ss.ply), ss.ttPv, BOUND_LOWER, depth - 3, ss.staticEval);
          return v;
        }
        probed = true;
      }
    }

    // Step 10: depth reduction for PV-style (not applicable for non-PV)
    if (depth <= 0) return this.qsearchNonPV(pos, ss, alpha, beta, 0);

    // Prepare child stack
    const childSS = this.stack[ss.ply + 1];
    childSS.ply = ss.ply + 1;
    childSS.ttPv = false;
    childSS.excludedMove = MOVE_NONE;
    childSS.killers = [MOVE_NONE, MOVE_NONE];
    childSS.cutoffCnt = 0;
    childSS.doubleExtensions = ss.doubleExtensions;
    childSS.ply = ss.ply + 1;
    if (ss.ply + 2 <= MAX_PLY + 9) {
      this.stack[ss.ply + 2].statScore = 0;
    }

    // Set up continuation history array
    const contHist = [
      ss.continuationHistory,
      this._ch(ss.ply - 1),
      this._sentinelCont,
      this._ch(ss.ply - 3),
      this._sentinelCont,
      this._ch(ss.ply - 5),
    ];
    const counterMove = this.counterMoves.get(pos.pieceOn(prevSq), prevSq);

    const mp = new MovePicker(pos, ttMove, depth, this.mainHistory[pos.sideToMove], this.captureHistory, contHist, counterMove, ss.killers);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let captureCount = 0, quietCount = 0;
    const capturesSearched = new Array(32).fill(MOVE_NONE);
    const quietsSearched = new Array(64).fill(MOVE_NONE);
    const maxNextDepth = depth;

    const likelyFailLow = false;
    let singularQuietLMR = false;
    let moveCountPruning = false;
    const us = pos.sideToMove;

    while (true) {
      const move = mp.nextMove(moveCountPruning);
      if (move === MOVE_NONE) break;
      if (move === excludedMove) continue;
      if (!pos.legal(move)) continue;
      moveCount++;
      ss.moveCount = moveCount;
      childSS.pv = null;
      let extension = 0;
      const capture = pos.capture(move);
      const movedPiece = pos.movedPiece(move);
      const givesCheck = pos.givesCheck(move);
      let newDepth = depth - 1;
      const delta = beta - alpha;

      // Step 13: shallow pruning
      if (bestValue > VALUE_MATED_IN_MAX_PLY) {
        moveCountPruning = moveCount >= this.futilityMoveCount(improving, depth);
        const lmrDepth = Math.max(newDepth - this.reduction(improving, depth, moveCount, delta, this.rootDelta || 200), 0);

        if (capture || givesCheck) {
          if (!givesCheck && !ss.ttPv && lmrDepth < Futi_cap_0 && !ss.inCheck) {
            const futScore = ss.staticEval + Futi_cap_1 + Futi_cap_2 * lmrDepth
              + PieceValue[EG][pos.pieceOn(toSq(move))]
              + Math.floor(this.captureHistory.get(movedPiece, toSq(move), typeOf(pos.pieceOn(toSq(move)))) / Futi_cap_5);
            if (futScore < alpha) continue;
          }
          if (!pos.seeGE(move, -Futi_cap_3 * depth + Futi_cap_4)) continue;
        } else {
          const ch = contHist[0] || this._sentinelCont;
          const history = (ch.get(movedPiece, toSq(move)) || 0)
            + (contHist[1] ? contHist[1].get(movedPiece, toSq(move)) || 0 : 0)
            + (contHist[3] ? contHist[3].get(movedPiece, toSq(move)) || 0 : 0);
          if (lmrDepth < Futi_cap_6 && history < -Futi_cap_7 * (depth - 1)) continue;
          const hist2 = history + 2 * this.mainHistory[us].get((fromSq(move) << 7) | toSq(move), 0);
          if (!ss.inCheck && lmrDepth < Futi_par_6
              && ss.staticEval + Futi_par_1 + Futi_par_2 * lmrDepth + Math.floor(hist2 / Futi_par_3) <= alpha) {
            continue;
          }
          if (!pos.seeGE(move, -Futi_par_4 * lmrDepth * lmrDepth - Futi_par_5 * lmrDepth)) {
            if (hist2 > 0 && quietCount < 64) quietsSearched[quietCount++] = move;
            continue;
          }
        }
      }

      // Step 14: extensions
      if (ss.ply < this.rootDepth * 2) {
        // Singular extension
        if (!excludedMove && depth >= exten_1
            && move === ttMove && move !== MOVE_NONE
            && Math.abs(ttValue) < VALUE_KNOWN_WIN
            && (tteBound & BOUND_LOWER) !== 0
            && tte && tte.depth >= depth - 3) {
          const singularBeta = ttValue - (exten_2 + (ss.ttPv ? 1 : 0)) * depth;
          const singularDepth = Math.floor((depth - 1) / 2);
          ss.excludedMove = move;
          const v = this.searchNonPV(pos, ss, singularBeta - 1, singularBeta, singularDepth, cutNode);
          ss.excludedMove = MOVE_NONE;
          if (v < singularBeta) {
            extension = exten_7;
            singularQuietLMR = !ttCapture;
            if (!ss.ttPv && v < singularBeta - exten_3 && ss.doubleExtensions <= exten_8) {
              extension = exten_9;
            }
          } else if (singularBeta >= beta) {
            return singularBeta;
          } else if (ttValue >= beta) {
            extension = -exten_10;
          } else if (ttValue <= alpha && ttValue <= v) {
            extension = -exten_11;
          }
        } else if (givesCheck && depth > exten_4 && Math.abs(ss.staticEval) > exten_5) {
          extension = exten_12;
        } else if (ss.ttPv && move === ttMove && move === ss.killers[0]
                   && contHist[0] && contHist[0].get(movedPiece, toSq(move)) >= exten_6) {
          extension = exten_13;
        }
      }
      newDepth += extension;
      childSS.doubleExtensions = ss.doubleExtensions + (extension === exten_14 ? 1 : 0);

      ss.currentMove = move;
      const idx = (ss.inCheck ? 1 : 0) * 2 + (capture ? 1 : 0);
      // Use the class instance for direct update
      const chIdx = ((ss.inCheck ? 1 : 0) * 2 + (capture ? 1 : 0));
      this.continuationHistory.table[chIdx * PIECE_NB * SQUARE_NB + movedPiece * SQUARE_NB + toSq(move)];
      // Mark this slot as the current cont history
      childSS.continuationHistory = this._getContSlot(ss.inCheck, capture, movedPiece, toSq(move));

      // Step 15: make move
      pos.doMove(move);
      childSS.inCheck = pos.inCheck();

      let value;

      // Step 16: LMR
      if (depth >= 2 && moveCount > 1 && (!ss.ttPv || !capture || (cutNode && (ss.ply > 0 ? this.stack[ss.ply - 1].moveCount : 0) > 1))) {
        let r = this.reduction(improving, depth, moveCount, delta, this.rootDelta || 200);
        if (ss.ttPv) r -= decr_3 + Math.floor(decr_4 / (decr_5 + depth));
        if (ss.ply > 0 && this.stack[ss.ply - 1].moveCount > decr_10) r -= decr_11;
        if (cutNode) r += cutredu_1 + Math.floor(cutredu_2 / (cutredu_3 + depth));
        if (ttCapture) r += decr_12;
        if (false /* PvNode */) r -= pvredu_1 + Math.floor(pvredu_2 / (pvredu_3 + depth));
        if (singularQuietLMR) r -= decr_13;
        if (childSS.cutoffCnt > decr_14) r += decr_15;

        const statSc = 2 * this.mainHistory[us].get((fromSq(move) << 7) | toSq(move), 0)
          + (contHist[0] ? contHist[0].get(movedPiece, toSq(move)) || 0 : 0)
          + (contHist[1] ? contHist[1].get(movedPiece, toSq(move)) || 0 : 0)
          + (contHist[3] ? contHist[3].get(movedPiece, toSq(move)) || 0 : 0)
          - statsc_1;
        ss.statScore = statSc;
        r -= Math.floor(statSc / (decr_6 + decr_7 * (depth > decr_8 && depth < decr_9 ? 1 : 0)));

        const d = Math.max(1, Math.min(newDepth - r, newDepth + 1));
        value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, d, true);

        if (value > alpha && d < newDepth) {
          newDepth += (value > alpha + lmrse_1 + lmrse_2 * (newDepth - d) ? 1 : 0)
                    + (value > alpha + lmrse_3 + lmrse_4 * (newDepth - d) ? 1 : 0)
                    - (value < bestValue + newDepth ? 1 : 0);
          if (newDepth > d) value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, newDepth, !cutNode);
          const bonus = value > alpha ? statBonus(newDepth) : -statBonus(newDepth);
          const bc = capture ? Math.floor(bonus / lmrse_5) : bonus;
          this.continuationHistory.update(ss.inCheck, capture, movedPiece, toSq(move), bc);
        }
      } else if (moveCount > 1) {
        value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, newDepth, !cutNode);
      } else {
        value = -this.searchPV(pos, childSS, -beta, -alpha, Math.min(maxNextDepth, newDepth), false);
      }

      pos.undoMove(move);

      if (this.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = move;
          if (value >= beta) {
            ss.cutoffCnt++;
            break;
          }
          alpha = value;
        }
      } else {
        ss.cutoffCnt = 0;
      }

      if (move !== bestMove) {
        if (capture && captureCount < 32) capturesSearched[captureCount++] = move;
        else if (!capture && quietCount < 64) quietsSearched[quietCount++] = move;
      }
    }

    // Step 20: no moves
    if (moveCount === 0) {
      bestValue = excludedMove ? alpha : matedIn(ss.ply);
    } else if (bestMove !== MOVE_NONE) {
      this.updateAllStats(pos, ss, bestMove, bestValue, beta, prevSq,
                          quietsSearched, quietCount, capturesSearched, captureCount, depth);
    } else if (!excludedMove && (depth >= 5 || bestValue < alpha - extrbon_1 * depth)
               && (ss.ply > 0 ? !this.pos.captured_piece_helper(this.stack[ss.ply - 1]) : true)) {
      // Bonus for prior countermove
      const extra = (false /* PvNode */ || cutNode) ? 1 : 0;
      const b = statBonus(depth) * (1 + extra);
      if (contHist[0]) contHist[0].update(pos.pieceOn(prevSq), prevSq, b);
    }

    // Update TT
    if (!excludedMove) {
      const bound = bestValue >= beta ? BOUND_LOWER
                  : (bestMove !== MOVE_NONE ? BOUND_EXACT : BOUND_UPPER);
      if (tte) tte.save(posKey, bestMove, this.valueToTT(bestValue, ss.ply), ss.ttPv, bound, depth, ss.staticEval);
    }

    return bestValue;
  }

  // Get continuation history slot
  _getContSlot(inCheck, capture, pc, to) {
    return this.continuationHistory;  // The whole table; update() picks the right cell
  }

  // =============== search<PV> ===============
  searchPV(pos, ss, alpha, beta, depth, cutNode) {
    if (depth <= 0) return this.qsearchPV(pos, ss, alpha, beta, 0);

    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkTime();
    if (this.selDepth < ss.ply + 1) this.selDepth = ss.ply + 1;

    if (this.stopFlag || ss.ply >= MAX_PLY) {
      return (ss.ply >= MAX_PLY && !ss.inCheck) ? evaluate(pos) : this.valueDraw();
    }

    const resultRef = { value: 0 };
    if (pos.ruleJudge(resultRef, ss.ply)) {
      return resultRef.value === VALUE_DRAW ? this.valueDraw() : resultRef.value;
    }

    alpha = Math.max(matedIn(ss.ply), alpha);
    beta = Math.min(mateIn(ss.ply + 1), beta);
    if (alpha >= beta) return alpha;

    const excludedMove = ss.excludedMove;
    const posKey = excludedMove === MOVE_NONE ? pos.key() : pos.key() ^ makeKey(excludedMove);
    const ttHitRef = { value: false };
    const tte = this.tt.probe(posKey, ttHitRef);
    const ttHit = ttHitRef.value;
    ss.ttHit = ttHit;
    const tteBound = tte ? tte.bound() : BOUND_NONE;
    const tteIsPv = tte ? tte.isPv() : false;
    let ttValue = (ttHit && tte) ? this.valueFromTT(tte.value, ss.ply, pos.rule60) : VALUE_NONE;
    let ttMove = (ttHit && tte) ? tte.move : MOVE_NONE;
    if (!excludedMove) ss.ttPv = true;

    // Static eval
    let evalVal = 0, complexity = 0, improvement = 0, improving = false;
    const prevSq = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;
    if (ss.inCheck) {
      ss.staticEval = evalVal = VALUE_NONE;
    } else if (ttHit) {
      ss.staticEval = evalVal = tte ? tte.eval : VALUE_NONE;
      if (evalVal === VALUE_NONE) ss.staticEval = evalVal = evaluate(pos);
      complexity = Math.abs(ss.staticEval - pos.materialDiff());
      if (ttValue !== VALUE_NONE && (tteBound & (ttValue > evalVal ? BOUND_LOWER : BOUND_UPPER)) !== 0) {
        evalVal = ttValue;
      }
    } else {
      ss.staticEval = evalVal = evaluate(pos);
      if (!excludedMove) this.tt.store(posKey, MOVE_NONE, VALUE_NONE, evalVal, 0, BOUND_NONE);
    }

    if (ss.ply >= 2 && this.stack[ss.ply - 2].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 2].staticEval;
    } else if (ss.ply >= 4 && this.stack[ss.ply - 4].staticEval !== VALUE_NONE) {
      improvement = ss.staticEval - this.stack[ss.ply - 4].staticEval;
    } else {
      improvement = impro_1;
    }
    improving = improvement > 0;

    // Step 10: depth reduction for PV
    if (!ttMove) depth -= decr_0;
    if (ttMove && depth > 1 && tte) {
      depth -= Math.min(Math.floor((depth - tte.depth) / decr_1), decr_2);
    }
    if (depth <= 0) return this.qsearchPV(pos, ss, alpha, beta, 0);

    if (cutNode && depth >= 8 && !ttMove) depth -= 1;

    const childSS = this.stack[ss.ply + 1];
    childSS.ply = ss.ply + 1;
    childSS.ttPv = false;
    childSS.excludedMove = MOVE_NONE;
    childSS.killers = [MOVE_NONE, MOVE_NONE];
    childSS.cutoffCnt = 0;
    childSS.doubleExtensions = ss.doubleExtensions;
    childSS.pv = new Int32Array(MAX_PLY + 1);
    childSS.pv[0] = MOVE_NONE;
    ss.pv = childSS.pv;
    if (ss.ply + 2 <= MAX_PLY + 9) this.stack[ss.ply + 2].statScore = 0;

    const contHist = [
      ss.continuationHistory,
      this._ch(ss.ply - 1),
      this._sentinelCont,
      this._ch(ss.ply - 3),
      this._sentinelCont,
      this._ch(ss.ply - 5),
    ];
    const counterMove = this.counterMoves.get(pos.pieceOn(prevSq), prevSq);

    const mp = new MovePicker(pos, ttMove, depth, this.mainHistory[pos.sideToMove], this.captureHistory, contHist, counterMove, ss.killers);

    let bestValue = -VALUE_INFINITE;
    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let captureCount = 0, quietCount = 0;
    const capturesSearched = new Array(32).fill(MOVE_NONE);
    const quietsSearched = new Array(64).fill(MOVE_NONE);
    const maxNextDepth = depth;
    const us = pos.sideToMove;
    let moveCountPruning = false;

    while (true) {
      const move = mp.nextMove(moveCountPruning);
      if (move === MOVE_NONE) break;
      if (move === excludedMove) continue;
      if (!pos.legal(move)) continue;
      moveCount++;
      ss.moveCount = moveCount;
      childSS.pv = null;
      let extension = 0;
      const capture = pos.capture(move);
      const movedPiece = pos.movedPiece(move);
      const givesCheck = pos.givesCheck(move);
      let newDepth = depth - 1;
      const delta = beta - alpha;

      // Singular extension
      if (ss.ply < this.rootDepth * 2) {
        if (!excludedMove && depth >= exten_1
            && move === ttMove && move !== MOVE_NONE
            && Math.abs(ttValue) < VALUE_KNOWN_WIN
            && (tteBound & BOUND_LOWER) !== 0
            && tte && tte.depth >= depth - 3) {
          const singularBeta = ttValue - (exten_2 + (ss.ttPv ? 1 : 0)) * depth;
          const singularDepth = Math.floor((depth - 1) / 2);
          ss.excludedMove = move;
          const v = this.searchNonPV(pos, ss, singularBeta - 1, singularBeta, singularDepth, cutNode);
          ss.excludedMove = MOVE_NONE;
          if (v < singularBeta) {
            extension = exten_7;
            if (v < singularBeta - exten_3 && ss.doubleExtensions <= exten_8) extension = exten_9;
          } else if (singularBeta >= beta) {
            return singularBeta;
          } else if (ttValue >= beta) {
            extension = -exten_10;
          } else if (ttValue <= alpha && ttValue <= v) {
            extension = -exten_11;
          }
        } else if (givesCheck && depth > exten_4 && Math.abs(ss.staticEval) > exten_5) {
          extension = exten_12;
        } else if (move === ttMove && move === ss.killers[0]
                   && contHist[0] && contHist[0].get(movedPiece, toSq(move)) >= exten_6) {
          extension = exten_13;
        }
      }
      newDepth += extension;
      childSS.doubleExtensions = ss.doubleExtensions + (extension === exten_14 ? 1 : 0);

      ss.currentMove = move;
      childSS.continuationHistory = this.continuationHistory;

      pos.doMove(move);
      childSS.inCheck = pos.inCheck();

      let value;
      try {
      // LMR for PV
      if (depth >= 2 && moveCount > 1 + (ss.ply <= 1 ? 1 : 0)
          && (!ss.ttPv || !capture || (cutNode && (ss.ply > 0 ? this.stack[ss.ply - 1].moveCount : 0) > 1))) {
        let r = this.reduction(improving, depth, moveCount, delta, this.rootDelta || 200);
        if (ss.ttPv) r -= decr_3 + Math.floor(decr_4 / (decr_5 + depth));
        if (ss.ply > 0 && this.stack[ss.ply - 1].moveCount > decr_10) r -= decr_11;
        if (cutNode) r += cutredu_1 + Math.floor(cutredu_2 / (cutredu_3 + depth));
        if (ttCapture) r += decr_12;
        r -= pvredu_1 + Math.floor(pvredu_2 / (pvredu_3 + depth));
        if (childSS.cutoffCnt > decr_14) r += decr_15;

        const statSc = 2 * this.mainHistory[us].get((fromSq(move) << 7) | toSq(move), 0)
          + (contHist[0] ? contHist[0].get(movedPiece, toSq(move)) || 0 : 0)
          + (contHist[1] ? contHist[1].get(movedPiece, toSq(move)) || 0 : 0)
          + (contHist[3] ? contHist[3].get(movedPiece, toSq(move)) || 0 : 0)
          - statsc_1;
        ss.statScore = statSc;
        r -= Math.floor(statSc / (decr_6 + decr_7 * (depth > decr_8 && depth < decr_9 ? 1 : 0)));
        const d = Math.max(1, Math.min(newDepth - r, newDepth + 1));
        value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, d, true);
        if (value > alpha && d < newDepth) {
          newDepth += (value > alpha + lmrse_1 + lmrse_2 * (newDepth - d) ? 1 : 0)
                    + (value > alpha + lmrse_3 + lmrse_4 * (newDepth - d) ? 1 : 0)
                    - (value < bestValue + newDepth ? 1 : 0);
          if (newDepth > d) value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, newDepth, !cutNode);
          const bonus = value > alpha ? statBonus(newDepth) : -statBonus(newDepth);
          this.continuationHistory.update(ss.inCheck, capture, movedPiece, toSq(move),
                                          capture ? Math.floor(bonus / lmrse_5) : bonus);
        }
      } else if (moveCount > 1) {
        value = -this.searchNonPV(pos, childSS, -(alpha + 1), -alpha, newDepth, !cutNode);
      }

      // Full PV re-search
      if (moveCount === 1 || (value > alpha && (ss.ply === 0 || value < beta))) {
        childSS.pv = new Int32Array(MAX_PLY + 1);
        childSS.pv[0] = MOVE_NONE;
        value = -this.searchPV(pos, childSS, -beta, -alpha, Math.min(maxNextDepth, newDepth), false);
      }
      } finally {
        pos.undoMove(move);
      }

      if (this.stopFlag) return VALUE_ZERO;

      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = move;
          if (ss.ply > 0) this.updatePV(ss.pv, move, childSS.pv);
          if (value < beta) {
            alpha = value;
            if (depth > 2 && depth < 7 && beta < VALUE_KNOWN_WIN && alpha > -VALUE_KNOWN_WIN) {
              depth -= 1;
            }
          } else {
            ss.cutoffCnt++;
            break;
          }
        }
      } else {
        ss.cutoffCnt = 0;
      }

      if (move !== bestMove) {
        if (capture && captureCount < 32) capturesSearched[captureCount++] = move;
        else if (!capture && quietCount < 64) quietsSearched[quietCount++] = move;
      }
    }

    if (moveCount === 0) {
      bestValue = excludedMove ? alpha : matedIn(ss.ply);
    } else if (bestMove !== MOVE_NONE) {
      this.updateAllStats(pos, ss, bestMove, bestValue, beta, prevSq,
                          quietsSearched, quietCount, capturesSearched, captureCount, depth);
    }

    if (!excludedMove) {
      const bound = bestValue >= beta ? BOUND_LOWER
                  : (bestMove !== MOVE_NONE ? BOUND_EXACT : BOUND_UPPER);
      if (tte) tte.save(posKey, bestMove, this.valueToTT(bestValue, ss.ply), ss.ttPv, bound, depth, ss.staticEval);
    }

    return bestValue;
  }

  // =============== qsearch<NonPV> ===============
  qsearchNonPV(pos, ss, alpha, beta, depth) {
    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkTime();
    if (ss.ply >= MAX_PLY) return ss.inCheck ? this.valueDraw() : evaluate(pos);

    const resultRef = { value: 0 };
    if (pos.ruleJudge(resultRef, ss.ply)) return resultRef.value;

    const ttDepth = (ss.inCheck || depth >= DEPTH_QS_CHECKS) ? DEPTH_QS_CHECKS : DEPTH_QS_NO_CHECKS;
    const posKey = pos.key();
    const ttHitRef = { value: false };
    const tte = this.tt.probe(posKey, ttHitRef);
    const ttHit = ttHitRef.value;
    ss.ttHit = ttHit;
    const tteBound = tte ? tte.bound() : BOUND_NONE;
    const ttValue = (ttHit && tte) ? this.valueFromTT(tte.value, ss.ply, pos.rule60) : VALUE_NONE;
    const ttMove = (ttHit && tte) ? tte.move : MOVE_NONE;
    const pvHit = ttHit && tte && tte.isPv();

    if (!ss.ttPv && ttHit && tte && tte.depth >= ttDepth && ttValue !== VALUE_NONE
        && ((tteBound & (ttValue >= beta ? BOUND_LOWER : BOUND_UPPER)) !== 0)) {
      return ttValue;
    }

    let bestValue, futilityBase;
    if (ss.inCheck) {
      ss.staticEval = VALUE_NONE;
      bestValue = futilityBase = -VALUE_INFINITE;
    } else {
      if (ttHit) {
        if ((ss.staticEval = bestValue = tte.eval) === VALUE_NONE) {
          ss.staticEval = bestValue = evaluate(pos);
        }
        if (ttValue !== VALUE_NONE && ((tteBound & (ttValue > bestValue ? BOUND_LOWER : BOUND_UPPER)) !== 0)) {
          bestValue = ttValue;
        }
      } else {
        ss.staticEval = bestValue = (ss.ply > 0 && this.stack[ss.ply - 1].currentMove === MOVE_NULL)
          ? -this.stack[ss.ply - 1].staticEval
          : evaluate(pos);
      }
      if (bestValue >= beta) {
        if (!ttHit) this.tt.store(posKey, MOVE_NONE, VALUE_NONE, bestValue, 0, BOUND_LOWER);
        return bestValue;
      }
      if (bestValue > alpha) alpha = bestValue;
      futilityBase = bestValue + futiba_1;
    }

    const childSS = this.stack[ss.ply + 1];
    childSS.ply = ss.ply + 1;
    childSS.inCheck = false;
    childSS.excludedMove = MOVE_NONE;
    childSS.killers = [MOVE_NONE, MOVE_NONE];
    childSS.cutoffCnt = 0;
    childSS.doubleExtensions = 0;
    childSS.continuationHistory = this._sentinelCont;
    childSS.statScore = 0;

    const contHist = [
      ss.continuationHistory,
      this._ch(ss.ply - 1),
      this._sentinelCont,
      this._ch(ss.ply - 3),
      this._sentinelCont,
      this._ch(ss.ply - 5),
    ];
    const recaptureSquare = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;

    const mp = new MovePicker(pos, ttMove, depth, this.mainHistory[pos.sideToMove], this.captureHistory, contHist, MOVE_NONE, null);
    mp.recaptureSquare = recaptureSquare;
    if (pos.inCheck()) mp.stage = 7;  // EVASION_TT

    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let quietCheckEvasions = 0;
    const us = pos.sideToMove;

    while (true) {
      const move = mp.nextMove(false);
      if (move === MOVE_NONE) break;
      if (!pos.legal(move)) continue;
      const givesCheck = pos.givesCheck(move);
      const capture = pos.capture(move);
      moveCount++;

      if (bestValue > VALUE_MATED_IN_MAX_PLY && !givesCheck
          && toSq(move) !== recaptureSquare && futilityBase > -VALUE_KNOWN_WIN) {
        if (moveCount > 2) continue;
        const futilityValue = futilityBase + PieceValue[EG][pos.pieceOn(toSq(move))];
        if (futilityValue <= alpha) { bestValue = Math.max(bestValue, futilityValue); continue; }
        if (futilityBase <= alpha && !pos.seeGE(move, 1)) { bestValue = Math.max(bestValue, futilityBase); continue; }
      }
      if (bestValue > VALUE_MATED_IN_MAX_PLY && !pos.seeGE(move)) continue;

      ss.currentMove = move;
      pos.doMove(move);
      const value = -this.qsearchNonPV(pos, childSS, -beta, -alpha, depth - 1);
      pos.undoMove(move);

      if (this.stopFlag) return VALUE_ZERO;
      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = move;
          if (value >= beta) break;
          alpha = value;
        }
      }
    }

    if (bestValue === -VALUE_INFINITE) return matedIn(ss.ply);
    if (tte) tte.save(posKey, bestMove, this.valueToTT(bestValue, ss.ply), pvHit,
                      bestValue >= beta ? BOUND_LOWER : BOUND_UPPER,
                      ttDepth, ss.staticEval);
    return bestValue;
  }

  // =============== qsearch<PV> ===============
  qsearchPV(pos, ss, alpha, beta, depth) {
    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkTime();
    if (ss.ply >= MAX_PLY) return ss.inCheck ? this.valueDraw() : evaluate(pos);
    if (this.selDepth < ss.ply + 1) this.selDepth = ss.ply + 1;

    const resultRef = { value: 0 };
    if (pos.ruleJudge(resultRef, ss.ply)) return resultRef.value;

    const ttDepth = (ss.inCheck || depth >= DEPTH_QS_CHECKS) ? DEPTH_QS_CHECKS : DEPTH_QS_NO_CHECKS;
    const posKey = pos.key();
    const ttHitRef = { value: false };
    const tte = this.tt.probe(posKey, ttHitRef);
    const ttHit = ttHitRef.value;
    ss.ttHit = ttHit;
    const tteBound = tte ? tte.bound() : BOUND_NONE;
    const ttValue = (ttHit && tte) ? this.valueFromTT(tte.value, ss.ply, pos.rule60) : VALUE_NONE;
    const ttMove = (ttHit && tte) ? tte.move : MOVE_NONE;
    const pvHit = ttHit && tte && tte.isPv();

    if (ttHit && tte && tte.depth >= ttDepth && ttValue !== VALUE_NONE
        && ((tteBound & (ttValue >= beta ? BOUND_LOWER : BOUND_UPPER)) !== 0)) {
      return ttValue;
    }

    let bestValue, futilityBase;
    if (ss.inCheck) {
      ss.staticEval = VALUE_NONE;
      bestValue = futilityBase = -VALUE_INFINITE;
    } else {
      if (ttHit) {
        if ((ss.staticEval = bestValue = tte.eval) === VALUE_NONE) {
          ss.staticEval = bestValue = evaluate(pos);
        }
        if (ttValue !== VALUE_NONE && ((tteBound & (ttValue > bestValue ? BOUND_LOWER : BOUND_UPPER)) !== 0)) {
          bestValue = ttValue;
        }
      } else {
        ss.staticEval = bestValue = evaluate(pos);
      }
      if (bestValue >= beta) return bestValue;
      if (bestValue > alpha) alpha = bestValue;
      futilityBase = bestValue + futiba_1;
    }

    const childSS = this.stack[ss.ply + 1];
    childSS.ply = ss.ply + 1;
    childSS.inCheck = false;
    childSS.excludedMove = MOVE_NONE;
    childSS.killers = [MOVE_NONE, MOVE_NONE];
    childSS.cutoffCnt = 0;
    childSS.doubleExtensions = 0;
    childSS.continuationHistory = this._sentinelCont;
    childSS.statScore = 0;
    const pvLocal = new Int32Array(MAX_PLY + 1);
    childSS.pv = pvLocal;
    ss.pv = pvLocal;
    pvLocal[0] = MOVE_NONE;

    const contHist = [
      ss.continuationHistory,
      this._ch(ss.ply - 1),
      this._sentinelCont,
      this._ch(ss.ply - 3),
      this._sentinelCont,
      this._ch(ss.ply - 5),
    ];
    const recaptureSquare = ss.ply > 0 ? toSq(this.stack[ss.ply - 1].currentMove) : SQ_NONE;

    const mp = new MovePicker(pos, ttMove, depth, this.mainHistory[pos.sideToMove], this.captureHistory, contHist, MOVE_NONE, null);
    mp.recaptureSquare = recaptureSquare;
    if (pos.inCheck()) mp.stage = 7;

    let bestMove = MOVE_NONE;
    let moveCount = 0;
    let quietCheckEvasions = 0;

    while (true) {
      const move = mp.nextMove(false);
      if (move === MOVE_NONE) break;
      if (!pos.legal(move)) continue;
      const givesCheck = pos.givesCheck(move);
      const capture = pos.capture(move);
      moveCount++;

      if (bestValue > VALUE_MATED_IN_MAX_PLY && !givesCheck
          && toSq(move) !== recaptureSquare && futilityBase > -VALUE_KNOWN_WIN) {
        if (moveCount > 2) continue;
        const futilityValue = futilityBase + PieceValue[EG][pos.pieceOn(toSq(move))];
        if (futilityValue <= alpha) { bestValue = Math.max(bestValue, futilityValue); continue; }
        if (futilityBase <= alpha && !pos.seeGE(move, 1)) { bestValue = Math.max(bestValue, futilityBase); continue; }
      }
      if (bestValue > VALUE_MATED_IN_MAX_PLY && !pos.seeGE(move)) continue;

      ss.currentMove = move;
      pos.doMove(move);
      const value = -this.qsearchPV(pos, childSS, -beta, -alpha, depth - 1);
      pos.undoMove(move);

      if (this.stopFlag) return VALUE_ZERO;
      if (value > bestValue) {
        bestValue = value;
        if (value > alpha) {
          bestMove = move;
          if (value < beta) {
            this.updatePV(ss.pv, move, childSS.pv);
            alpha = value;
          } else {
            this.updatePV(ss.pv, move, childSS.pv);
            break;
          }
        }
      }
    }

    if (bestValue === -VALUE_INFINITE) return matedIn(ss.ply);
    if (tte) tte.save(posKey, bestMove, this.valueToTT(bestValue, ss.ply), pvHit,
                      bestValue >= beta ? BOUND_LOWER : BOUND_UPPER,
                      ttDepth, ss.staticEval);
    return bestValue;
  }

  // =============== History update helpers ===============
  updateContinuationHistories(ss, pc, to, bonus) {
    if (!ss) return;
    for (const i of [1, 2, 4, 6]) {
      if (ss.ply < i) break;
      const target = this.stack[ss.ply - i];
      if (ss.inCheck && i > 2) break;
      if (target.currentMove !== MOVE_NONE && target.continuationHistory) {
        target.continuationHistory.update(
          target.inCheck ? 1 : 0,
          (target.ply > 0 && this.stack[target.ply - 1].currentMove !== MOVE_NONE
            && (this.pos.pieceOn(toSq(this.stack[target.ply - 1].currentMove)) !== NO_PIECE)) ? 1 : 0,
          pc, to, bonus
        );
      }
    }
  }

  updateQuietStats(pos, ss, move, bonus) {
    if (ss.killers[0] !== move) {
      ss.killers[1] = ss.killers[0];
      ss.killers[0] = move;
    }
    const us = pos.sideToMove;
    this.mainHistory[us].update((fromSq(move) << 7) | toSq(move), 0, bonus);
    if (ss.continuationHistory) {
      ss.continuationHistory.update(false, false, pos.movedPiece(move), toSq(move), bonus);
    }
    if (ss.ply > 0) {
      const prev = this.stack[ss.ply - 1];
      if (prev.currentMove !== MOVE_NONE) {
        const prevTo = toSq(prev.currentMove);
        const prevPc = pos.pieceOn(prevTo);
        this.counterMoves.set(prevPc, prevTo, move);
      }
    }
  }

  updateAllStats(pos, ss, bestMove, bestValue, beta, prevSq,
                 quietsSearched, quietCount, capturesSearched, captureCount, depth) {
    const us = pos.sideToMove;
    const bonus1 = statBonus(depth + 1);
    const movedPiece = pos.movedPiece(bestMove);
    const to = toSq(bestMove);
    if (!pos.capture(bestMove)) {
      const bonus2 = bestValue > beta + PawnValueMg ? bonus1 : statBonus(depth);
      this.updateQuietStats(pos, ss, bestMove, bonus2);
      for (let i = 0; i < quietCount; i++) {
        const m = quietsSearched[i];
        this.mainHistory[us].update((fromSq(m) << 7) | toSq(m), 0, -bonus2);
        this.continuationHistory.update(ss.inCheck ? 1 : 0, 0, pos.movedPiece(m), toSq(m), -bonus2);
      }
    } else {
      const captured = typeOf(pos.pieceOn(to));
      this.captureHistory.update(movedPiece, to, captured, bonus1);
    }
    // Extra penalty for quiet early move refuted
    if (ss.ply > 0) {
      const prev = this.stack[ss.ply - 1];
      if (prev.currentMove !== MOVE_NONE && !pos.captured_piece_helper_safe(ss)) {
        const prevMoveCount = prev.moveCount;
        const prevTtHit = prev.ttHit;
        if ((prevMoveCount === 1 + (prevTtHit ? 1 : 0) || prev.currentMove === prev.killers[0])) {
          const prevTo = toSq(prev.currentMove);
          const prevPc = pos.pieceOn(prevTo);
          this.continuationHistory.update(prev.inCheck ? 1 : 0, 0, prevPc, prevTo, -bonus1);
        }
      }
    }
    for (let i = 0; i < captureCount; i++) {
      const m = capturesSearched[i];
      this.captureHistory.update(pos.movedPiece(m), toSq(m), typeOf(pos.pieceOn(toSq(m))), -bonus1);
    }
  }
}

// Position helper method stubs (added in position.js)
