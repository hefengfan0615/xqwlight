/*
 * search.js - Pikafish 风格 Search 模块 - JavaScript 实现
 *
 * 参考 Pikafish 的 src/search.h / search.cpp:
 *   - 迭代加深 (Iterative Deepening)
 *   - Alpha-Beta + PVS (Principal Variation Search)
 *   - Null Move Pruning (空着裁剪)
 *   - LMR (Late Move Reduction)
 *   - Transposition Table (置换表)
 *   - PV 表 (Pikafish 的 PvTable)
 *   - 杀手着法 (Killers)
 *   - History Heuristic
 *   - UCI 风格 info 输出 (depth, score, pv, knps, nps, time)
 */

"use strict";

// =============================================================================
// 常量
// =============================================================================

const MATE_VALUE      = 30000;
const MATE_IN_MAX_PLY = MATE_VALUE - 100;
const WIN_VALUE       = 20000;
const DRAW_VALUE      = 0;

// 置换表
const TT_NOBOUND  = 0;
const TT_UPPER    = 1;  // alpha
const TT_LOWER    = 2;  // beta
const TT_EXACT    = 3;  // pv

const MAX_PLY  = 64;
const MAX_MOVES = 256;

// =============================================================================
// TT 入口
// =============================================================================

function TTEntry() {
  this.key16 = 0;   // 16 位 zobrist 截断
  this.depth = 0;
  this.bound = TT_NOBOUND;
  this.value = 0;
  this.bestMove = 0;
  this.age = 0;
}

// =============================================================================
// SearchWorker
// =============================================================================

function SearchWorker() {
  this.pos = new Position();
  this.tt = new Array(1 << 18);  // 256K 入口
  for (let i = 0; i < this.tt.length; i++) this.tt[i] = new TTEntry();
  this.ttMask = this.tt.length - 1;
  this.ttAge = 0;

  // History: 14 * 90 (piece_type * square -> score)
  this.history = new Int32Array(14 * 90);
  // Counter moves
  this.killers = new Array(MAX_PLY);
  for (let i = 0; i < MAX_PLY; i++) this.killers[i] = [0, 0];

  // PV
  this.pv = new Array(MAX_PLY);
  for (let i = 0; i < MAX_PLY; i++) this.pv[i] = new Int32Array(MAX_PLY);
  this.pvLen = new Int32Array(MAX_PLY);

  // 节点计数
  this.nodes = 0n;  // 用 BigInt 防止溢出
  this.startTime = 0;
  this.stopTime  = 0;
  this.stop      = false;
  this.bestMove  = 0;
  this.bestScore = -MATE_VALUE;
  this.maxDepth  = 64;
  this.timeLimit = Infinity;

  // 搜索栈 (临时)
  this.mvBuf = new Int32Array(MAX_MOVES);
}

// =============================================================================
// TT 操作
// =============================================================================

SearchWorker.prototype.ttRead = function(key) {
  // 用 16 位截断
  const k16 = Number(key & 0xFFFFn);
  const idx = Number(key & BigInt(this.ttMask));
  const e = this.tt[idx];
  if (e.key16 === k16) return e;
  return null;
};

SearchWorker.prototype.ttWrite = function(key, depth, value, bound, bestMove) {
  const k16 = Number(key & 0xFFFFn);
  const idx = Number(key & BigInt(this.ttMask));
  const e = this.tt[idx];
  e.key16 = k16;
  e.depth = depth;
  e.value = value;
  e.bound = bound;
  e.bestMove = bestMove;
  e.age = this.ttAge;
};

// =============================================================================
// 内部搜索 (PVS + alpha-beta)
// =============================================================================

