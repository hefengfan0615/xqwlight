/*
 * position.js - Strong Xiangqi Position & Evaluation
 *
 * Pikafish-HCE-JS : A JavaScript port of the Pikafish-HCE principles
 * (Stockfish-style alpha-beta search + advanced Xiangqi evaluation).
 */

"use strict";

var MATE_VALUE       = 100000;
var BAN_VALUE        =  MATE_VALUE - 100;
var WIN_VALUE        =  MATE_VALUE - 200;
var DRAW_VALUE       = 20;
var ADVANCED_VALUE   = 3;
var NULL_SAFE_MARGIN = 400;
var NULL_OKAY_MARGIN = 200;

var PIECE_KING   = 0;
var PIECE_ADVISOR= 1;
var PIECE_BISHOP = 2;
var PIECE_KNIGHT = 3;
var PIECE_ROOK   = 4;
var PIECE_CANNON = 5;
var PIECE_PAWN   = 6;

function SIDE_TAG(sd)    { return 8  + (sd << 3); }
function OPP_SIDE_TAG(sd){ return 16 - (sd << 3); }

function RANK_Y(sq) { return sq >> 4; }
function FILE_X(sq) { return sq & 15; }
function COORD_XY(x, y) { return x + (y << 4); }
function SQUARE_FLIP(sq) { return 254 - sq; }
function FILE_FLIP(x)    { return 14 - x; }
function RANK_FLIP(y)    { return 15 - y; }
function MIRROR_SQUARE(sq) { return COORD_XY(FILE_FLIP(FILE_X(sq)), RANK_Y(sq)); }
function SQUARE_FORWARD(sq, sd) { return sq - 16 + (sd << 5); }

function SRC(mv) { return mv & 255; }
function DST(mv) { return mv >> 8; }
function MOVE(sqSrc, sqDst) { return sqSrc + (sqDst << 8); }
function MIRROR_MOVE(mv) { return MOVE(MIRROR_SQUARE(SRC(mv)), MIRROR_SQUARE(DST(mv))); }

function HOME_HALF(sq, sd)    { return (sq & 0x80) != (sd << 7); }
function AWAY_HALF(sq, sd)    { return (sq & 0x80) == (sd << 7); }
function SAME_HALF(s1, s2)    { return ((s1 ^ s2) & 0x80) == 0; }
function SAME_RANK(s1, s2)    { return ((s1 ^ s2) & 0xf0) == 0; }
function SAME_FILE(s1, s2)    { return ((s1 ^ s2) & 0x0f) == 0; }

var IN_BOARD_ = new Array(256);
var IN_FORT_  = new Array(256);
var LEGAL_SPAN = new Array(512);
var KNIGHT_PIN_ = new Array(512);
var KING_DELTA  = [-16, -1, 1, 16];
var ADVISOR_DELTA = [-17, -15, 15, 17];
var KNIGHT_DELTA = [[-33,-31],[-18, 14],[-14, 18],[ 31, 33]];
var KNIGHT_CHECK_DELTA = [[-33,-18],[-31,-14],[ 14, 31],[ 18, 33]];
var MVV_VALUE = [50, 10, 10, 30, 40, 30, 20, 0];
function MVV_LVA(victim, attacker) { return (MVV_VALUE[victim & 7] << 3) - attacker; }

(function initBoards() {
  for (var i = 0; i < 256; i++) {
    var x = i & 15, y = i >> 4;
    IN_BOARD_[i] = 0;
    IN_FORT_[i]  = 0;
    if (x >= 3 && x <= 11 && y >= 0 && y <= 9) IN_BOARD_[i] = 1;
    if (x >= 3 && x <= 5  && y >= 0 && y <= 2) IN_FORT_[i] = 1;
    if (x >= 7 && x <= 11 && y >= 0 && y <= 2) IN_FORT_[i] = 1;
    if (x >= 3 && x <= 5  && y >= 7 && y <= 9) IN_FORT_[i] = 1;
    if (x >= 7 && x <= 11 && y >= 7 && y <= 9) IN_FORT_[i] = 1;
  }
  for (var i = 0; i < 512; i++) {
    LEGAL_SPAN[i] = 0;
    KNIGHT_PIN_[i] = 0;
  }
  LEGAL_SPAN[256 - 16] = 1; LEGAL_SPAN[256 - 1] = 1; LEGAL_SPAN[256 + 1] = 1; LEGAL_SPAN[256 + 16] = 1;
  LEGAL_SPAN[256 - 17] = 2; LEGAL_SPAN[256 - 15] = 2; LEGAL_SPAN[256 + 15] = 2; LEGAL_SPAN[256 + 17] = 2;
  LEGAL_SPAN[256 - 34] = 3; LEGAL_SPAN[256 - 30] = 3; LEGAL_SPAN[256 + 30] = 3; LEGAL_SPAN[256 + 34] = 3;
  KNIGHT_PIN_[256 - 33] = -16; KNIGHT_PIN_[256 - 31] = -16; KNIGHT_PIN_[256 - 18] = -1; KNIGHT_PIN_[256 + 14] = -1;
  KNIGHT_PIN_[256 - 14] = 1;   KNIGHT_PIN_[256 + 18] = 1;   KNIGHT_PIN_[256 + 31] = 16; KNIGHT_PIN_[256 + 33] = 16;
})();

