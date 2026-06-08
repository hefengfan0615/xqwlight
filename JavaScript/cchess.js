/*
 * cchess.js - Common constants and move notation helpers for Pikafish-JS
 * Ported from Pikafish (https://github.com/official-pikafish/Pikafish)
 *
 * Provides piece types, color constants, scoring values and ICCS/UCCI
 * move notation conversion utilities.
 */
"use strict";

var NO_PIECE = 7;
var PIECE_TYPE_NB = 7;
var COLOR_NB = 2;
var PIECE_NB = 16;

// Piece types (low 3 bits)
var KING    = 0;
var ADVISOR = 1;
var BISHOP  = 2;
var KNIGHT  = 3;
var ROOK    = 4;
var CANNON  = 5;
var PAWN    = 6;

// Colors
var RED   = 0;
var BLACK = 1;

var SIDE_TAG_RED   = 8;
var SIDE_TAG_BLACK = 16;
function SIDE_TAG(c)     { return c === RED ? 8 : 16; }
function OPP_SIDE_TAG(c) { return c === RED ? 16 : 8; }
function piece_of(c, t)   { return SIDE_TAG(c) + t; }
function type_of(p)      { return p & 7; }
function color_of(p)     { return (p & 8) ? 0 : 1; }

// Scoring constants (256-based like Stockfish/Pikafish)
var SCORE_ZERO  = 0;
var SCORE_DRAW  = 0;
var SCORE_MATE  = 32000;
var SCORE_MATE_IN_MAX_PLY  = SCORE_MATE - 256;
var SCORE_MATED_IN_MAX_PLY = -SCORE_MATE + 256;
var SCORE_WIN   = 30000;
var SCORE_LOSS  = -30000;
var SCORE_NONE  = 32001;
var SCORE_INF   = 32002;

var VALUE_ZERO  = 0;
var VALUE_DRAW  = 0;
var VALUE_MATE  = 32000;
var VALUE_INF   = 32002;
var VALUE_NONE  = 32001;

// Piece values (tuned for xiangqi, internal units)
var PIECE_TYPE_VALUE = [6000, 20, 20, 90, 900, 900, 40];

// Move encoding: src in low 8 bits, dst in bits 8..15
function SRC(mv) { return mv & 0xFF; }
function DST(mv) { return (mv >> 8) & 0xFF; }
function MOVE(src, dst) { return (src & 0xFF) | ((dst & 0xFF) << 8); }
var MOVE_NONE = 0;
var NULL_MOVE = 0;

// Square <-> file/rank helpers (square index 0..89, file 0..8, rank 0..9)
function file_of(sq)   { return sq % 9; }
function rank_of(sq)   { return Math.floor(sq / 9); }
function sq_make(f, r) { return f + r * 9; }

// Direction deltas in square-index space for a 9x10 board
var DELTA_N = -9;
var DELTA_S = +9;
var DELTA_E = +1;
var DELTA_W = -1;
var KING_DELTA    = [-9, +9, -1, +1];
var ADVISOR_DELTA = [-10, -8, +8, +10];
// Knight: 8 destinations, each described by (delta, blockingSquareDelta)
var KNIGHT_MOVES = [
  [-17, -1], [-15, +1], [+17, +1], [+15, -1], // toward north (rank -1)
  [-10, -10 - 1 + 9],                         // (placeholder removed)
];
// Simplified: KNIGHT destination offsets when "leg" of the L is in each direction
//   north (+N): -17(2W 1N), -15(2E 1N)
//   south (-N): +15, +17
//   east (+E):  -10(1N 2E), + 6(1S 2E) ... no, knight is 2+1 L
// Knight moves to (file ±1, rank ±2) or (file ±2, rank ±1).
// In square-index space (rank*9+file), going (file +1, rank -2) is 1 + (-2)*9 = 1 - 18 = -17
//                            (file -1, rank -2) is -1 - 18 = -19  (not used commonly; this is the western leg)
//
// The 8 knight targets, grouped by their blocking-square direction (the orthogonal neighbour):
//   blocking = (file 0, rank -1) = -9:    targets (file ±1, rank -2) -> -19, -17
//   blocking = (file 0, rank +1) = +9:    targets (file ±1, rank +2) -> +17, +19
//   blocking = (file +1, rank 0) = +1:    targets (file +2, rank ±1) -> -7(+2,-1), +11(+2,+1)
//   blocking = (file -1, rank 0) = -1:    targets (file -2, rank ±1) -> -11(-2,-1), +7(-2,+1)
var KNIGHT_BLOCK_DELTAS = [-9, +9, +1, -1];
var KNIGHT_TARGETS = [
  // blocking = -9 (above)
  [-19, -17],
  // blocking = +9 (below)
  [+17, +19],
  // blocking = +1 (right)
  [-7, +11],
  // blocking = -1 (left)
  [-11, +7],
];

