"use strict";

// ==============================================
// Type definitions and constants for Pikafish
// ==============================================

// Maximum moves and ply depth
const MAX_MOVES = 128;
const MAX_PLY = 246;

// Move special values
const MOVE_NONE = 0;
const MOVE_NULL = 129;

// Color constants
const WHITE = 0;
const BLACK = 1;
const COLOR_NB = 2;

// Phase constants for evaluation
const PHASE_ENDGAME = 0;
const PHASE_MIDGAME = 128;
const MG = 0;
const EG = 1;
const PHASE_NB = 2;

// Scale factor constants
const SCALE_FACTOR_DRAW = 0;
const SCALE_FACTOR_NORMAL = 64;
const SCALE_FACTOR_MAX = 128;
const SCALE_FACTOR_NONE = 255;

// Bound types for transposition table
const BOUND_NONE = 0;
const BOUND_UPPER = 1;
const BOUND_LOWER = 2;
const BOUND_EXACT = BOUND_UPPER | BOUND_LOWER;

// Value constants for evaluation
const VALUE_ZERO = 0;
const VALUE_DRAW = 0;
const VALUE_KNOWN_WIN = 10000;
const VALUE_MATE = 32000;
const VALUE_INFINITE = 32001;
const VALUE_NONE = 32002;
const VALUE_MATE_IN_MAX_PLY = VALUE_MATE - MAX_PLY;
const VALUE_MATED_IN_MAX_PLY = -VALUE_MATE_IN_MAX_PLY;

// Piece values (midgame and endgame)
const PieceValue = [
  [VALUE_ZERO, 1373, 104, 768, 127, 561, 167, VALUE_ZERO, VALUE_ZERO, 1373, 104, 768, 127, 561, 167, VALUE_ZERO],
  [VALUE_ZERO, 2122, 121, 753, 182, 774, 72, VALUE_ZERO, VALUE_ZERO, 2122, 121, 753, 182, 774, 72, VALUE_ZERO]
];

// Piece type constants
const NO_PIECE_TYPE = 0;
const ROOK = 1;
const ADVISOR = 2;
const CANNON = 3;
const PAWN = 4;
const KNIGHT = 5;
const BISHOP = 6;
const KING = 7;
const KNIGHT_TO = 8;
const ALL_PIECES = 0;
const PIECE_TYPE_NB = 9;

// Piece constants (color << 3 | type)
const NO_PIECE = 0;
const W_ROOK = 1;
const W_ADVISOR = 2;
const W_CANNON = 3;
const W_PAWN = 4;
const W_KNIGHT = 5;
const W_BISHOP = 6;
const W_KING = 7;
const B_ROOK = 9;
const B_ADVISOR = 10;
const B_CANNON = 11;
const B_PAWN = 12;
const B_KNIGHT = 13;
const B_BISHOP = 14;
const B_KING = 15;
const PIECE_NB = 16;