function IN_BOARD(sq){ return sq >= 0 && sq < 256 && IN_BOARD_[sq] !== 0; }
function IN_FORT(sq) { return sq >= 0 && sq < 256 && IN_FORT_[sq]  !== 0; }
function KING_SPAN(s1,s2)  { return LEGAL_SPAN[s2 - s1 + 256] === 1; }
function ADVISOR_SPAN(s1,s2){ return LEGAL_SPAN[s2 - s1 + 256] === 2; }
function BISHOP_SPAN(s1,s2) { return LEGAL_SPAN[s2 - s1 + 256] === 3; }
function BISHOP_PIN(s1,s2)  { return (s1 + s2) >> 1; }
function KNIGHT_PIN(s1,s2)  { return s1 + KNIGHT_PIN_[s2 - s1 + 256]; }

function CHR(n){ return String.fromCharCode(n); }
function ASC(c){ return c.charCodeAt(0); }

var FEN_PIECE = "        KABNRCP kabnrcp ";
function CHAR_TO_PIECE(c) {
  switch (c) {
    case "K": case "k": return PIECE_KING;
    case "A": case "a": return PIECE_ADVISOR;
    case "B": case "b": case "E": case "e": return PIECE_BISHOP;
    case "N": case "n": case "H": case "h": return PIECE_KNIGHT;
    case "R": case "r": return PIECE_ROOK;
    case "C": case "c": return PIECE_CANNON;
    case "P": case "p": return PIECE_PAWN;
    default: return -1;
  }
}
function PIECE_CHAR(pc) { return FEN_PIECE.charAt(pc); }

function RC4(key) {
  this.x = this.y = 0;
  this.state = new Array(256);
  for (var i = 0; i < 256; i++) this.state[i] = i;
  var j = 0;
  for (var i = 0; i < 256; i++) {
    j = (j + this.state[i] + key[i % key.length]) & 0xff;
    var t = this.state[i]; this.state[i] = this.state[j]; this.state[j] = t;
  }
}
RC4.prototype.swap = function(i, j) {
  var t = this.state[i]; this.state[i] = this.state[j]; this.state[j] = t;
};
RC4.prototype.nextByte = function() {
  this.x = (this.x + 1) & 0xff;
  this.y = (this.y + this.state[this.x]) & 0xff;
  this.swap(this.x, this.y);
  var t = (this.state[this.x] + this.state[this.y]) & 0xff;
  return this.state[t];
};
RC4.prototype.nextLong = function() {
  var n0 = this.nextByte();
  var n1 = this.nextByte();
  var n2 = this.nextByte();
  var n3 = this.nextByte();
  return n0 + (n1 << 8) + (n2 << 16) + ((n3 << 24) >>> 0);
};

var ZOBRIST_KEY_PLAYER, ZOBRIST_LOCK_PLAYER;
var ZOBRIST_KEY_TABLE  = new Array(14);
var ZOBRIST_LOCK_TABLE = new Array(14);
(function initZobrist() {
  var rc4 = new RC4([0]);
  ZOBRIST_KEY_PLAYER = rc4.nextLong();
  rc4.nextLong();
  ZOBRIST_LOCK_PLAYER = rc4.nextLong();
  for (var i = 0; i < 14; i++) {
    ZOBRIST_KEY_TABLE[i]  = new Array(256);
    ZOBRIST_LOCK_TABLE[i] = new Array(256);
    for (var j = 0; j < 256; j++) {
      ZOBRIST_KEY_TABLE[i][j]  = rc4.nextLong();
      rc4.nextLong();
      ZOBRIST_LOCK_TABLE[i][j] = rc4.nextLong();
    }
  }
})();

var PIECE_MATERIAL = [
  0,
  200,
  200,
  400,
  900,
  450,
  100
];

var PST = [];