SearchWorker.prototype.qsearch = function(alpha, beta, ply) {
  this.nodes++;
  if (ply >= MAX_PLY) return this.pos.evaluate();

  // TT probe
  const key = this.pos.computeKey();
  const tte = this.ttRead(key);
  let ttMove = 0;
  if (tte && tte.bound !== TT_NOBOUND) {
    ttMove = tte.bestMove;
    if (tte.bound === TT_EXACT) return tte.value;
    if (tte.bound === TT_LOWER && tte.value >= beta) return tte.value;
    if (tte.bound === TT_UPPER && tte.value <= alpha) return tte.value;
  }

  // Stand pat
  const standPat = this.pos.evaluate();
  if (standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  // 生成吃子
  const mp = new MovePicker(this.pos, ttMove, 0, [0, 0], null);
  let best = standPat;
  let bestMove = 0;
  let mv;
  while ((mv = mp.nextMoveQuiesc()) !== MOVE_NONE) {
    // 合法性检查
    if (!this.makeMoveLegal(mv)) continue;
    this.pos.doMove(mv, null);
    const score = -this.qsearch(-beta, -alpha, ply + 1);
    this.pos.undoMove();
    if (score > best) {
      best = score;
      bestMove = mv;
      if (score > alpha) {
        alpha = score;
        if (score >= beta) break;
      }
    }
  }

  if (best >= beta) this.ttWrite(key, 0, best, TT_LOWER, bestMove);
  else if (best > standPat) this.ttWrite(key, 0, best, TT_EXACT, bestMove);
  else this.ttWrite(key, 0, best, TT_UPPER, bestMove);

  return best;
};

SearchWorker.prototype.search = function(alpha, beta, depth, ply, doNull) {
  this.nodes++;
  if (this.stop) return 0;

  if (ply >= MAX_PLY) return this.pos.evaluate();

  // Check time
  if ((this.nodes & 1023n) === 0n && Date.now() > this.stopTime) {
    this.stop = true;
    return 0;
  }

  // Repetition check (简化: 跳过)
  if (ply > 0) {
    // alpha-beta mate distance pruning
    alpha = Math.max(alpha, -MATE_VALUE + ply);
    beta  = Math.min(beta,   MATE_VALUE - ply);
    if (alpha >= beta) return alpha;
  }

  // TT probe
  const key = this.pos.computeKey();
  const tte = this.ttRead(key);
  let ttMove = 0;
  let ttValue = 0, ttBound = TT_NOBOUND;
  if (tte) {
    ttMove = tte.bestMove;
    ttValue = tte.value;
    ttBound = tte.bound;
    if (tte.depth >= depth && ply > 0) {
      if (tte.bound === TT_EXACT) return tte.value;
      if (tte.bound === TT_LOWER && tte.value >= beta) return tte.value;
      if (tte.bound === TT_UPPER && tte.value <= alpha) return tte.value;
    }
  }

  // 是否处于被将军状态
  const inCheck = this.pos.inCheck();

  // 到达叶节点 -> quiescence
  if (depth <= 0) return this.qsearch(alpha, beta, ply);

  // 静态 null move pruning
  if (!inCheck && depth < 3 && this.pos.evaluate() - 200 * depth >= beta) {
    return this.pos.evaluate();
  }

  // Null move pruning
  if (doNull && !inCheck && depth >= 3) {
    // 简化: 不做"非零大子"判断
    this.pos.doNullMove(null);
    const v = -this.search(-beta, -beta + 1, depth - 3, ply + 1, false);
    this.pos.undoNullMove();
    if (this.stop) return 0;
    if (v >= beta) return v;
  }

  // 着法生成
  const killers = this.killers[ply] || [0, 0];
  const mp = new MovePicker(this.pos, ttMove, depth, killers, this.history);
  let best = -MATE_VALUE;
  let bestMove = 0;
  let movesSearched = 0;
  let bound = TT_UPPER;
  let pvNode = (beta - alpha) > 1;
  const alphaOrig = alpha;

  let mv;
  while ((mv = mp.nextMove()) !== MOVE_NONE) {
    if (!this.makeMoveLegal(mv)) continue;
    this.pos.doMove(mv, null);

    let value;
    const newDepth = depth - 1;

    if (movesSearched === 0) {
      // PV node first move: full window
      value = -this.search(-beta, -alpha, newDepth, ply + 1, true);
    } else {
      // LMR: 后续走子降低深度
      let reduction = 0;
      if (!inCheck && !this.pos.inCheck() && depth >= 3 && !mp.isCapture(mv) && mv !== killers[0] && mv !== killers[1]) {
        reduction = (movesSearched > 2) ? 1 : 0;
        if (depth >= 6 && movesSearched > 6) reduction = 2;
      }

      // Zero window
      value = -this.search(-alpha - 1, -alpha, newDepth - reduction, ply + 1, true);
      if (this.stop) { this.pos.undoMove(); return 0; }
      if (value > alpha && (reduction > 0 || value < beta)) {
        // Re-search full window
        value = -this.search(-beta, -alpha, newDepth, ply + 1, true);
      }
    }

    this.pos.undoMove();
    if (this.stop) return 0;

    if (value > best) {
      best = value;
      bestMove = mv;
      if (value > alpha) {
        alpha = value;
        bound = TT_EXACT;
        // PV update
        this.pv[ply][ply] = mv;
        for (let i = ply + 1; i < this.pvLen[ply + 1]; i++) {
          this.pv[ply][i] = this.pv[ply + 1][i];
        }
        this.pvLen[ply] = this.pvLen[ply + 1] + 1;

        if (value >= beta) {
          bound = TT_LOWER;
          // Killer / history
          const from = moveFrom(mv);
          const to = moveTo(mv);
          const pc = this.pos.pieceOn[from];
          if (pc >= 0 && this.pos.pieceOn[to] < 0) {
            // Quiet move causing cutoff
            if (this.killers[ply][0] !== mv) {
              this.killers[ply][1] = this.killers[ply][0];
              this.killers[ply][0] = mv;
            }
            const pt = PIECE_TYPE[pc];
            this.history[pt * 90 + to] += depth * depth;
          }
          break;
        }
      }
    }
    movesSearched++;
  }

  if (movesSearched === 0) {
    // 无棋可走: 将军或者逼和
    if (inCheck) return -MATE_VALUE + ply;
    return 0;
  }

  this.ttWrite(key, depth, best, bound, bestMove);
  return best;
};

// 合法性检查: 模拟走子后是否送将
SearchWorker.prototype.makeMoveLegal = function(mv) {
  const from = moveFrom(mv), to = moveTo(mv);
  const pc = this.pos.pieceOn[from];
  if (pc < 0) return false;
  if (COLOR_OF[pc] !== this.pos.side) return false;
  const captured = this.pos.pieceOn[to];
  const color = COLOR_OF[pc];

  // 应用 (简化: 直接复制 Position 的代码)
  this.pos.byPieceBB[pc] &= ~bbOf(from);
  this.pos.byPieceBB[pc] |=  bbOf(to);
  this.pos.pieceOn[from] = -1;
  this.pos.pieceOn[to]   = pc;
  if (captured >= 0) this.pos.byPieceBB[captured] &= ~bbOf(to);
  if (color === RED) {
    this.pos.occRed &= ~bbOf(from); this.pos.occRed |= bbOf(to);
    if (captured >= 0) this.pos.occBlk &= ~bbOf(to);
  } else {
    this.pos.occBlk &= ~bbOf(from); this.pos.occBlk |= bbOf(to);
    if (captured >= 0) this.pos.occRed &= ~bbOf(to);
  }
  this.pos.occ = this.pos.occRed | this.pos.occBlk;
  if (pc === R_KING) this.pos.kingRed = to;
  if (pc === B_KING) this.pos.kingBlk = to;

  const myKing = color === RED ? this.pos.kingRed : this.pos.kingBlk;
  const inCheck = this.pos.isSquareAttacked(myKing, 1 - color);

  // 撤销
  this.pos.byPieceBB[pc] &= ~bbOf(to);
  this.pos.byPieceBB[pc] |=  bbOf(from);
  this.pos.pieceOn[from] = pc;
  this.pos.pieceOn[to]   = captured;
  if (captured >= 0) this.pos.byPieceBB[captured] |= bbOf(to);
  if (color === RED) {
    this.pos.occRed &= ~bbOf(to); this.pos.occRed |= bbOf(from);
    if (captured >= 0) this.pos.occBlk |= bbOf(to);
  } else {
    this.pos.occBlk &= ~bbOf(to); this.pos.occBlk |= bbOf(from);
    if (captured >= 0) this.pos.occRed |= bbOf(to);
  }
  this.pos.occ = this.pos.occRed | this.pos.occBlk;
  if (pc === R_KING) this.pos.kingRed = from;
  if (pc === B_KING) this.pos.kingBlk = from;

  return !inCheck;
};

// =============================================================================
// 根搜索 (iterative deepening)
// =============================================================================

SearchWorker.prototype.searchRoot = function() {
  // 顶层: 走所有合法着法
  const start = Date.now();
  this.startTime = start;
  this.stopTime  = start + this.timeLimit;
  this.stop      = false;
  this.nodes     = 0n;
  this.ttAge     = (this.ttAge + 1) & 0xFFFF;
  this.bestMove  = 0;
  this.bestScore = -MATE_VALUE;

  // 生成所有着法
  const mvs = new Int32Array(256);
  const n = this.pos.generateLegalMoves(mvs);
  if (n === 0) {
    return 0;  // 无合法着法
  }

  // 评分
  for (let i = 0; i < n; i++) {
    const mv = mvs[i];
    const to = moveTo(mv);
    const from = moveFrom(mv);
    const victim = this.pos.pieceOn[to];
    const attacker = this.pos.pieceOn[from];
    // 简单: MVV-LVA
    if (victim >= 0) {
      mvs[i] = mv | ((10000 + MVV_VALUE[victim] - LVA_VALUE[attacker]) << 16);
    } else {
      mvs[i] = mv | (0 << 16);
    }
  }

  // 按 score 排序 (高 -> 低)
  mvs.sort((a, b) => (b >>> 16) - (a >>> 16));

  let alpha = -MATE_VALUE;
  let beta  = MATE_VALUE;
  let bestMv = 0;
  let bestSc = -MATE_VALUE;

  // 迭代加深
  let completedDepth = 0;
  for (let depth = 1; depth <= this.maxDepth; depth++) {
    if (this.stop) break;

    // 重新初始化
    for (let i = 0; i < MAX_PLY; i++) this.pvLen[i] = 0;

    let curBest = 0;
    let curScore = -MATE_VALUE;
    let curBound = TT_UPPER;
    let firstLegal = -1;
    for (let i = 0; i < n; i++) {
      const mv = mvs[i] & 0xFFFF;
      if (mv === 0) continue;
      if (!this.makeMoveLegal(mv)) { mvs[i] = 0; continue; }
      if (firstLegal < 0) firstLegal = mv;

      this.pos.doMove(mv, null);
      let sc;
      if (i === 0 || curScore === -MATE_VALUE) {
        sc = -this.search(-beta, -alpha, depth - 1, 1, true);
      } else {
        // PVS
        sc = -this.search(-alpha - 1, -alpha, depth - 1, 1, true);
        if (sc > alpha && sc < beta) {
          sc = -this.search(-beta, -alpha, depth - 1, 1, true);
        }
      }
      this.pos.undoMove();

      if (this.stop) break;

      if (sc > curScore) {
        curScore = sc;
        curBest = mv;
        curBound = TT_EXACT;
        alpha = sc;
        // PV
        this.pv[0][0] = mv;
        for (let p = 1; p < this.pvLen[1]; p++) this.pv[0][p] = this.pv[1][p];
        this.pvLen[0] = this.pvLen[1] + 1;
      }
    }

    if (this.stop) break;

    if (curBest > 0) {
      bestMv = curBest;
      bestSc = curScore;
    }

    // 更新全局最佳
    this.bestMove = bestMv;
    this.bestScore = bestSc;
    completedDepth = depth;

    // 输出 info (UCI 风格)
    this.outputInfo(depth, bestSc, bestMv, this.pvLen[0]);

    // Mate distance
    if (bestSc > WIN_VALUE || bestSc < -WIN_VALUE) break;

    // 时间检查
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.timeLimit / 2) break;
  }

  this.bestMove = bestMv;
  this.bestScore = bestSc;
  return bestMv;
};

// =============================================================================
// 输出 (Pikafish 风格的 UCI info 格式)
// =============================================================================

SearchWorker.prototype.outputInfo = function(depth, score, bestMv, pvLen) {
  if (typeof onSearchInfo === 'function') {
    const elapsed = Math.max(1, Date.now() - this.startTime);
    const knps = (Number(this.nodes) / elapsed) | 0;
    const pvArr = [];
    for (let i = 0; i < Math.min(pvLen, 12); i++) pvArr.push(this.pv[0][i]);
    onSearchInfo({
      depth: depth,
      score: score,
      pv: pvArr,
      nodes: Number(this.nodes),
      time: elapsed,
      knps: knps
    });
  }
};

window.SearchWorker = SearchWorker;
window.MATE_VALUE = MATE_VALUE;
window.WIN_VALUE = WIN_VALUE;
