/*
 * board.js - 棋盘 UI 控制 (Pikafish 引擎前端)
 *
 * 适配新的 Position API (0-89 位棋盘)
 * 在底部显示 Pikafish 风格搜索信息 (depth, score, pv, knps)
 */

"use strict";

const RESULT_UNKNOWN = 0;
const RESULT_WIN     = 1;
const RESULT_DRAW    = 2;
const RESULT_LOSS    = 3;

const THINKING_SIZE  = 32;

// =============================================================================
// Board
// =============================================================================

function Board(container, opts) {
  this.container = container;
  this.pos = new Position();
  this.pos.setFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  this.animated = true;
  this.sound = false;
  this.search = null;
  this.sqSelected = -1;
  this.mvLast = 0;
  this.millis = 1000;  // 默认思考 1 秒
  this.computer = -1;   // -1=人, 0=红=电脑, 1=黑=电脑
  this.result = RESULT_UNKNOWN;
  this.busy = false;
  this.flipped = false;

  this.mvList = [];  // 历史走子

  this.sqEls = new Array(90);

  this.init();
}

Board.prototype.init = function() {
  const this_ = this;
  const c = this.container;
  c.innerHTML = "";
  c.style.position = "relative";
  const w = BOARD_OFFSET_X * 2 + BOARD_W * SQUARE_W;
  const h = BOARD_OFFSET_Y * 2 + BOARD_H * SQUARE_H;
  c.style.width  = w + "px";
  c.style.height = h + "px";

  // 背景: 画一个简单的棋盘 (用 canvas 不用图片)
  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top  = "0";
  c.appendChild(canvas);
  this.drawBoardBackground(canvas);
  this.bgCanvas = canvas;

  // 9x10 棋格 + 棋子
  for (let r = 0; r < BOARD_H; r++) {
    for (let f = 0; f < BOARD_W; f++) {
      const sq = f + r * 9;
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.left = (BOARD_OFFSET_X + f * SQUARE_W) + "px";
      el.style.top  = (BOARD_OFFSET_Y + r * SQUARE_H) + "px";
      el.style.width  = SQUARE_W + "px";
      el.style.height = SQUARE_H + "px";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = (SQUARE_W - 16) + "px";
      el.style.fontWeight = "bold";
      el.style.userSelect = "none";
      el.style.cursor = "pointer";
      el.style.zIndex = "1";
      el.onclick = (function(sq_) { return function() { this_.clickSquare(sq_); }; })(sq);
      c.appendChild(el);
      this.sqEls[sq] = el;
    }
  }

  // info div
  this.infoEl = document.createElement("div");
  this.infoEl.style.position = "absolute";
  this.infoEl.style.left = "0";
  this.infoEl.style.top = (h + 8) + "px";
  this.infoEl.style.width = w + "px";
  this.infoEl.style.fontFamily = "monospace";
  this.infoEl.style.fontSize = "13px";
  this.infoEl.style.color = "#222";
  this.infoEl.style.background = "#f4f4f4";
  this.infoEl.style.border = "1px solid #ddd";
  this.infoEl.style.padding = "8px";
  this.infoEl.style.whiteSpace = "pre";
  this.infoEl.style.zIndex = "5";
  this.infoEl.innerText = "等待开始...";
  c.appendChild(this.infoEl);

  // thinking gif / spinner
  this.thinking = document.createElement("div");
  this.thinking.style.position = "absolute";
  this.thinking.style.left = (w / 2 - THINKING_SIZE / 2) + "px";
  this.thinking.style.top  = (h / 2 - THINKING_SIZE / 2) + "px";
  this.thinking.style.width  = THINKING_SIZE + "px";
  this.thinking.style.height = THINKING_SIZE + "px";
  this.thinking.style.border = "4px solid #f3f3f3";
  this.thinking.style.borderTop = "4px solid #3498db";
  this.thinking.style.borderRadius = "50%";
  this.thinking.style.animation = "spin 1s linear infinite";
  this.thinking.style.display = "none";
  this.thinking.style.zIndex = "10";
  c.appendChild(this.thinking);

  // CSS animation
  if (!document.getElementById("__board_style__")) {
    const style = document.createElement("style");
    style.id = "__board_style__";
    style.innerHTML = "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }

  this.flushBoard();
};

Board.prototype.drawBoardBackground = function(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f0d8a8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#5b3a1e";
  ctx.lineWidth = 1;

  // 画 9x10 网格
  for (let r = 0; r < BOARD_H; r++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_OFFSET_X, BOARD_OFFSET_Y + r * SQUARE_H);
    ctx.lineTo(BOARD_OFFSET_X + (BOARD_W - 1) * SQUARE_W, BOARD_OFFSET_Y + r * SQUARE_H);
    ctx.stroke();
  }
  for (let f = 0; f < BOARD_W; f++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_OFFSET_X + f * SQUARE_W, BOARD_OFFSET_Y);
    ctx.lineTo(BOARD_OFFSET_X + f * SQUARE_W, BOARD_OFFSET_Y + (BOARD_H - 1) * SQUARE_H);
    ctx.stroke();
  }
  // 上下边线
  for (let i = 0; i < 2; i++) {
    const y = i === 0 ? BOARD_OFFSET_Y - SQUARE_H / 2 : BOARD_OFFSET_Y + (BOARD_H - 0.5) * SQUARE_H;
    // 上下边框再画一遍
    // 简化: 画棋盘上下边线
  }
  // 边线
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(BOARD_OFFSET_X - SQUARE_W / 2, BOARD_OFFSET_Y - SQUARE_H / 2,
           BOARD_W * SQUARE_W, BOARD_H * SQUARE_H);
  ctx.stroke();
  ctx.lineWidth = 1;

  // 宫 (九宫格) - 红方
  ctx.beginPath();
  ctx.moveTo(BOARD_OFFSET_X + 3 * SQUARE_W, BOARD_OFFSET_Y + 7 * SQUARE_H);
  ctx.lineTo(BOARD_OFFSET_X + 5 * SQUARE_W, BOARD_OFFSET_Y + 9 * SQUARE_H);
  ctx.moveTo(BOARD_OFFSET_X + 5 * SQUARE_W, BOARD_OFFSET_Y + 7 * SQUARE_H);
  ctx.lineTo(BOARD_OFFSET_X + 3 * SQUARE_W, BOARD_OFFSET_Y + 9 * SQUARE_H);
  ctx.stroke();
  // 宫 - 黑方
  ctx.beginPath();
  ctx.moveTo(BOARD_OFFSET_X + 3 * SQUARE_W, BOARD_OFFSET_Y + 0 * SQUARE_H);
  ctx.lineTo(BOARD_OFFSET_X + 5 * SQUARE_W, BOARD_OFFSET_Y + 2 * SQUARE_H);
  ctx.moveTo(BOARD_OFFSET_X + 5 * SQUARE_W, BOARD_OFFSET_Y + 0 * SQUARE_H);
  ctx.lineTo(BOARD_OFFSET_X + 3 * SQUARE_W, BOARD_OFFSET_Y + 2 * SQUARE_H);
  ctx.stroke();
};