(function buildPST() {
  var king = new Array(256);
  for (var i = 0; i < 256; i++) king[i] = 0;
  king[COORD_XY(3,0)] = -3; king[COORD_XY(4,0)] = -3; king[COORD_XY(5,0)] = -3;
  king[COORD_XY(7,0)] = -3; king[COORD_XY(8,0)] = -3; king[COORD_XY(9,0)] = -3;
  king[COORD_XY(11,0)] = -3; king[COORD_XY(4,1)] = 4; king[COORD_XY(8,1)] = 4; king[COORD_XY(6,1)] = 6;
  king[COORD_XY(3,2)] = -2; king[COORD_XY(5,2)] = 8; king[COORD_XY(7,2)] = 12; king[COORD_XY(9,2)] = 8; king[COORD_XY(11,2)] = -2;
  PST[PIECE_KING] = king;

  var advisor = new Array(256);
  for (var i = 0; i < 256; i++) advisor[i] = 0;
  advisor[COORD_XY(3,0)] = -2; advisor[COORD_XY(5,0)] = 3; advisor[COORD_XY(7,0)] = 3; advisor[COORD_XY(9,0)] = 3; advisor[COORD_XY(11,0)] = -2;
  advisor[COORD_XY(4,1)] = 0; advisor[COORD_XY(6,1)] = 4; advisor[COORD_XY(8,1)] = 0;
  advisor[COORD_XY(3,2)] = 0; advisor[COORD_XY(5,2)] = 0; advisor[COORD_XY(7,2)] = 0; advisor[COORD_XY(9,2)] = 0; advisor[COORD_XY(11,2)] = 0;
  PST[PIECE_ADVISOR] = advisor;

  var bishop = new Array(256);
  for (var i = 0; i < 256; i++) bishop[i] = 0;
  bishop[COORD_XY(2,0)] = 0; bishop[COORD_XY(4,0)] = 0; bishop[COORD_XY(6,0)] = 0; bishop[COORD_XY(8,0)] = 0; bishop[COORD_XY(10,0)] = 0; bishop[COORD_XY(12,0)] = 0;
  bishop[COORD_XY(3,1)] = 0; bishop[COORD_XY(5,1)] = 0; bishop[COORD_XY(7,1)] = 0; bishop[COORD_XY(9,1)] = 0; bishop[COORD_XY(11,1)] = 0;
  bishop[COORD_XY(2,2)] = 4; bishop[COORD_XY(4,2)] = 0; bishop[COORD_XY(6,2)] = 0; bishop[COORD_XY(8,2)] = 0; bishop[COORD_XY(10,2)] = 0; bishop[COORD_XY(12,2)] = 4;
  PST[PIECE_BISHOP] = bishop;

  var knight = new Array(256);
  for (var i = 0; i < 256; i++) knight[i] = 0;
  knight[COORD_XY(3,0)] = -10; knight[COORD_XY(4,0)] = -8; knight[COORD_XY(5,0)] = -6; knight[COORD_XY(6,0)] = -4;
  knight[COORD_XY(7,0)] = -4; knight[COORD_XY(8,0)] = -6; knight[COORD_XY(9,0)] = -8; knight[COORD_XY(10,0)] = -10;
  knight[COORD_XY(2,1)] = -8; knight[COORD_XY(3,1)] = -4; knight[COORD_XY(4,1)] = 2; knight[COORD_XY(5,1)] = 4; knight[COORD_XY(6,1)] = 6;
  knight[COORD_XY(7,1)] = 6; knight[COORD_XY(8,1)] = 4; knight[COORD_XY(9,1)] = 2; knight[COORD_XY(10,1)] = -4; knight[COORD_XY(12,1)] = -8;
  knight[COORD_XY(2,2)] = -6; knight[COORD_XY(3,2)] = 4; knight[COORD_XY(4,2)] = 8; knight[COORD_XY(5,2)] = 10; knight[COORD_XY(6,2)] = 12;
  knight[COORD_XY(7,2)] = 12; knight[COORD_XY(8,2)] = 10; knight[COORD_XY(9,2)] = 8; knight[COORD_XY(10,2)] = 4; knight[COORD_XY(12,2)] = -6;
  knight[COORD_XY(2,3)] = -4; knight[COORD_XY(3,3)] = 8; knight[COORD_XY(4,3)] = 14; knight[COORD_XY(5,3)] = 16; knight[COORD_XY(6,3)] = 16;
  knight[COORD_XY(7,3)] = 16; knight[COORD_XY(8,3)] = 16; knight[COORD_XY(9,3)] = 14; knight[COORD_XY(10,3)] = 8; knight[COORD_XY(12,3)] = -4;
  knight[COORD_XY(2,4)] = -6; knight[COORD_XY(3,4)] = 10; knight[COORD_XY(4,4)] = 16; knight[COORD_XY(5,4)] = 18; knight[COORD_XY(6,4)] = 20;
  knight[COORD_XY(7,4)] = 20; knight[COORD_XY(8,4)] = 18; knight[COORD_XY(9,4)] = 16; knight[COORD_XY(10,4)] = 10; knight[COORD_XY(12,4)] = -6;
  knight[COORD_XY(2,5)] = -8; knight[COORD_XY(3,5)] = 6; knight[COORD_XY(4,5)] = 12; knight[COORD_XY(5,5)] = 14; knight[COORD_XY(6,5)] = 16;
  knight[COORD_XY(7,5)] = 16; knight[COORD_XY(8,5)] = 14; knight[COORD_XY(9,5)] = 12; knight[COORD_XY(10,5)] = 6; knight[COORD_XY(12,5)] = -8;
  PST[PIECE_KNIGHT] = knight;

  var rook = new Array(256);
  for (var i = 0; i < 256; i++) rook[i] = 0;
  for (var x = 3; x <= 11; x++) {
    rook[COORD_XY(x,0)] = 0; rook[COORD_XY(x,1)] = 0;
    rook[COORD_XY(x,2)] = 2;
    rook[COORD_XY(x,3)] = 4;
    rook[COORD_XY(x,4)] = 6;
    rook[COORD_XY(x,5)] = 6;
    rook[COORD_XY(x,6)] = 4;
    rook[COORD_XY(x,7)] = 4;
    rook[COORD_XY(x,8)] = 6;
    rook[COORD_XY(x,9)] = 4;
  }
  rook[COORD_XY(3,3)] = -2; rook[COORD_XY(3,4)] = 0; rook[COORD_XY(3,5)] = 0; rook[COORD_XY(3,6)] = -2; rook[COORD_XY(3,7)] = 0; rook[COORD_XY(3,8)] = 2; rook[COORD_XY(3,9)] = 4;
  rook[COORD_XY(4,3)] = 4; rook[COORD_XY(4,4)] = 6; rook[COORD_XY(4,5)] = 6; rook[COORD_XY(4,6)] = 4; rook[COORD_XY(4,7)] = 4; rook[COORD_XY(4,8)] = 6; rook[COORD_XY(4,9)] = 4;
  rook[COORD_XY(5,3)] = 6; rook[COORD_XY(5,4)] = 8; rook[COORD_XY(5,5)] = 8; rook[COORD_XY(5,6)] = 6; rook[COORD_XY(5,7)] = 6; rook[COORD_XY(5,8)] = 8; rook[COORD_XY(5,9)] = 6;
  rook[COORD_XY(6,3)] = 8; rook[COORD_XY(6,4)] = 10; rook[COORD_XY(6,5)] = 10; rook[COORD_XY(6,6)] = 8; rook[COORD_XY(6,7)] = 8; rook[COORD_XY(6,8)] = 10; rook[COORD_XY(6,9)] = 8;
  rook[COORD_XY(7,3)] = 8; rook[COORD_XY(7,4)] = 10; rook[COORD_XY(7,5)] = 10; rook[COORD_XY(7,6)] = 8; rook[COORD_XY(7,7)] = 8; rook[COORD_XY(7,8)] = 10; rook[COORD_XY(7,9)] = 8;
  rook[COORD_XY(8,3)] = 6; rook[COORD_XY(8,4)] = 8; rook[COORD_XY(8,5)] = 8; rook[COORD_XY(8,6)] = 6; rook[COORD_XY(8,7)] = 6; rook[COORD_XY(8,8)] = 8; rook[COORD_XY(8,9)] = 6;
  rook[COORD_XY(9,3)] = 4; rook[COORD_XY(9,4)] = 6; rook[COORD_XY(9,5)] = 6; rook[COORD_XY(9,6)] = 4; rook[COORD_XY(9,7)] = 4; rook[COORD_XY(9,8)] = 6; rook[COORD_XY(9,9)] = 4;
  rook[COORD_XY(10,3)] = -2; rook[COORD_XY(10,4)] = 0; rook[COORD_XY(10,5)] = 0; rook[COORD_XY(10,6)] = -2; rook[COORD_XY(10,7)] = 0; rook[COORD_XY(10,8)] = 2; rook[COORD_XY(10,9)] = 4;
  rook[COORD_XY(11,3)] = 4; rook[COORD_XY(11,4)] = 4; rook[COORD_XY(11,5)] = 4; rook[COORD_XY(11,6)] = 0; rook[COORD_XY(11,7)] = 0; rook[COORD_XY(11,8)] = 0; rook[COORD_XY(11,9)] = -2;
  PST[PIECE_ROOK] = rook;

  var cannon = new Array(256);
  for (var i = 0; i < 256; i++) cannon[i] = 0;
  for (var x = 3; x <= 11; x++) {
    cannon[COORD_XY(x,0)] = 0; cannon[COORD_XY(x,1)] = 2; cannon[COORD_XY(x,2)] = 4;
    cannon[COORD_XY(x,3)] = 6; cannon[COORD_XY(x,4)] = 6; cannon[COORD_XY(x,5)] = 6;
    cannon[COORD_XY(x,6)] = 6; cannon[COORD_XY(x,7)] = 6; cannon[COORD_XY(x,8)] = 4; cannon[COORD_XY(x,9)] = 2;
  }
  for (var x = 3; x <= 11; x++) { cannon[COORD_XY(x,2)] += 4; cannon[COORD_XY(x,7)] += 4; }
  for (var x = 5; x <= 9; x++) { cannon[COORD_XY(x,3)] += 2; cannon[COORD_XY(x,4)] += 2; cannon[COORD_XY(x,5)] += 2; cannon[COORD_XY(x,6)] += 2; }
  PST[PIECE_CANNON] = cannon;

  var pawn = new Array(256);
  for (var i = 0; i < 256; i++) pawn[i] = 0;
  for (var x = 3; x <= 11; x++) {
    pawn[COORD_XY(x,3)] = 2; pawn[COORD_XY(x,4)] = 4; pawn[COORD_XY(x,5)] = 6;
  }
  for (var x = 3; x <= 11; x++) {
    pawn[COORD_XY(x,6)] = 12; pawn[COORD_XY(x,7)] = 18; pawn[COORD_XY(x,8)] = 22; pawn[COORD_XY(x,9)] = 26;
  }
  pawn[COORD_XY(6,6)] = 14; pawn[COORD_XY(7,6)] = 14; pawn[COORD_XY(8,6)] = 14;
  pawn[COORD_XY(6,7)] = 20; pawn[COORD_XY(7,7)] = 22; pawn[COORD_XY(8,7)] = 20;
  pawn[COORD_XY(6,8)] = 26; pawn[COORD_XY(7,8)] = 28; pawn[COORD_XY(8,8)] = 26;
  pawn[COORD_XY(6,9)] = 30; pawn[COORD_XY(7,9)] = 32; pawn[COORD_XY(8,9)] = 30;
  PST[PIECE_PAWN] = pawn;
})();

