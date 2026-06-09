/*
 * Pikafish Chinese Chess Engine - Types & Constants
 * Converted from Stockfish/Pikafish C++ types.h
 */

export const MAX_MOVES = 128;
export const MAX_PLY = 246;

// Board dimensions
export const FILE_NB = 9;
export const RANK_NB = 10;
export const SQUARE_NB = 90;

// Colors
export const WHITE = 0;
export const BLACK = 1;
export const COLOR_NB = 2;

// Piece types
export const NO_PIECE_TYPE = 0;
export const ROOK = 1;
export const ADVISOR = 2;
export const CANNON = 3;
export const PAWN = 4;
export const KNIGHT = 5;
export const BISHOP = 6;
export const KING = 7;
export const KNIGHT_TO = 7;
export const PIECE_TYPE_NB = 8;

// Pieces (color * 8 + pieceType)
export const NO_PIECE = 0;
export const W_ROOK = 1,    W_ADVISOR = 2, W_CANNON = 3, W_PAWN = 4,
             W_KNIGHT = 5,   W_BISHOP = 6,  W_KING = 7;
export const B_ROOK = 9,    B_ADVISOR = 10, B_CANNON = 11, B_PAWN = 12,
             B_KNIGHT = 13,  B_BISHOP = 14, B_KING = 15;
export const PIECE_NB = 16;

// Piece values
export const RookValueMg = 1373,    RookValueEg = 2122;
export const AdvisorValueMg = 104,  AdvisorValueEg = 121;
export const CannonValueMg = 768,   CannonValueEg = 753;
export const PawnValueMg = 127,     PawnValueEg = 182;
export const KnightValueMg = 561,   KnightValueEg = 774;
export const BishopValueMg = 167,   BishopValueEg = 72;

export const PieceValue = [
  // Middlegame
  [0, RookValueMg, AdvisorValueMg, CannonValueMg, PawnValueMg, KnightValueMg, BishopValueMg, 0,
   0, RookValueMg, AdvisorValueMg, CannonValueMg, PawnValueMg, KnightValueMg, BishopValueMg, 0],
  // Endgame
  [0, RookValueEg, AdvisorValueEg, CannonValueEg, PawnValueEg, KnightValueEg, BishopValueEg, 0,
   0, RookValueEg, AdvisorValueEg, CannonValueEg, PawnValueEg, KnightValueEg, BishopValueEg, 0]
];

// Value constants
export const VALUE_ZERO = 0;
export const VALUE_DRAW = 0;
export const VALUE_KNOWN_WIN = 10000;
export const VALUE_MATE = 32000;
export const VALUE_INFINITE = 32001;
export const VALUE_NONE = 32002;
export const VALUE_MATE_IN_MAX_PLY = VALUE_MATE - MAX_PLY;
export const VALUE_MATED_IN_MAX_PLY = -VALUE_MATE_IN_MAX_PLY;

// Depth constants
export const DEPTH_QS_CHECKS = 0;
export const DEPTH_QS_NO_CHECKS = -1;
export const DEPTH_QS_RECAPTURES = -5;
export const DEPTH_NONE = -6;
export const DEPTH_OFFSET = -7;

// Phase
export const PHASE_ENDGAME = 0;
export const PHASE_MIDGAME = 128;
export const MG = 0, EG = 1, PHASE_NB = 2;

// Scale factor
export const SCALE_FACTOR_DRAW = 0;
export const SCALE_FACTOR_NORMAL = 64;
export const SCALE_FACTOR_MAX = 128;
export const SCALE_FACTOR_NONE = 255;

// Bounds
export const BOUND_NONE = 0;
export const BOUND_UPPER = 1;
export const BOUND_LOWER = 2;
export const BOUND_EXACT = BOUND_UPPER | BOUND_LOWER;

// Directions (10x9 board)
export const NORTH = 9;
export const EAST = 1;
export const SOUTH = -9;
export const WEST = -1;
export const NORTH_EAST = NORTH + EAST;
export const SOUTH_EAST = SOUTH + EAST;
export const SOUTH_WEST = SOUTH + WEST;
export const NORTH_WEST = NORTH + WEST;

// === String representation ===

export const PieceToChar = [
  ' ', 'R', 'A', 'C', 'P', 'N', 'B', 'K',
  ' ', 'r', 'a', 'c', 'p', 'n', 'b', 'k'
];

export const PieceTypeToChar = [
  ' ', 'R', 'A', 'C', 'P', 'N', 'B', 'K'
];

export const FenPieceMap = {
  'K': W_KING, 'A': W_ADVISOR, 'B': W_BISHOP, 'N': W_KNIGHT,
  'R': W_ROOK, 'C': W_CANNON, 'P': W_PAWN,
  'k': B_KING, 'a': B_ADVISOR, 'b': B_BISHOP, 'n': B_KNIGHT,
  'r': B_ROOK, 'c': B_CANNON, 'p': B_PAWN
};

// === Utility functions ===

export function colorOf(pc) { return pc >> 3; }
export function typeOf(pc) { return pc & 7; }
export function makePiece(color, pt) { return (color << 3) + pt; }
export function isOkSquare(s) { return s >= 0 && s < SQUARE_NB; }
export function fileOf(s) { return s % FILE_NB; }
export function rankOf(s) { return Math.floor(s / FILE_NB); }
export function makeSquare(file, rank) { return rank * FILE_NB + file; }
export function relativeRank(c, r) { return c === WHITE ? r : (RANK_NB - 1 - r); }
export function relativeRankOf(c, s) { return relativeRank(c, rankOf(s)); }
export function pawnPush(c) { return c === WHITE ? NORTH : SOUTH; }
export function flipRank(s) { return (SQ_A9 - s) + (s % 9) * 2; }
export function flipFile(s) { return s + 8 - (s % 9) * 2; }