// -----------------------------------------------------------------------------
// 棋盘显示
// -----------------------------------------------------------------------------

Board.prototype.flushBoard = function() {
  for (let sq = 0; sq < 90; sq++) {
    const pc = this.pos.pieceOn[sq];
    const el = this.sqEls[sq];
    el.innerText = pieceToChar(pc);
    el.style.color = (pc >= 0 && pc < 7) ? "#c00" : "#000";
    el.style.background = "transparent";
  }
  // 高亮上一步
  if (this.mvLast) {
    const from = moveFrom(this.mvLast);
    const to = moveTo(this.mvLast);
    this.sqEls[from].style.background = "rgba(255,255,0,0.3)";
    this.sqEls[to].style.background   = "rgba(255,255,0,0.5)";
  }
};

// -----------------------------------------------------------------------------
// 用户点击
// -----------------------------------------------------------------------------

Board.prototype.clickSquare = function(sq) {
  if (this.busy || this.result !== RESULT_UNKNOWN) return;
  if (this.computer !== -1 && this.pos.side === this.computer) return;

  const pc = this.pos.pieceOn[sq];
  if (pc >= 0 && COLOR_OF[pc] === this.pos.side) {
    // 选中我方棋子
    this.sqSelected = sq;
    this.highlightSelect();
  } else if (this.sqSelected >= 0) {
    // 尝试走子
    const mv = makeMove(this.sqSelected, sq);
    if (this.tryMove(mv)) {
      this.sqSelected = -1;
      this.flushBoard();
    }
  }
};

Board.prototype.highlightSelect = function() {
  for (let s = 0; s < 90; s++) {
    this.sqEls[s].style.background = "transparent";
  }
  if (this.mvLast) {
    this.sqEls[moveFrom(this.mvLast)].style.background = "rgba(255,255,0,0.3)";
    this.sqEls[moveTo(this.mvLast)].style.background   = "rgba(255,255,0,0.5)";
  }
  if (this.sqSelected >= 0) {
    this.sqEls[this.sqSelected].style.background = "rgba(0,200,0,0.4)";
  }
};

Board.prototype.tryMove = function(mv) {
  const from = moveFrom(mv);
  const to = moveTo(mv);
  const pc = this.pos.pieceOn[from];
  if (pc < 0) return false;
  if (COLOR_OF[pc] !== this.pos.side) return false;
  // 检查合法性: 走子后是否送将
  const worker = this.worker;
  if (!worker.makeMoveLegal(mv)) return false;
  this.pos.doMove(mv, null);
  this.mvList.push(mv);
  this.mvLast = mv;
  this.busy = true;
  this.flushBoard();
  this.busy = false;
  // 检查游戏结束
  this.checkGameEnd(false);
  // 电脑回复
  if (!this.busy && this.result === RESULT_UNKNOWN) this.computerResponse();
  return true;
};

// -----------------------------------------------------------------------------
// 电脑思考
// -----------------------------------------------------------------------------