function Position() {
  this.sdPlayer = 0;
  this.squares  = new Array(256);
  this.zobristKey = 0;
  this.zobristLock = 0;
  this.vlWhite  = 0;
  this.vlBlack  = 0;
  this.mvList   = [0];
  this.pcList   = [0];
  this.keyList  = [0];
  this.chkList  = [false];
  this.distance = 0;
}

Position.prototype.clearBoard = function() {
  this.sdPlayer = 0;
  for (var i = 0; i < 256; i++) this.squares[i] = 0;
  this.zobristKey = this.zobristLock = 0;
  this.vlWhite = this.vlBlack = 0;
};

Position.prototype.setIrrev = function() {
  this.mvList  = [0];
  this.pcList  = [0];
  this.keyList = [0];
  this.chkList = [this.checked()];
  this.distance = 0;
};

Position.prototype.addPiece = function(sq, pc, bDel) {
  var pcAdjust;
  this.squares[sq] = bDel ? 0 : pc;
  if (pc < 16) {
    pcAdjust = pc - 8;
    this.vlWhite += bDel ? -PST[pcAdjust][sq] : PST[pcAdjust][sq];
  } else {
    pcAdjust = pc - 16;
    this.vlBlack += bDel ? -PST[pcAdjust][SQUARE_FLIP(sq)] : PST[pcAdjust][SQUARE_FLIP(sq)];
    pcAdjust += 7;
  }
  this.zobristKey  ^= ZOBRIST_KEY_TABLE[pcAdjust][sq];
  this.zobristLock ^= ZOBRIST_LOCK_TABLE[pcAdjust][sq];
};

