/*
 * board.js - 棋盘视图与交互
 * 负责绘制棋盘 / 棋子 / 走子动画 / 音效 / 悔棋 / 重新开始
 * 引擎 (Search) 在主入口 main.js 中创建并通过 setSearch 注入
 */

"use strict";

import {
  IN_BOARD, FILE_X, RANK_Y, SRC, DST, MOVE,
  SQUARE_FLIP,
} from "./types.js";

import { Position } from "./position.js";

export const RESULT_UNKNOWN = 0;
export const RESULT_WIN = 1;
export const RESULT_DRAW = 2;
export const RESULT_LOSS = 3;

const BOARD_WIDTH = 521;
const BOARD_HEIGHT = 577;
const SQUARE_SIZE = 57;
const SQUARE_LEFT = (BOARD_WIDTH - SQUARE_SIZE * 9) >> 1;
const SQUARE_TOP = (BOARD_HEIGHT - SQUARE_SIZE * 10) >> 1;
const THINKING_SIZE = 32;
const THINKING_LEFT = (BOARD_WIDTH - THINKING_SIZE) >> 1;
const THINKING_TOP = (BOARD_HEIGHT - THINKING_SIZE) >> 1;
const MAX_STEP = 8;
const PIECE_NAME = [
  "oo", null, null, null, null, null, null, null,
  "rk", "ra", "rb", "rn", "rr", "rc", "rp", null,
  "bk", "ba", "bb", "bn", "br", "bc", "bp", null,
];

function SQ_X(sq) { return SQUARE_LEFT + (FILE_X(sq) - 3) * SQUARE_SIZE; }
function SQ_Y(sq) { return SQUARE_TOP + (RANK_Y(sq) - 3) * SQUARE_SIZE; }
function MOVE_PX(src, dst, step) {
  return Math.floor((src * step + dst * (MAX_STEP - step)) / MAX_STEP + .5) + "px";
}

function alertDelay(message) {
  setTimeout(() => alert(message), 250);
}

export class Board {
  constructor(container, images, sounds) {
    this.images = images;
    this.sounds = sounds;
    this.pos = new Position();
    this.pos.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
    this.animated = true;
    this.sound = true;
    this.search = null;
    this.imgSquares = new Array(256).fill(null);
    this.sqSelected = 0;
    this.mvLast = 0;
    this.millis = 0;
    this.computer = -1;
    this.result = RESULT_UNKNOWN;
    this.busy = false;

    // 引擎信息回调 (被 main.js 设置)
    this.onEngineInfo = null;
    this.onSearchStart = null;
    this.onSearchEnd = null;

    const style = container.style;
    style.position = "relative";
    style.width = BOARD_WIDTH + "px";
    style.height = BOARD_HEIGHT + "px";
    style.background = `url(${images}board.jpg)`;
    const self = this;
    for (let sq = 0; sq < 256; sq++) {
      if (!IN_BOARD(sq)) {
        this.imgSquares[sq] = null;
        continue;
      }
      const img = document.createElement("img");
      const s = img.style;
      s.position = "absolute";
      s.left = SQ_X(sq);
      s.top = SQ_Y(sq);
      s.width = SQUARE_SIZE;
      s.height = SQUARE_SIZE;
      s.zIndex = 0;
      img.onmousedown = (function (sq_) {
        return function () { self.clickSquare(sq_); };
      })(sq);
      container.appendChild(img);
      this.imgSquares[sq] = img;
    }

    this.thinking = document.createElement("img");
    this.thinking.src = `${images}thinking.gif`;
    const ts = this.thinking.style;
    ts.visibility = "hidden";
    ts.position = "absolute";
    ts.left = THINKING_LEFT + "px";
    ts.top = THINKING_TOP + "px";
    container.appendChild(this.thinking);

    this.dummy = document.createElement("div");
    this.dummy.style.position = "absolute";
    container.appendChild(this.dummy);

    this.flushBoard();
  }

  playSound(soundFile) {
    if (!this.sound) return;
    try {
      new Audio(this.sounds + soundFile + ".wav").play();
    } catch (e) {
      this.dummy.innerHTML = `<embed src="${this.sounds}${soundFile}.wav" hidden="true" autostart="true" loop="false" />`;
    }
  }

  setSearch(search) { this.search = search; }

  flipped(sq) { return this.computer === 0 ? SQUARE_FLIP(sq) : sq; }
  computerMove() { return this.pos.sdPlayer === this.computer; }

  addMove(mv, computerMove) {
    if (!this.pos.legalMove(mv)) return;
    if (!this.pos.makeMove(mv)) {
      this.playSound("illegal");
      return;
    }
    this.busy = true;
    if (!this.animated) {
      this.postAddMove(mv, computerMove);
      return;
    }
    const sqSrc = this.flipped(SRC(mv));
    const xSrc = SQ_X(sqSrc);
    const ySrc = SQ_Y(sqSrc);
    const sqDst = this.flipped(DST(mv));
    const xDst = SQ_X(sqDst);
    const yDst = SQ_Y(sqDst);
    const style = this.imgSquares[sqSrc].style;
    style.zIndex = 256;
    let step = MAX_STEP - 1;
    const self = this;
    const timer = setInterval(() => {
      if (step === 0) {
        clearInterval(timer);
        style.left = xSrc + "px";
        style.top = ySrc + "px";
        style.zIndex = 0;
        self.postAddMove(mv, computerMove);
      } else {
        style.left = MOVE_PX(xSrc, xDst, step);
        style.top = MOVE_PX(ySrc, yDst, step);
        step--;
      }
    }, 16);
  }

