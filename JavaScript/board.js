/*
 * board.js - Board UI for Pikafish-JS.
 * Updated to use the new bitboard-based Position and Search.
 */
"use strict";

var RESULT_UNKNOWN = 0;
var RESULT_WIN    = 1;
var RESULT_DRAW   = 2;
var RESULT_LOSS   = 3;

var BOARD_WIDTH   = 521;
var BOARD_HEIGHT  = 577;
var SQUARE_SIZE   = 57;
var SQUARE_LEFT   = (BOARD_WIDTH - SQUARE_SIZE * 9) >> 1;
var SQUARE_TOP    = (BOARD_HEIGHT - SQUARE_SIZE * 10) >> 1;
var THINKING_SIZE = 32;
var THINKING_LEFT = (BOARD_WIDTH - THINKING_SIZE) >> 1;
var THINKING_TOP  = (BOARD_HEIGHT - THINKING_SIZE) >> 1;
var MAX_STEP      = 8;

// Piece-name table indexed by piece code (0..22).
// Layout: 0..7 empty/king..pawn (type), 8..14 red pieces, 16..22 black pieces.
var PIECE_NAME = [
  "oo", "ka", "kb", "kn", "rr", "rc", "rp", "oo",
  "rk", "ra", "bb", "bn", "br", "bc", "bp", "oo",
  "bk", "ba", "bb", "bn", "br", "bc", "bp", "oo"
];

// Image mapping: same as before, but indexed by type and color
var IMAGE_FOR_TYPE = {
  // type: [red, black]
  0: ["rk", "bk"],
  1: ["ra", "ba"],
  2: ["bb", "bb"],
  3: ["bn", "bn"],
  4: ["rr", "br"],
  5: ["rc", "bc"],
  6: ["rp", "bp"]
};

function SQ_X(sq) { return SQUARE_LEFT + (sq % 9) * SQUARE_SIZE; }
function SQ_Y(sq) { return SQUARE_TOP  + Math.floor(sq / 9) * SQUARE_SIZE; }

function MOVE_PX(src, dst, step) {
  return Math.floor((src * step + dst * (MAX_STEP - step)) / MAX_STEP + .5) + "px";
}

function alertDelay(message) {
  setTimeout(function() { alert(message); }, 250);
}

function Board(container, images, sounds) {
  this.images = images;
  this.sounds = sounds;
  this.pos = new Position();
  this.pos.set_fen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  this.animated = true;
  this.sound    = true;
  this.search   = null;
  this.imgSquares = new Array(90);
  this.sqSelected = -1;
  this.mvLast     = 0;
  this.millis     = 0;
  this.computer   = -1;
  this.result     = RESULT_UNKNOWN;
  this.busy       = false;
  this.mvList     = [];

  // Build the 9x10 board UI
  var style = container.style;
  style.position = "relative";
  style.width  = BOARD_WIDTH  + "px";
  style.height = BOARD_HEIGHT + "px";
  style.background = "url(" + images + "board.jpg)";

  var this_ = this;
  for (var sq = 0; sq < 90; sq++) {
    var img = document.createElement("img");
    var is = img.style;
    is.position = "absolute";
    is.left = SQ_X(sq) + "px";
    is.top  = SQ_Y(sq) + "px";
    is.width  = SQUARE_SIZE;
    is.height = SQUARE_SIZE;
    is.zIndex = 0;
    img.onmousedown = (function(sq_) { return function() { this_.clickSquare(sq_); }; })(sq);
    container.appendChild(img);
    this.imgSquares[sq] = img;
  }

  this.thinking = document.createElement("img");
  this.thinking.src = images + "thinking.gif";
  var ts = this.thinking.style;
  ts.visibility = "hidden";
  ts.position = "absolute";
  ts.left = THINKING_LEFT + "px";
  ts.top  = THINKING_TOP  + "px";
  container.appendChild(this.thinking);

  this.dummy = document.createElement("div");
  this.dummy.style.position = "absolute";
  container.appendChild(this.dummy);

  this.flushBoard();
}