Position.prototype.movePiece = function(mv) {
  var sqSrc = SRC(mv);
  var sqDst = DST(mv);
  var pc = this.squares[sqDst];
  this.pcList.push(pc);
  if (pc > 0) {
    this.addPiece(sqDst, pc, true);
  }
  pc = this.squares[sqSrc];
  this.addPiece(sqSrc, pc, true);
  this.addPiece(sqDst, pc, false);
  this.mvList.push(mv);
};

Position.prototype.undoMovePiece = function() {
  var mv = this.mvList.pop();
  var sqSrc = SRC(mv);
  var sqDst = DST(mv);
  var pc = this.squares[sqDst];
  this.addPiece(sqDst, pc, true);
  this.addPiece(sqSrc, pc, false);
  var cap = this.pcList.pop();
  if (cap > 0) {
    this.addPiece(sqDst, cap, false);
  }
};

Position.prototype.changeSide = function() {
  this.sdPlayer = 1 - this.sdPlayer;
  this.zobristKey  ^= ZOBRIST_KEY_PLAYER;
  this.zobristLock ^= ZOBRIST_LOCK_PLAYER;
};

Position.prototype.makeMove = function(mv) {
  var zobristKey = this.zobristKey;
  this.movePiece(mv);
  if (this.checked()) {
    this.undoMovePiece();
    return false;
  }
  this.keyList.push(zobristKey);
  this.changeSide();
  this.chkList.push(this.checked());
  this.distance++;
  return true;
};

Position.prototype.undoMakeMove = function() {
  this.distance--;
  this.chkList.pop();
  this.changeSide();
  this.keyList.pop();
  this.undoMovePiece();
};

Position.prototype.nullMove = function() {
  this.mvList.push(0);
  this.pcList.push(0);
  this.keyList.push(this.zobristKey);
  this.changeSide();
  this.chkList.push(false);
  this.distance++;
};

Position.prototype.undoNullMove = function() {
  this.distance--;
  this.chkList.pop();
  this.changeSide();
  this.keyList.pop();
  this.pcList.pop();
  this.mvList.pop();
};

Position.prototype.fromFen = function(fen) {
  this.clearBoard();
  var x = 3, y = 0, index = 0;
  if (index === fen.length) { this.setIrrev(); return; }
  var c = fen.charAt(index);
  while (c !== " " && index < fen.length) {
    if (c === "/") {
      x = 3; y++;
    } else if (c >= "1" && c <= "9") {
      x += (ASC(c) - ASC("0"));
    } else {
      var pt = CHAR_TO_PIECE(c);
      if (pt >= 0) {
        if (c === c.toUpperCase()) {
          this.addPiece(COORD_XY(x, y), pt + 8, false);
        } else {
          this.addPiece(COORD_XY(x, y), pt + 16, false);
        }
        x++;
      }
    }
    index++;
    if (index === fen.length) { this.setIrrev(); return; }
    c = fen.charAt(index);
  }
  index++;
  if (index >= fen.length) { this.setIrrev(); return; }
  if (this.sdPlayer === (fen.charAt(index) === "b" ? 0 : 1)) {
    this.changeSide();
  }
  this.setIrrev();
};

Position.prototype.toFen = function() {
  var fen = "";
  for (var y = 0; y <= 9; y++) {
    var k = 0;
    for (var x = 3; x <= 11; x++) {
      var pc = this.squares[COORD_XY(x, y)];
      if (pc > 0) {
        if (k > 0) { fen += CHR(ASC("0") + k); k = 0; }
        fen += PIECE_CHAR(pc);
      } else {
        k++;
      }
    }
    if (k > 0) fen += CHR(ASC("0") + k);
    fen += (y === 9 ? " " : "/");
  }
  return fen + (this.sdPlayer === 0 ? "w" : "b");
};