  postAddMove(mv, computerMove) {
    if (this.mvLast > 0) {
      this.drawSquare(SRC(this.mvLast), false);
      this.drawSquare(DST(this.mvLast), false);
    }
    this.drawSquare(SRC(mv), true);
    this.drawSquare(DST(mv), true);
    this.sqSelected = 0;
    this.mvLast = mv;

    if (this.pos.isMate()) {
      this.playSound(computerMove ? "loss" : "win");
      this.result = computerMove ? RESULT_LOSS : RESULT_WIN;
      const pc = 8 + (this.pos.sdPlayer === 0 ? 0 : 8) + 0; // PIECE_KING
      // 简化：直接显示结果
      const sqMate = 0;
      if (!this.animated || sqMate === 0) {
        this.postMate(computerMove);
        return;
      }
      this.postMate(computerMove);
      return;
    }

    const vlRep = this.pos.repStatus(3);
    if (vlRep > 0) {
      const v = this.pos.repValue(vlRep);
      if (v > -WIN_VALUE && v < WIN_VALUE) {
        this.playSound("draw");
        this.result = RESULT_DRAW;
        alertDelay("双方不变作和，辛苦了！");
      } else if (computerMove === (v < 0)) {
        this.playSound("loss");
        this.result = RESULT_LOSS;
        alertDelay("长打作负，请不要气馁！");
      } else {
        this.playSound("win");
        this.result = RESULT_WIN;
        alertDelay("长打作负，祝贺你取得胜利！");
      }
      this.postAddMove2();
      this.busy = false;
      return;
    }

    if (this.pos.captured()) {
      let hasMaterial = false;
      for (let sq = 0; sq < 256; sq++) {
        if (IN_BOARD(sq) && (this.pos.squares[sq] & 7) > 2) {
          hasMaterial = true;
          break;
        }
      }
      if (!hasMaterial) {
        this.playSound("draw");
        this.result = RESULT_DRAW;
        alertDelay("双方都没有进攻棋子了，辛苦了！");
        this.postAddMove2();
        this.busy = false;
        return;
      }
    } else if (this.pos.pcList.length > 100) {
      let captured = false;
      for (let i = 2; i <= 100; i++) {
        if (this.pos.pcList[this.pos.pcList.length - i] > 0) {
          captured = true;
          break;
        }
      }
      if (!captured) {
        this.playSound("draw");
        this.result = RESULT_DRAW;
        alertDelay("超过自然限着作和，辛苦了！");
        this.postAddMove2();
        this.busy = false;
        return;
      }
    }

    if (this.pos.inCheck()) this.playSound(computerMove ? "check2" : "check");
    else if (this.pos.captured()) this.playSound(computerMove ? "capture2" : "capture");
    else this.playSound(computerMove ? "move2" : "move");

    this.postAddMove2();
    this.response();
  }

  postAddMove2() {
    if (typeof this.onAddMove === "function") this.onAddMove();
  }

  postMate(computerMove) {
    alertDelay(computerMove ? "请再接再厉！" : "祝贺你取得胜利！");
    this.postAddMove2();
    this.busy = false;
  }

  response() {
    if (this.search == null || !this.computerMove()) {
      this.busy = false;
      return;
    }
    this.thinking.style.visibility = "visible";
    const self = this;
    this.busy = true;
    setTimeout(() => {
      if (this.onSearchStart) this.onSearchStart();
      const mv = self.search.searchMain(64, self.millis, self.bookDat);
      if (this.onSearchEnd) this.onSearchEnd();
      self.thinking.style.visibility = "hidden";
      self.addMove(mv, true);
    }, 250);
  }

  clickSquare(sq_) {
    if (this.busy || this.result !== RESULT_UNKNOWN) return;
    const sq = this.flipped(sq_);
    const pc = this.pos.squares[sq];
    if ((pc & (8 + (this.pos.sdPlayer << 3))) !== 0) {
      this.playSound("click");
      if (this.mvLast !== 0) {
        this.drawSquare(SRC(this.mvLast), false);
        this.drawSquare(DST(this.mvLast), false);
      }
      if (this.sqSelected) this.drawSquare(this.sqSelected, false);
      this.drawSquare(sq, true);
      this.sqSelected = sq;
    } else if (this.sqSelected > 0) {
      this.addMove(MOVE(this.sqSelected, sq), false);
    }
  }

  drawSquare(sq, selected) {
    const img = this.imgSquares[this.flipped(sq)];
    img.src = this.images + PIECE_NAME[this.pos.squares[sq]] + ".gif";
    img.style.backgroundImage = selected ? `url(${this.images}oos.gif)` : "";
  }

  flushBoard() {
    this.mvLast = this.pos.mvList[this.pos.mvList.length - 1];
    for (let sq = 0; sq < 256; sq++) {
      if (IN_BOARD(sq)) {
        this.drawSquare(sq, sq === SRC(this.mvLast) || sq === DST(this.mvLast));
      }
    }
  }

  restart(fen) {
    if (this.busy) return;
    this.result = RESULT_UNKNOWN;
    this.pos.fromFen(fen);
    this.flushBoard();
    this.playSound("newgame");
    this.response();
  }

  retract() {
    if (this.busy) return;
    this.result = RESULT_UNKNOWN;
    if (this.pos.mvList.length > 1) this.pos.undoMakeMove();
    if (this.pos.mvList.length > 1 && this.computerMove()) this.pos.undoMakeMove();
    this.flushBoard();
    this.response();
  }

  setSound(sound) {
    this.sound = sound;
    if (sound) this.playSound("click");
  }
}