export function mateIn(ply) { return VALUE_MATE - ply; }
export function matedIn(ply) { return -VALUE_MATE + ply; }

// Move encoding: low 7 bits = to, next 7 bits = from
export const MOVE_NONE = 0;
export const MOVE_NULL = 129;

export function fromSq(m) { return m >> 7; }
export function toSq(m) { return m & 0x7F; }
export function fromTo(m) { return m; }
export function makeMove(from, to) { return (from << 7) + to; }
export function isOkMove(m) { return fromSq(m) !== toSq(m); }

export function makeChase(piece1, piece2) {
  return (piece1 << 4) + piece2;
}

// Score: combines mg and eg
export const SCORE_ZERO = 0;

export function makeScore(mg, eg) {
  return ((eg & 0xFFFF) << 16) + (mg & 0xFFFF);
}

export function mgValue(s) {
  const v = s & 0xFFFF;
  return v > 0x7FFF ? v - 0x10000 : v;
}

export function egValue(s) {
  const v = (s + 0x8000) >> 16;
  return v > 0x7FFF ? v - 0x10000 : v;
}

// Key generation
export function makeKey(seed) {
  return BigInt(seed) * 6364136223846793005n + 1442695040888963407n;
}

// Square names
export const SQ_A0 = 0, SQ_B0 = 1, SQ_C0 = 2, SQ_D0 = 3, SQ_E0 = 4, SQ_F0 = 5, SQ_G0 = 6, SQ_H0 = 7, SQ_I0 = 8;
export const SQ_A1 = 9, SQ_B1 = 10, SQ_C1 = 11, SQ_D1 = 12, SQ_E1 = 13, SQ_F1 = 14, SQ_G1 = 15, SQ_H1 = 16, SQ_I1 = 17;
export const SQ_A2 = 18, SQ_B2 = 19, SQ_C2 = 20, SQ_D2 = 21, SQ_E2 = 22, SQ_F2 = 23, SQ_G2 = 24, SQ_H2 = 25, SQ_I2 = 26;
export const SQ_A3 = 27, SQ_B3 = 28, SQ_C3 = 29, SQ_D3 = 30, SQ_E3 = 31, SQ_F3 = 32, SQ_G3 = 33, SQ_H3 = 34, SQ_I3 = 35;
export const SQ_A4 = 36, SQ_B4 = 37, SQ_C4 = 38, SQ_D4 = 39, SQ_E4 = 40, SQ_F4 = 41, SQ_G4 = 42, SQ_H4 = 43, SQ_I4 = 44;
export const SQ_A5 = 45, SQ_B5 = 46, SQ_C5 = 47, SQ_D5 = 48, SQ_E5 = 49, SQ_F5 = 50, SQ_G5 = 51, SQ_H5 = 52, SQ_I5 = 53;
export const SQ_A6 = 54, SQ_B6 = 55, SQ_C6 = 56, SQ_D6 = 57, SQ_E6 = 58, SQ_F6 = 59, SQ_G6 = 60, SQ_H6 = 61, SQ_I6 = 62;
export const SQ_A7 = 63, SQ_B7 = 64, SQ_C7 = 65, SQ_D7 = 66, SQ_E7 = 67, SQ_F7 = 68, SQ_G7 = 69, SQ_H7 = 70, SQ_I7 = 71;
export const SQ_A8 = 72, SQ_B8 = 73, SQ_C8 = 74, SQ_D8 = 75, SQ_E8 = 76, SQ_F8 = 77, SQ_G8 = 78, SQ_H8 = 79, SQ_I8 = 80;
export const SQ_A9 = 81, SQ_B9 = 82, SQ_C9 = 83, SQ_D9 = 84, SQ_E9 = 85, SQ_F9 = 86, SQ_G9 = 87, SQ_H9 = 88, SQ_I9 = 89;
export const SQ_NONE = 90;

export const SquareName = [
  'a0','b0','c0','d0','e0','f0','g0','h0','i0',
  'a1','b1','c1','d1','e1','f1','g1','h1','i1',
  'a2','b2','c2','d2','e2','f2','g2','h2','i2',
  'a3','b3','c3','d3','e3','f3','g3','h3','i3',
  'a4','b4','c4','d4','e4','f4','g4','h4','i4',
  'a5','b5','c5','d5','e5','f5','g5','h5','i5',
  'a6','b6','c6','d6','e6','f6','g6','h6','i6',
  'a7','b7','c7','d7','e7','f7','g7','h7','i7',
  'a8','b8','c8','d8','e8','f8','g8','h8','i8',
  'a9','b9','c9','d9','e9','f9','g9','h9','i9',
];

// File/Rank names	
export const FILE_A = 0, FILE_B = 1, FILE_C = 2, FILE_D = 3, FILE_E = 4,
             FILE_F = 5, FILE_G = 6, FILE_H = 7, FILE_I = 8;
export const RANK_0 = 0, RANK_1 = 1, RANK_2 = 2, RANK_3 = 3, RANK_4 = 4,
             RANK_5 = 5, RANK_6 = 6, RANK_7 = 7, RANK_8 = 8, RANK_9 = 9;