Position.prototype.historyIndex = function(mv) {
  return ((this.squares[SRC(mv)] - 8) << 8) + DST(mv);
};

Position.prototype.legalMove = function(mv) {
  var sqSrc = SRC(mv);
  var pcSrc = this.squares[sqSrc];
  var pcSelfSide = SIDE_TAG(this.sdPlayer);
  if ((pcSrc & pcSelfSide) === 0) return false;
  var sqDst = DST(mv);
  var pcDst = this.squares[sqDst];
  if ((pcDst & pcSelfSide) !== 0) return false;
  switch (pcSrc - pcSelfSide) {
    case PIECE_KING:    return IN_FORT(sqDst) && KING_SPAN(sqSrc, sqDst);
    case PIECE_ADVISOR: return IN_FORT(sqDst) && ADVISOR_SPAN(sqSrc, sqDst);
    case PIECE_BISHOP:  return SAME_HALF(sqSrc, sqDst) && BISHOP_SPAN(sqSrc, sqDst) && this.squares[BISHOP_PIN(sqSrc, sqDst)] === 0;
    case PIECE_KNIGHT: {
      var sqPin = KNIGHT_PIN(sqSrc, sqDst);
      return sqPin !== sqSrc && this.squares[sqPin] === 0;
    }
    case PIECE_ROOK:
    case PIECE_CANNON: {
      var delta;
      if (SAME_RANK(sqSrc, sqDst)) delta = (sqDst < sqSrc ? -1 : 1);
      else if (SAME_FILE(sqSrc, sqDst)) delta = (sqDst < sqSrc ? -16 : 16);
      else return false;
      var sqPin = sqSrc + delta;
      while (sqPin !== sqDst && this.squares[sqPin] === 0) sqPin += delta;
      if (sqPin === sqDst) return pcDst === 0 || (pcSrc - pcSelfSide === PIECE_ROOK);
      if (pcDst === 0 || (pcSrc - pcSelfSide !== PIECE_CANNON)) return false;
      sqPin += delta;
      while (sqPin !== sqDst && this.squares[sqPin] === 0) sqPin += delta;
      return sqPin === sqDst;
    }
    case PIECE_PAWN:
      if (AWAY_HALF(sqDst, this.sdPlayer) && (sqDst === sqSrc - 1 || sqDst === sqSrc + 1)) return true;
      return sqDst === SQUARE_FORWARD(sqSrc, this.sdPlayer);
  }
  return false;
};

Position.prototype.generateMoves = function(vls) {
  var mvs = [];
  var pcSelfSide = SIDE_TAG(this.sdPlayer);
  var pcOppSide  = OPP_SIDE_TAG(this.sdPlayer);
  for (var sqSrc = 0; sqSrc < 256; sqSrc++) {
    var pcSrc = this.squares[sqSrc];
    if ((pcSrc & pcSelfSide) === 0) continue;
    switch (pcSrc - pcSelfSide) {
      case PIECE_KING:
        for (var i = 0; i < 4; i++) {
          var sqDst = sqSrc + KING_DELTA[i];
          if (!IN_FORT(sqDst)) continue;
          var pcDst = this.squares[sqDst];
          if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
          else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 5)); }
        }
        break;
      case PIECE_ADVISOR:
        for (var i = 0; i < 4; i++) {
          var sqDst = sqSrc + ADVISOR_DELTA[i];
          if (!IN_FORT(sqDst)) continue;
          var pcDst = this.squares[sqDst];
          if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
          else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 1)); }
        }
        break;
      case PIECE_BISHOP:
        for (var i = 0; i < 4; i++) {
          var sqDst = sqSrc + ADVISOR_DELTA[i];
          if (!(IN_BOARD(sqDst) && HOME_HALF(sqDst, this.sdPlayer) && this.squares[sqDst] === 0)) continue;
          sqDst += ADVISOR_DELTA[i];
          var pcDst = this.squares[sqDst];
          if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
          else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 1)); }
        }
        break;
      case PIECE_KNIGHT:
        for (var i = 0; i < 4; i++) {
          var sqDst = sqSrc + KING_DELTA[i];
          if (this.squares[sqDst] > 0) continue;
          for (var j = 0; j < 2; j++) {
            sqDst = sqSrc + KNIGHT_DELTA[i][j];
            if (!IN_BOARD(sqDst)) continue;
            var pcDst = this.squares[sqDst];
            if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
            else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 3)); }
          }
        }
        break;
      case PIECE_ROOK:
        for (var i = 0; i < 4; i++) {
          var delta = KING_DELTA[i];
          var sqDst = sqSrc + delta;
          while (IN_BOARD(sqDst)) {
            var pcDst = this.squares[sqDst];
            if (pcDst === 0) {
              if (vls == null) mvs.push(MOVE(sqSrc, sqDst));
            } else {
              if ((pcDst & pcOppSide) !== 0) {
                mvs.push(MOVE(sqSrc, sqDst));
                if (vls != null) vls.push(MVV_LVA(pcDst, 4));
              }
              break;
            }
            sqDst += delta;
          }
        }
        break;
      case PIECE_CANNON:
        for (var i = 0; i < 4; i++) {
          var delta = KING_DELTA[i];
          var sqDst = sqSrc + delta;
          while (IN_BOARD(sqDst)) {
            var pcDst = this.squares[sqDst];
            if (pcDst === 0) {
              if (vls == null) mvs.push(MOVE(sqSrc, sqDst));
            } else break;
            sqDst += delta;
          }
          sqDst += delta;
          while (IN_BOARD(sqDst)) {
            var pcDst = this.squares[sqDst];
            if (pcDst > 0) {
              if ((pcDst & pcOppSide) !== 0) {
                mvs.push(MOVE(sqSrc, sqDst));
                if (vls != null) vls.push(MVV_LVA(pcDst, 4));
              }
              break;
            }
            sqDst += delta;
          }
        }
        break;
      case PIECE_PAWN: {
        var sqDst = SQUARE_FORWARD(sqSrc, this.sdPlayer);
        if (IN_BOARD(sqDst)) {
          var pcDst = this.squares[sqDst];
          if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
          else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 2)); }
        }
        if (AWAY_HALF(sqSrc, this.sdPlayer)) {
          for (var delta = -1; delta <= 1; delta += 2) {
            sqDst = sqSrc + delta;
            if (IN_BOARD(sqDst)) {
              var pcDst = this.squares[sqDst];
              if (vls == null) { if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst)); }
              else if ((pcDst & pcOppSide) !== 0) { mvs.push(MOVE(sqSrc, sqDst)); vls.push(MVV_LVA(pcDst, 2)); }
            }
          }
        }
        break;
      }
    }
  }
  return mvs;
};