Board.prototype.playSound = function(soundFile) {
  if (!this.sound) return;
  try {
    new Audio(this.sounds + soundFile + ".wav").play();
  } catch (e) {
    this.dummy.innerHTML = "<embed src=\"" + this.sounds + soundFile +
        ".wav\" hidden=\"true\" autostart=\"true\" loop=\"false\" />";
  }
};

Board.prototype.setSearch = function(hashLevel) {
  this.search = new Search(this.pos, hashLevel);
  this.search.onInfo = function(info) {
    if (typeof board.onInfo === "function") board.onInfo(info);
  };
};

Board.prototype.flipped = function(sq) {
  return this.computer === 0 ? (8 - (sq % 9)) + (9 - Math.floor(sq / 9)) * 9 : sq;
};

Board.prototype.computerMove = function() {
  return this.pos.sideToMove === this.computer;
};

Board.prototype.computerLastMove = function() {
  return (1 - this.pos.sideToMove) === this.computer;
};

Board.prototype.addMove = function(mv, computerMove) {
  if (!mv) return;
  if (!this.pos.is_legal(mv)) {
    this.playSound("illegal");
    return;
  }
  this.busy = true;
  this.mvList.push(mv);
  if (!this.animated) {
    this.postAddMove(mv, computerMove);
    return;
  }
  var sqSrc = this.flipped(SRC(mv));
  var xSrc = SQ_X(sqSrc), ySrc = SQ_Y(sqSrc);
  var sqDst = this.flipped(DST(mv));
  var xDst = SQ_X(sqDst), yDst = SQ_Y(sqDst);
  var img = this.imgSquares[sqSrc];
  var style = img.style;
  style.zIndex = 256;
  var step = MAX_STEP - 1;
  var this_ = this;
  var timer = setInterval(function() {
    if (step === 0) {
      clearInterval(timer);
      style.left = xSrc + "px";
      style.top  = ySrc + "px";
      style.zIndex = 0;
      this_.postAddMove(mv, computerMove);
    } else {
      style.left = MOVE_PX(xSrc, xDst, step);
      style.top  = MOVE_PX(ySrc, yDst, step);
      step--;
    }
  }, 16);
};

Board.prototype.postAddMove = function(mv, computerMove) {
  if (this.mvLast > 0) {
    this.drawSquare(SRC(this.mvLast), false);
    this.drawSquare(DST(this.mvLast), false);
  }
  this.drawSquare(SRC(mv), true);
  this.drawSquare(DST(mv), true);
  this.sqSelected = -1;
  this.mvLast = mv;

  // Check for mate
  if (this.pos.in_check() && this.no_legal_moves()) {
    this.playSound(computerMove ? "loss" : "win");
    this.result = computerMove ? RESULT_LOSS : RESULT_WIN;
    var pc = SIDE_TAG(this.pos.sideToMove) + KING;
    var sqMate = -1;
    for (var sq = 0; sq < 90; sq++) {
      if (this.pos.pieceOn[sq] === pc) { sqMate = sq; break; }
    }
    if (!this.animated || sqMate < 0) {
      this.postMate(computerMove);
      return;
    }
    var sqMateFlipped = this.flipped(sqMate);
    var style = this.imgSquares[sqMateFlipped].style;
    style.zIndex = 256;
    var xMate = SQ_X(sqMateFlipped);
    var step = MAX_STEP;
    var this_ = this;
    var timer = setInterval(function() {
      if (step === 0) {
        clearInterval(timer);
        style.left = xMate + "px";
        style.zIndex = 0;
        this_.imgSquares[sqMateFlipped].src = this_.images +
          (this_.pos.sideToMove === RED ? "r" : "b") + "km.gif";
        this_.postMate(computerMove);
      } else {
        style.left = (xMate + ((step & 1) === 0 ? step : -step) * 2) + "px";
        step--;
      }
    }, 50);
    return;
  }

  // No mate. Check sounds and continue.
  if (this.pos.in_check()) {
    this.playSound(computerMove ? "check2" : "check");
  } else if (this.was_capture(mv)) {
    this.playSound(computerMove ? "capture2" : "capture");
  } else {
    this.playSound(computerMove ? "move2" : "move");
  }

  if (typeof this.onAddMove === "function") this.onAddMove();
  this.response();
};

