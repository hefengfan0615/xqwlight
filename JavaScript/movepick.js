/*
 * movepick.js - Pikafish 风格 MovePicker 模块 - JavaScript 实现
 *
 * 参考 Pikafish 的 src/movepick.h / movepick.cpp
 *
 * MovePicker 按阶段返回着法:
 *   1. TT_MOVE        (置换表建议着法)
 *   2. INIT_CAPTURES  (生成所有吃子着法)
 *   3. GOOD_CAPTURES  (SEE >= 0 的吃子)
 *   4. KILLERS        (杀手着法 1, 2)
 *   5. INIT_QUIETS    (生成所有不吃子着法)
 *   6. GOOD_QUIETS    (按 history 排序的非吃子)
 *   7. INIT_BAD_CAPTURES
 *   8. BAD_CAPTURES
 *
 * 在 quiescence 中使用: 只走吃子和将帅着法
 */

"use strict";

// =============================================================================
// MovePicker 主类
// =============================================================================

// 着法阶段常量
const STAGE_TT          = 0;
const STAGE_INIT_CAPT   = 1;
const STAGE_GOOD_CAPT   = 2;
const STAGE_KILLERS     = 3;
const STAGE_INIT_QUIET  = 4;
const STAGE_GOOD_QUIET  = 5;
const STAGE_INIT_BADCAPT= 6;
const STAGE_BAD_CAPT    = 7;
const STAGE_DONE        = 8;

// 简单扩展着法结构
function ExtMove(mv, score) {
  this.mv = mv;
  this.score = score;
}

// 各种评分常量
const SCORE_NONE     = -32000;
const SCORE_CAPT_INIT= 0;
const SCORE_GOOD_CAPT= 1000000;
const SCORE_BAD_CAPT = -1000000;
const SCORE_KILLER1  = 900000;
const SCORE_KILLER2  = 800000;
const SCORE_QUIET    = 0;
const SCORE_TT       = 2000000;
const SCORE_HASH     = 2500000;

// MVV-LVA: 用 5 位 (victim) - 6 位 (attacker) -- 简化
const MVV_VALUE = [0, 900, 400, 200, 200, 10000, 450, 100,
                   900, 400, 200, 200, 10000, 450, 100];
const LVA_VALUE = [0, 0, 1, 2, 3, 4, 5, 6,
                   0, 1, 2, 3, 4, 5, 6];

function MovePicker(pos, ttMove, depth, killers, history) {
  this.pos     = pos;
  this.ttMove  = ttMove;
  this.depth   = depth;
  this.killers = killers || [0, 0];
  this.history = history;   // 14 * 90 数组, history[pt*90 + to]
  this.stage   = STAGE_TT;
  this.cur     = 0;
  this.end     = 0;
  this.mvs     = new Array(128);
  for (let i = 0; i < 128; i++) this.mvs[i] = new ExtMove(0, 0);
  this.skipQuiets = false;
  this.threshold = 0;   // SEE 阈值
  this.genBuf    = new Int32Array(256);
  this.genCount  = 0;
  this.triedSq   = 0;   // 用于在 quiescence 中去重
}

// -----------------------------------------------------------------------------
// 主入口
// -----------------------------------------------------------------------------

MovePicker.prototype.nextMove = function() {
  switch (this.stage) {
    case STAGE_TT:
      this.stage = STAGE_INIT_CAPT;
      if (this.ttMove && this.isLegal(this.ttMove)) return this.ttMove;
      // 继续
      return this.nextMove();

    case STAGE_INIT_CAPT:
      this.stage = STAGE_GOOD_CAPT;
      this.genCaptures();
      this.scoreCaptures();
      this.cur = 0; this.end = this.genCount;
      // 选 best
      this.selectBest(this.cur, this.end);
      return this.nextMove();

    case STAGE_GOOD_CAPT:
      if (this.cur < this.end) {
        const em = this.mvs[this.cur++];
        // 选当前最佳的 (使用部分选择排序, 每次选一个)
        // 实际上我们在 INIT 时已排序; 这里只需取一个
        // 检查 SEE >= threshold
        if (em.mv !== this.ttMove && this.see(em.mv) >= this.threshold) {
          return em.mv;
        }
        // 否则标记为 BAD_CAPT
        em.score = SCORE_BAD_CAPT;
        return this.nextMove();
      }
      this.stage = STAGE_KILLERS;
      // 继续
      return this.nextMove();

    case STAGE_KILLERS:
      this.stage = STAGE_INIT_QUIET;
      for (const k of this.killers) {
        if (k && k !== this.ttMove && this.isLegal(k)) return k;
      }
      return this.nextMove();

    case STAGE_INIT_QUIET:
      this.stage = STAGE_GOOD_QUIET;
      this.genQuiets();
      this.scoreQuiets();
      this.cur = 0; this.end = this.genCount;
      return this.nextMove();

    case STAGE_GOOD_QUIET:
      if (this.cur < this.end) {
        const em = this.mvs[this.cur++];
        // 取最大
        let best = this.cur - 1;
        for (let i = this.cur; i < this.end; i++) {
          if (this.mvs[i].score > this.mvs[best].score) best = i;
        }
        if (best !== this.cur - 1) {
          const t = this.mvs[best]; this.mvs[best] = this.mvs[this.cur-1]; this.mvs[this.cur-1] = t;
        }
        if (em.mv !== this.ttMove) return em.mv;
        return this.nextMove();
      }
      this.stage = STAGE_DONE;
      return MOVE_NONE;

    default:
      return MOVE_NONE;
  }
};