// Square constants
const SQ_A0 = 0, SQ_B0 = 1, SQ_C0 = 2, SQ_D0 = 3, SQ_E0 = 4, SQ_F0 = 5, SQ_G0 = 6, SQ_H0 = 7, SQ_I0 = 8;
const SQ_A1 = 9, SQ_B1 = 10, SQ_C1 = 11, SQ_D1 = 12, SQ_E1 = 13, SQ_F1 = 14, SQ_G1 = 15, SQ_H1 = 16, SQ_I1 = 17;
const SQ_A2 = 18, SQ_B2 = 19, SQ_C2 = 20, SQ_D2 = 21, SQ_E2 = 22, SQ_F2 = 23, SQ_G2 = 24, SQ_H2 = 25, SQ_I2 = 26;
const SQ_A3 = 27, SQ_B3 = 28, SQ_C3 = 29, SQ_D3 = 30, SQ_E3 = 31, SQ_F3 = 32, SQ_G3 = 33, SQ_H3 = 34, SQ_I3 = 35;
const SQ_A4 = 36, SQ_B4 = 37, SQ_C4 = 38, SQ_D4 = 39, SQ_E4 = 40, SQ_F4 = 41, SQ_G4 = 42, SQ_H4 = 43, SQ_I4 = 44;
const SQ_A5 = 45, SQ_B5 = 46, SQ_C5 = 47, SQ_D5 = 48, SQ_E5 = 49, SQ_F5 = 50, SQ_G5 = 51, SQ_H5 = 52, SQ_I5 = 53;
const SQ_A6 = 54, SQ_B6 = 55, SQ_C6 = 56, SQ_D6 = 57, SQ_E6 = 58, SQ_F6 = 59, SQ_G6 = 60, SQ_H6 = 61, SQ_I6 = 62;
const SQ_A7 = 63, SQ_B7 = 64, SQ_C7 = 65, SQ_D7 = 66, SQ_E7 = 67, SQ_F7 = 68, SQ_G7 = 69, SQ_H7 = 70, SQ_I7 = 71;
const SQ_A8 = 72, SQ_B8 = 73, SQ_C8 = 74, SQ_D8 = 75, SQ_E8 = 76, SQ_F8 = 77, SQ_G8 = 78, SQ_H8 = 79, SQ_I8 = 80;
const SQ_A9 = 81, SQ_B9 = 82, SQ_C9 = 83, SQ_D9 = 84, SQ_E9 = 85, SQ_F9 = 86, SQ_G9 = 87, SQ_H9 = 88, SQ_I9 = 89;
const SQ_NONE = 90;
const SQUARE_ZERO = 0;
const SQUARE_NB = 90;

// Direction constants (North is towards black side)
const NORTH = 9;
const EAST = 1;
const SOUTH = -9;
const WEST = -1;
const NORTH_EAST = NORTH + EAST;
const SOUTH_EAST = SOUTH + EAST;
const SOUTH_WEST = SOUTH + WEST;
const NORTH_WEST = NORTH + WEST;

// File constants
const FILE_A = 0, FILE_B = 1, FILE_C = 2, FILE_D = 3, FILE_E = 4, FILE_F = 5, FILE_G = 6, FILE_H = 7, FILE_I = 8;
const FILE_NB = 9;

// Rank constants
const RANK_0 = 0, RANK_1 = 1, RANK_2 = 2, RANK_3 = 3, RANK_4 = 4;
const RANK_5 = 5, RANK_6 = 6, RANK_7 = 7, RANK_8 = 8, RANK_9 = 9;
const RANK_NB = 10;

// Depth constants
const DEPTH_QS_CHECKS = 0;
const DEPTH_QS_NO_CHECKS = -1;
const DEPTH_QS_RECAPTURES = -5;
const DEPTH_NONE = -6;
const DEPTH_OFFSET = -7;

// ==============================================
// Helper functions
// ==============================================

function mate_in(ply) { return VALUE_MATE - ply; }
function mated_in(ply) { return -VALUE_MATE + ply; }

function make_square(f, r) { return r * FILE_NB + f; }
function make_piece(c, pt) { return (c << 3) + pt; }
function type_of(pc) { return pc & 7; }
function color_of(pc) { return pc >> 3; }
function is_ok(s) { return s >= SQ_A0 && s <= SQ_I9; }
function file_of(s) { return s % FILE_NB; }
function rank_of(s) { return Math.floor(s / FILE_NB); }
function relative_rank(c, r) { return c === WHITE ? r : RANK_9 - r; }
function pawn_push(c) { return c === WHITE ? NORTH : SOUTH; }

function from_sq(m) { return m >> 7; }
function to_sq(m) { return m & 0x7F; }
function from_to(m) { return m; }
function make_move(from, to) { return (from << 7) + to; }
function make_chase(piece1, piece2) { return (piece1 << 4) + piece2; }
function is_ok_move(m) { return from_sq(m) !== to_sq(m); }

function flip_rank(s) {
  return SQ_A9 - s + (s % FILE_NB) * 2;
}

function flip_file(s) {
  return s + FILE_I - (s % FILE_NB) * 2;
}

// Based on congruential pseudo random number generator
function make_key(seed) {
  // We'll use 64-bit safe numbers in JS as BigInt for compatibility
  return (BigInt(seed) * 6364136223846793005n + 1442695040888963407n).toString();
}