Board.prototype.postMate = function(computerMove) {
  alertDelay(computerMove ? "请再接再厉！" : "祝贺你取得胜利！");
  if (typeof this.onAddMove === "function") this.onAddMove();
  this.busy = false;
};

Board.prototype.was_capture = function(mv) {
  // Captured piece is the dst square's pre-move piece. We tracked via mvList earlier.
  // Easiest: look at the st.captured of the position.
  return this.pos.st[this.pos.st.length - 1].captured !== 0;
};

Board.prototype.no_legal_moves = function() {
  var moves = [];
  this.pos.generate_pseudo(moves);
  for (var i = 0; i < moves.length; i++) {
    if (this.pos.do_move(moves[i])) { this.pos.undo_move(); return false; }
  }
  return true;
};

Board.prototype.response = function() {
  if (this.search === null || !this.computerMove()) {
    this.busy = false;
    return;
  }
  this.thinking.style.visibility = "visible";
  var this_ = this;
  this.busy = true;
  setTimeout(function() {
    var mv = board.search.searchMain(64, board.millis);
    board.thinking.style.visibility = "hidden";
    this_.addMove(mv, true);
  }, 250);
};

Board.prototype.clickSquare = function(sq_) {
  if (this.busy || this.result !== RESULT_UNKNOWN) return;
  var sq = this.flipped(sq_);
  var pc = this.pos.pieceOn[sq];
  if ((pc & SIDE_TAG(this.pos.sideToMove)) !== 0) {
    this.playSound("click");
    if (this.mvLast !== 0) {
      this.drawSquare(SRC(this.mvLast), false);
      this.drawSquare(DST(this.mvLast), false);
    }
    if (this.sqSelected >= 0) this.drawSquare(this.sqSelected, false);
    this.drawSquare(sq, true);
    this.sqSelected = sq;
  } else if (this.sqSelected >= 0) {
    this.addMove(MOVE(this.sqSelected, sq), false);
  }
};

Board.prototype.drawSquare = function(sq, selected) {
  var sqFlipped = this.flipped(sq);
  var img = this.imgSquares[sqFlipped];
  if (!img) return;
  var pc = this.pos.pieceOn[sq];
  if (pc === 0) {
    img.src = this.images + "oo.gif";
  } else {
    var t = type_of(pc);
    var c = color_of(pc);
    var code = IMAGE_FOR_TYPE[t][c];
    img.src = this.images + code + ".gif";
  }
  img.style.backgroundImage = selected ? "url(" + this.images + "oos.gif)" : "";
};

Board.prototype.flushBoard = function() {
  this.mvLast = 0;
  for (var sq = 0; sq < 90; sq++) this.drawSquare(sq, false);
};

Board.prototype.restart = function(fen) {
  if (this.busy) return;
  this.result = RESULT_UNKNOWN;
  this.mvList = [];
  // Strip the move counters and full-move number from FEN
  var f = fen.split(" ");
  var startFen = f[0] + " " + (f[1] || "w") + " - - 0 1";
  this.pos.set_fen(startFen);
  this.flushBoard();
  this.playSound("newgame");
  this.response();
};

Board.prototype.retract = function() {
  if (this.busy) return;
  this.result = RESULT_UNKNOWN;
  if (this.pos.st.length > 2) this.pos.undo_move();
  if (this.pos.st.length > 2 && this.computerMove()) this.pos.undo_move();
  this.mvList.pop();
  this.mvList.pop();
  this.mvLast = this.mvList[this.mvList.length - 1] || 0;
  this.flushBoard();
  this.response();
};

Board.prototype.setSound = function(sound) {
  this.sound = sound;
  if (sound) this.playSound("click");
};