Position.prototype.checked = function() {
  var pcSelfSide = SIDE_TAG(this.sdPlayer);
  var pcOppSide  = OPP_SIDE_TAG(this.sdPlayer);
  var sqKing = -1;
  for (var sq = 0; sq < 256; sq++) {
    if (this.squares[sq] === pcSelfSide + PIECE_KING) { sqKing = sq; break; }
  }
  if (sqKing < 0) return true;
  if (this.squares[SQUARE_FORWARD(sqKing, this.sdPlayer)] === pcOppSide + PIECE_PAWN) return true;
  for (var d = -1; d <= 1; d += 2) {
    if (this.squares[sqKing + d] === pcOppSide + PIECE_PAWN) return true;
  }
  for (var i = 0; i < 4; i++) {
    if (this.squares[sqKing + ADVISOR_DELTA[i]] !== 0) continue;
    for (var j = 0; j < 2; j++) {
      if (this.squares[sqKing + KNIGHT_CHECK_DELTA[i][j]] === pcOppSide + PIECE_KNIGHT) return true;
    }
  }
  for (var i = 0; i < 4; i++) {
    var delta = KING_DELTA[i];
    var sqDst = sqKing + delta;
    while (IN_BOARD(sqDst)) {
      var pcDst = this.squares[sqDst];
      if (pcDst > 0) {
        if (pcDst === pcOppSide + PIECE_ROOK || pcDst === pcOppSide + PIECE_KING) return true;
        break;
      }
      sqDst += delta;
    }
    sqDst += delta;
    while (IN_BOARD(sqDst)) {
      var pcDst2 = this.squares[sqDst];
      if (pcDst2 > 0) {
        if (pcDst2 === pcOppSide + PIECE_CANNON) return true;
        break;
      }
      sqDst += delta;
    }
  }
  return false;
};

Position.prototype.isMate = function() {
  var mvs = this.generateMoves(null);
  for (var i = 0; i < mvs.length; i++) {
    if (this.makeMove(mvs[i])) { this.undoMakeMove(); return false; }
  }
  return true;
};

Position.prototype.mateValue  = function() { return this.distance - MATE_VALUE;  };
Position.prototype.banValue   = function() { return this.distance - BAN_VALUE;   };
Position.prototype.drawValue  = function() { return (this.distance & 1) === 0 ? -DRAW_VALUE : DRAW_VALUE; };
Position.prototype.nullOkay   = function() { return (this.sdPlayer === 0 ? this.vlWhite : this.vlBlack) > NULL_OKAY_MARGIN; };
Position.prototype.nullSafe   = function() { return (this.sdPlayer === 0 ? this.vlWhite : this.vlBlack) > NULL_SAFE_MARGIN; };
Position.prototype.inCheck    = function() { return this.chkList[this.chkList.length - 1]; };
Position.prototype.captured   = function() { return this.pcList[this.pcList.length - 1] > 0; };
Position.prototype.repValue   = function(vlRep) {
  var v = ((vlRep & 2) === 0 ? 0 : this.banValue()) + ((vlRep & 4) === 0 ? 0 : -this.banValue());
  return v === 0 ? this.drawValue() : v;
};
Position.prototype.repStatus  = function(recur_) {
  var recur = recur_;
  var selfSide = false;
  var perpCheck = true, oppPerpCheck = true;
  var index = this.mvList.length - 1;
  while (this.mvList[index] > 0 && this.pcList[index] === 0) {
    if (selfSide) {
      perpCheck = perpCheck && this.chkList[index];
      if (this.keyList[index] === this.zobristKey) {
        recur--;
        if (recur === 0) return 1 + (perpCheck ? 2 : 0) + (oppPerpCheck ? 4 : 0);
      }
    } else {
      oppPerpCheck = oppPerpCheck && this.chkList[index];
    }
    selfSide = !selfSide;
    index--;
  }
  return 0;
};