Board.prototype.computerResponse = function() {
  if (this.computer === -1) return;
  if (this.pos.side !== this.computer) return;
  this.thinking.style.display = "block";
  this.busy = true;
  // 同步 worker's pos 到 board 的 pos
  for (let p = 0; p < 14; p++) this.worker.pos.byPieceBB[p] = this.pos.byPieceBB[p];
  this.worker.pos.occRed = this.pos.occRed;
  this.worker.pos.occBlk = this.pos.occBlk;
  this.worker.pos.occ    = this.pos.occ;
  this.worker.pos.side   = this.pos.side;
  this.worker.pos.pieceOn = this.pos.pieceOn.slice();
  this.worker.pos.kingRed = this.pos.kingRed;
  this.worker.pos.kingBlk = this.pos.kingBlk;
  this.worker.timeLimit = this.millis;
  this.worker.maxDepth  = 32;
  const this_ = this;
  // 异步: 让 UI 有时间更新
  setTimeout(function() {
    const mv = this_.worker.searchRoot();
    this_.thinking.style.display = "none";
    if (mv) {
      this_.pos.doMove(mv, null);
      this_.mvList.push(mv);
      this_.mvLast = mv;
      this_.flushBoard();
      if (this_.onAddMove) this_.onAddMove();
    }
    this_.checkGameEnd(true);
    this_.busy = false;
  }, 50);
};

Board.prototype.checkGameEnd = function(computerMove) {
  const mvs = new Int32Array(256);
  const n = this.pos.generateLegalMoves(mvs);
  if (n === 0) {
    this.result = computerMove ? RESULT_LOSS : RESULT_WIN;
    this.infoEl.innerText = (this.result === RESULT_WIN ? "你赢了!" : "电脑赢了!") + " (将死)";
    return;
  }
  // 简单和棋: 没有进攻子
  // (省略)
};

// -----------------------------------------------------------------------------
// 启动 / 重启
// -----------------------------------------------------------------------------

Board.prototype.start = function(computerSide, fen) {
  this.computer = computerSide;  // -1: 玩家, 0: 红方电脑, 1: 黑方电脑
  if (fen) this.pos.setFen(fen);
  this.mvList = [];
  this.mvLast = 0;
  this.sqSelected = -1;
  this.result = RESULT_UNKNOWN;
  this.busy = false;
  this.worker = new SearchWorker();
  // 复制 position 到 worker
  this.worker.pos.byPieceBB = this.pos.byPieceBB.slice();
  this.worker.pos.occRed = this.pos.occRed;
  this.worker.pos.occBlk = this.pos.occBlk;
  this.worker.pos.occ    = this.pos.occ;
  this.worker.pos.side   = this.pos.side;
  this.worker.pos.pieceOn = this.pos.pieceOn.slice();
  this.worker.pos.kingRed = this.pos.kingRed;
  this.worker.pos.kingBlk = this.pos.kingBlk;
  this.worker.timeLimit = this.millis;
  this.worker.maxDepth  = 32;

  this.flushBoard();
  this.computerResponse();
};

Board.prototype.retract = function() {
  if (this.mvList.length === 0) return;
  // 撤销玩家和电脑的最后一手
  this.pos.undoMove();
  this.mvList.pop();
  if (this.mvList.length > 0 && this.pos.side !== this.computer) {
    this.pos.undoMove();
    this.mvList.pop();
  }
  this.mvLast = this.mvList[this.mvList.length - 1] || 0;
  this.sqSelected = -1;
  this.flushBoard();
};

// =============================================================================
// 搜索信息回调 (Pikafish 风格)
// =============================================================================

window.onSearchInfo = function(info) {
  // 找到 Board 实例
  if (typeof window._board === 'undefined') return;
  const board = window._board;
  if (!board.infoEl) return;

  // 评分 -> 红方视角 (cp)
  // 在 SearchWorker 中 score 是从走子方视角
  // 走子方 == 当前 side
  // 我们用 cp = score * (红方为 1, 黑方为 -1)
  let scoreCp = info.score;
  // 转为红方视角: 如果当前是黑方走, 翻转
  // 这里我们假设搜索时 side 已经被记录
  // 简化: 直接显示
  let scoreStr;
  if (Math.abs(info.score) > 29000) {
    const mateIn = (MATE_VALUE - Math.abs(info.score));
    scoreStr = (info.score > 0 ? "+" : "-") + "M" + mateIn;
  } else {
    scoreStr = (info.score > 0 ? "+" : "") + info.score;
  }

  // PV: 转 ICCS
  const pvStr = info.pv.map(function(mv) {
    return moveToIccs(mv, board.flipped);
  }).join(" ");

  // 输出 Pikafish 风格:
  // info depth 8 score cp +50 nodes 12345 nps 5000 time 2468 pv e2e4 e7e5
  let line = "info";
  line += " depth " + info.depth;
  line += " score cp " + scoreStr;
  line += " nodes " + info.nodes;
  line += " nps " + (info.knps * 1000);
  line += " time " + info.time;
  line += " pv " + pvStr;
  board.infoEl.innerText = line + "\nknps: " + info.knps + " | best: " + (info.pv[0] ? moveToIccs(info.pv[0], board.flipped) : "...");
};

window.Board = Board;