// Bishop moves 2 squares diagonally; the four targets and the blocking square (centre)
var BISHOP_TARGETS = [-20, -16, +16, +20];   // (file±2, rank±2) deltas
var BISHOP_BLOCKS  = [-10,  -8,  +8, +10];   // the square in between

// String conversion helpers
function CHR(n) { return String.fromCharCode(n); }
function ASC(c) { return c.charCodeAt(0); }

var FEN_PIECE_LO = "KABNRCP";
var FEN_PIECE_UP = "kabnrcp";

function moveToIccs(mv) {
  if (!mv) return "0000";
  var s = SRC(mv), d = DST(mv);
  var ff = file_of(s), fr = rank_of(s);
  var tf = file_of(d), tr = rank_of(d);
  return CHR(ASC("a") + ff) + CHR(ASC("0") + (9 - fr)) +
         "-" +
         CHR(ASC("a") + tf) + CHR(ASC("0") + (9 - tr));
}

function moveToUCCI(mv) {
  if (!mv) return "0000";
  var s = SRC(mv), d = DST(mv);
  var ff = file_of(s), fr = rank_of(s);
  var tf = file_of(d), tr = rank_of(d);
  return CHR(ASC("a") + ff) + CHR(ASC("0") + (9 - fr)) +
         CHR(ASC("a") + tf) + CHR(ASC("0") + (9 - tr));
}

function sqToStr(sq) {
  if (sq < 0 || sq > 89) return "??";
  return CHR(ASC("a") + file_of(sq)) + CHR(ASC("0") + (9 - rank_of(sq)));
}

function formatScore(v) {
  if (v === undefined || v === null) return "0.00";
  if (v > SCORE_MATE_IN_MAX_PLY)  return "M" + Math.ceil((SCORE_MATE - v) / 2);
  if (v < SCORE_MATED_IN_MAX_PLY) return "-M" + Math.ceil((SCORE_MATE + v) / 2);
  var pawn = v / 100;
  return (pawn >= 0 ? "+" : "") + pawn.toFixed(2);
}

// Board geometry
var FILE_NB   = 9;
var RANK_NB   = 10;
var SQUARE_NB = 90;

// Check if a square is on the board
function is_ok(sq) { return sq >= 0 && sq < 90; }

// Whether a square is in a side's "palace" (3x3 around the king)
var IN_RED_PALACE  = [false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false, true, true, true,false,false,
                      false,false,false,false, true, true, true,false,false,
                      false,false,false,false, true, true, true,false,false];
var IN_BLACK_PALACE= [false,false,false,false, true, true, true,false,false,
                      false,false,false,false, true, true, true,false,false,
                      false,false,false,false, true, true, true,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false,
                      false,false,false,false,false,false,false,false,false];
function in_palace(sq, c) {
  if (c === RED) return IN_RED_PALACE[sq];
  return IN_BLACK_PALACE[sq];
}

// Half of the board: red's side = ranks 0..4, black's side = ranks 5..9
function own_half(sq, c) {
  var r = rank_of(sq);
  return c === RED ? (r <= 4) : (r >= 5);
}