Position.prototype.mirror = function() {
  var pos = new Position();
  pos.clearBoard();
  for (var sq = 0; sq < 256; sq++) {
    var pc = this.squares[sq];
    if (pc > 0) pos.addPiece(MIRROR_SQUARE(sq), pc, false);
  }
  if (this.sdPlayer === 1) pos.changeSide();
  return pos;
};

function pieceMobility(pos, sq, pc, sd) {
  switch (pc) {
    case PIECE_KNIGHT: {
      var c = 0;
      for (var i = 0; i < 4; i++) {
        var sqPin = sq + KING_DELTA[i];
        if (pos.squares[sqPin] > 0) continue;
        for (var j = 0; j < 2; j++) {
          var sqDst = sq + KNIGHT_DELTA[i][j];
          if (IN_BOARD(sqDst) && (pos.squares[sqDst] & SIDE_TAG(sd)) === 0) c++;
        }
      }
      return c;
    }
    case PIECE_ROOK:
    case PIECE_CANNON: {
      var c = 0;
      for (var i = 0; i < 4; i++) {
        var delta = KING_DELTA[i];
        var sqDst = sq + delta;
        while (IN_BOARD(sqDst)) {
          var pcDst = pos.squares[sqDst];
          if (pcDst === 0) {
            c++;
          } else {
            if ((pcDst & SIDE_TAG(sd)) === 0) c++;
            if (pc === PIECE_CANNON) {
              sqDst += delta;
              while (IN_BOARD(sqDst)) {
                var pcDst2 = pos.squares[sqDst];
                if (pcDst2 > 0) {
                  if ((pcDst2 & SIDE_TAG(sd)) === 0) c++;
                  break;
                }
                sqDst += delta;
              }
            }
            break;
          }
          sqDst += delta;
        }
      }
      return c;
    }
    case PIECE_PAWN: {
      var c = 0;
      var sqF = SQUARE_FORWARD(sq, sd);
      if (IN_BOARD(sqF) && (pos.squares[sqF] & SIDE_TAG(sd)) === 0) c++;
      if (AWAY_HALF(sq, sd)) {
        for (var d = -1; d <= 1; d += 2) {
          var sqD = sq + d;
          if (IN_BOARD(sqD) && (pos.squares[sqD] & SIDE_TAG(sd)) === 0) c++;
        }
      }
      return c * 2;
    }
  }
  return 0;
}

function pawnStructure(pos, sd) {
  var score = 0;
  var oppSd = 1 - sd;
  for (var x = 3; x <= 11; x++) {
    var myPawnY = -1;
    var oppPawnY = -1;
    for (var y = 0; y <= 9; y++) {
      var pc = pos.squares[COORD_XY(x, y)];
      if (pc === (sd === 0 ? 8 : 16) + PIECE_PAWN) {
        if (sd === 0) {
          if (myPawnY < y) myPawnY = y;
        } else {
          if (myPawnY > y || myPawnY < 0) myPawnY = y;
        }
      } else if (pc === (oppSd === 0 ? 8 : 16) + PIECE_PAWN) {
        if (oppSd === 0) {
          if (oppPawnY < y) oppPawnY = y;
        } else {
          if (oppPawnY > y || oppPawnY < 0) oppPawnY = y;
        }
      }
    }
    if (myPawnY >= 0) {
      for (var dx = -1; dx <= 1; dx += 2) {
        var nx = x + dx;
        if (nx < 3 || nx > 11) continue;
        for (var y = 0; y <= 9; y++) {
          var pc2 = pos.squares[COORD_XY(nx, y)];
          if (pc2 === (sd === 0 ? 8 : 16) + PIECE_PAWN) {
            if (sd === 0) {
              if (y >= myPawnY - 1 && y <= myPawnY + 1) score += 4;
            } else {
              if (y <= myPawnY + 1 && y >= myPawnY - 1) score += 4;
            }
            break;
          }
        }
      }
      if (oppPawnY < 0) score += 12;
      else {
        if (sd === 0 && myPawnY > oppPawnY) score += 12;
        if (sd === 1 && myPawnY < oppPawnY) score += 12;
      }
    }
  }
  return score;
}

Position.prototype.evaluate = function() {
  var whiteExtra = 0, blackExtra = 0;
  for (var sq = 0; sq < 256; sq++) {
    var pc = this.squares[sq];
    if (pc === 0) continue;
    var sd = pc < 16 ? 0 : 1;
    var pt = pc & 7;
    if (sd === 0) whiteExtra += pieceMobility(this, sq, pt, 0);
    else          blackExtra += pieceMobility(this, sq, pt, 1);
  }
  whiteExtra += pawnStructure(this, 0);
  blackExtra += pawnStructure(this, 1);

  var vl = (this.sdPlayer === 0
    ? (this.vlWhite + whiteExtra) - (this.vlBlack + blackExtra)
    : (this.vlBlack + blackExtra) - (this.vlWhite + whiteExtra)) + ADVANCED_VALUE;
  if (vl === this.drawValue()) vl--;
  return vl;
};