// Score utilities
function make_score(mg, eg) {
  return (eg << 16) + (mg & 0xffff);
}

function mg_value(s) {
  return ((s & 0xffff) << 16) >> 16; // Sign-extend
}

function eg_value(s) {
  return s >> 16;
}

module.exports = {
  MAX_MOVES, MAX_PLY,
  MOVE_NONE, MOVE_NULL,
  WHITE, BLACK, COLOR_NB,
  PHASE_ENDGAME, PHASE_MIDGAME, MG, EG, PHASE_NB,
  SCALE_FACTOR_DRAW, SCALE_FACTOR_NORMAL, SCALE_FACTOR_MAX, SCALE_FACTOR_NONE,
  BOUND_NONE, BOUND_UPPER, BOUND_LOWER, BOUND_EXACT,
  VALUE_ZERO, VALUE_DRAW, VALUE_KNOWN_WIN, VALUE_MATE, VALUE_INFINITE, VALUE_NONE,
  VALUE_MATE_IN_MAX_PLY, VALUE_MATED_IN_MAX_PLY,
  NO_PIECE_TYPE, ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING, KNIGHT_TO, ALL_PIECES, PIECE_TYPE_NB,
  NO_PIECE, W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING, PIECE_NB,
  SQ_A0, SQ_B0, SQ_C0, SQ_D0, SQ_E0, SQ_F0, SQ_G0, SQ_H0, SQ_I0,
  SQ_A1, SQ_B1, SQ_C1, SQ_D1, SQ_E1, SQ_F1, SQ_G1, SQ_H1, SQ_I1,
  SQ_A2, SQ_B2, SQ_C2, SQ_D2, SQ_E2, SQ_F2, SQ_G2, SQ_H2, SQ_I2,
  SQ_A3, SQ_B3, SQ_C3, SQ_D3, SQ_E3, SQ_F3, SQ_G3, SQ_H3, SQ_I3,
  SQ_A4, SQ_B4, SQ_C4, SQ_D4, SQ_E4, SQ_F4, SQ_G4, SQ_H4, SQ_I4,
  SQ_A5, SQ_B5, SQ_C5, SQ_D5, SQ_E5, SQ_F5, SQ_G5, SQ_H5, SQ_I5,
  SQ_A6, SQ_B6, SQ_C6, SQ_D6, SQ_E6, SQ_F6, SQ_G6, SQ_H6, SQ_I6,
  SQ_A7, SQ_B7, SQ_C7, SQ_D7, SQ_E7, SQ_F7, SQ_G7, SQ_H7, SQ_I7,
  SQ_A8, SQ_B8, SQ_C8, SQ_D8, SQ_E8, SQ_F8, SQ_G8, SQ_H8, SQ_I8,
  SQ_A9, SQ_B9, SQ_C9, SQ_D9, SQ_E9, SQ_F9, SQ_G9, SQ_H9, SQ_I9,
  SQ_NONE, SQUARE_ZERO, SQUARE_NB,
  NORTH, EAST, SOUTH, WEST, NORTH_EAST, SOUTH_EAST, SOUTH_WEST, NORTH_WEST,
  FILE_A, FILE_B, FILE_C, FILE_D, FILE_E, FILE_F, FILE_G, FILE_H, FILE_I, FILE_NB,
  RANK_0, RANK_1, RANK_2, RANK_3, RANK_4, RANK_5, RANK_6, RANK_7, RANK_8, RANK_9, RANK_NB,
  DEPTH_QS_CHECKS, DEPTH_QS_NO_CHECKS, DEPTH_QS_RECAPTURES, DEPTH_NONE, DEPTH_OFFSET,
  PieceValue,
  mate_in, mated_in, make_square, make_piece, type_of, color_of, is_ok, file_of, rank_of,
  relative_rank, pawn_push, from_sq, to_sq, from_to, make_move, make_chase, is_ok_move,
  flip_rank, flip_file, make_key, make_score, mg_value, eg_value
};