MovePicker.prototype.nextMoveQuiesc = function() {
  // Quiescence: 只走吃子
  if (this.stage === STAGE_TT) {
    this.stage = STAGE_INIT_CAPT;
    if (this.ttMove && this.isLegal(this.ttMove) && this.isCapture(this.ttMove)) {
      return this.ttMove;
    }
    return this.nextMoveQuiesc();
  }
  if (this.stage === STAGE_INIT_CAPT) {
    this.stage = STAGE_GOOD_CAPT;
    this.genCaptures();
    this.scoreCaptures();
    this.cur = 0; this.end = this.genCount;
    return this.nextMoveQuiesc();
  }
  if (this.stage === STAGE_GOOD_CAPT) {
    if (this.cur < this.end) {
      // 选 max
      let best = this.cur;
      for (let i = this.cur + 1; i < this.end; i++) {
        if (this.mvs[i].score > this.mvs[best].score) best = i;
      }
      if (best !== this.cur) {
        const t = this.mvs[best]; this.mvs[best] = this.mvs[this.cur]; this.mvs[this.cur] = t;
      }
      const em = this.mvs[this.cur++];
      if (em.mv !== this.ttMove) return em.mv;
      return this.nextMoveQuiesc();
    }
    this.stage = STAGE_DONE;
    return MOVE_NONE;
  }
  return MOVE_NONE;
};

// -----------------------------------------------------------------------------
// 工具
// -----------------------------------------------------------------------------

MovePicker.prototype.isLegal = function(mv) {
  if (!mv) return false;
  const from = moveFrom(mv);
  if (from < 0 || from >= 90) return false;
  const pc = this.pos.pieceOn[from];
  if (pc < 0) return false;
  if (COLOR_OF[pc] !== this.pos.side) return false;
  return true;
};

MovePicker.prototype.isCapture = function(mv) {
  const to = moveTo(mv);
  return this.pos.pieceOn[to] >= 0;
};

MovePicker.prototype.genCaptures = function() {
  this.genCount = 0;
  const mvs = this.genBuf;
  const n = this.pos.generateMoves(mvs);
  // 过滤: 只保留吃子
  let cap = 0;
  for (let i = 0; i < n; i++) {
    const mv = mvs[i];
    const to = moveTo(mv);
    if (this.pos.pieceOn[to] >= 0) {
      mvs[cap++] = mv;
    }
  }
  this.genCount = cap;
};

MovePicker.prototype.genQuiets = function() {
  const mvs = this.genBuf;
  const n = this.pos.generateMoves(mvs);
  let q = 0;
  for (let i = 0; i < n; i++) {
    const mv = mvs[i];
    const to = moveTo(mv);
    if (this.pos.pieceOn[to] < 0) {
      mvs[q++] = mv;
    }
  }
  this.genCount = q;
};

MovePicker.prototype.scoreCaptures = function() {
  for (let i = 0; i < this.genCount; i++) {
    const mv = this.genBuf[i];
    const to = moveTo(mv);
    const from = moveFrom(mv);
    const victim = this.pos.pieceOn[to];
    const attacker = this.pos.pieceOn[from];
    if (victim >= 0) {
      // MVV-LVA
      const score = MVV_VALUE[victim] * 10 - LVA_VALUE[attacker];
      this.mvs[i] = new ExtMove(mv, score);
    } else {
      this.mvs[i] = new ExtMove(mv, SCORE_BAD_CAPT);
    }
  }
};

MovePicker.prototype.scoreQuiets = function() {
  for (let i = 0; i < this.genCount; i++) {
    const mv = this.genBuf[i];
    const from = moveFrom(mv);
    const to = moveTo(mv);
    const pc = this.pos.pieceOn[from];
    if (pc < 0) {
      this.mvs[i] = new ExtMove(mv, 0);
      continue;
    }
    const pt = PIECE_TYPE[pc];
    // history[pt*90 + to]
    const hist = (this.history && this.history[pt * 90 + to]) || 0;
    this.mvs[i] = new ExtMove(mv, hist);
  }
};

MovePicker.prototype.selectBest = function(begin, end) {
  // 简单选择排序: 把最大值放到 begin
  let best = begin;
  for (let i = begin + 1; i < end; i++) {
    if (this.mvs[i].score > this.mvs[best].score) best = i;
  }
  if (best !== begin) {
    const t = this.mvs[best]; this.mvs[best] = this.mvs[begin]; this.mvs[begin] = t;
  }
};

// -----------------------------------------------------------------------------
// SEE (Static Exchange Evaluation) - 简化版
// -----------------------------------------------------------------------------

MovePicker.prototype.see = function(mv) {
  const from = moveFrom(mv);
  const to = moveTo(mv);
  const attacker = this.pos.pieceOn[from];
  const victim = this.pos.pieceOn[to];
  if (victim < 0) return 0;
  if (attacker < 0) return 0;

  // 增益: 被吃子价值 - 攻击者价值
  let gain = MVV_VALUE[victim] - MVV_VALUE[attacker];
  if (gain < 0) return gain;  // 极差交换

  // 简化: 仅做一层 SEE, 不递归
  return gain;
};

window.MovePicker = MovePicker;
window.ExtMove = ExtMove;
window.STAGE_TT = STAGE_TT;
window.STAGE_DONE = STAGE_DONE;
window.MVV_VALUE = MVV_VALUE;
window.LVA_VALUE = LVA_VALUE;
