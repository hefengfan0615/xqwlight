"use strict";

// ============================================================
// Pikafish JS - Types (matching src/types.h)
// ============================================================

// Colors
const WHITE = 0, BLACK = 1, COLOR_NB = 2;

// Piece types
const NO_PIECE_TYPE = 0, ROOK = 1, ADVISOR = 2, CANNON = 3, PAWN = 4, KNIGHT = 5, BISHOP = 6, KING = 7, PIECE_TYPE_NB = 8;

// Piece encoding: (color * PIECE_TYPE_NB) + type
const NO_PIECE = 0;
const W_ROOK = 1, W_ADVISOR = 2, W_CANNON = 3, W_PAWN = 4, W_KNIGHT = 5, W_BISHOP = 6, W_KING = 7;
const B_ROOK = 8, B_ADVISOR = 9, B_CANNON = 10, B_PAWN = 11, B_KNIGHT = 12, B_BISHOP = 13, B_KING = 14;
const PIECE_NB = 16;

// Piece values (from types.h)
const PawnValueMg = 0,   PawnValueEg = 202;
const AdvisorValueMg = 104, AdvisorValueEg = 121;
const BishopValueMg = 167, BishopValueEg = 72;
const CannonValueMg = 768, CannonValueEg = 753;
const KnightValueMg = 561, KnightValueEg = 774;
const RookValueMg = 1373,  RookValueEg = 2122;

// PieceValue[phase][pieceType] - index 0 unused
const PieceValue = [
  // MG
  [0, RookValueMg, AdvisorValueMg, CannonValueMg, PawnValueMg, KnightValueMg, BishopValueMg, 0],
  // EG
  [0, RookValueEg, AdvisorValueEg, CannonValueEg, PawnValueEg, KnightValueEg, BishopValueEg, 0]
];

// Files and Ranks
const FILE_A = 0, FILE_B = 1, FILE_C = 2, FILE_D = 3, FILE_E = 4, FILE_F = 5, FILE_G = 6, FILE_H = 7, FILE_I = 8, FILE_NB = 9;
const RANK_0 = 0, RANK_1 = 1, RANK_2 = 2, RANK_3 = 3, RANK_4 = 4, RANK_5 = 5, RANK_6 = 6, RANK_7 = 7, RANK_8 = 8, RANK_9 = 9, RANK_NB = 10;

// Squares (rank * FILE_NB + file)
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
const SQUARE_NB = 90;

const SQ_NONE = 100;

// Directions
const NORTH = 9, SOUTH = -9, EAST = 1, WEST = -1;
const NORTH_EAST = NORTH + EAST, NORTH_WEST = NORTH + WEST;
const SOUTH_EAST = SOUTH + EAST, SOUTH_WEST = SOUTH + WEST;

// Value constants
const VALUE_ZERO = 0;
const VALUE_DRAW = 0;
const VALUE_KNOWN_WIN = 10000;
const VALUE_MATE = 32000;
const VALUE_INFINITE = 32001;
const VALUE_NONE = 32002;
const MAX_PLY = 246;
const MAX_MOVES = 512;

const VALUE_MATE_IN_MAX_PLY = VALUE_MATE - MAX_PLY;
const VALUE_MATED_IN_MAX_PLY = -VALUE_MATE_IN_MAX_PLY;

// Depth constants
const DEPTH_NONE = -6;
const DEPTH_OFFSET = -7;
const DEPTH_QS_CHECKS = 0;
const DEPTH_QS_NO_CHECKS = -1;
const DEPTH_QS_RECAPTURES = -5;

// Bounds
const BOUND_NONE = 0, BOUND_UPPER = 1, BOUND_LOWER = 2, BOUND_EXACT = 3;

// PieceToChar (matching C++: " RACPNBK racpnbk XXXXXX  xxxxxx")
const PIECE_TO_CHAR = " RACPNBK racpnbk";

// Helper functions
function make_square(f, r) { return r * FILE_NB + f; }
function file_of(s) { return s % FILE_NB; }
function rank_of(s) { return Math.floor(s / FILE_NB); }
function is_ok(s) { return s >= SQ_A0 && s <= SQ_I9; }

function type_of(pc) { return pc & 7; }
function color_of(pc) { return pc >> 3; }
function make_piece(c, pt) { return (c << 3) + pt; }

function relative_rank(c, r) { return c === WHITE ? r : RANK_9 - r; }

function flip_rank(s) { return make_square(file_of(s), RANK_9 - rank_of(s)); }
function flip_file(s) { return make_square(FILE_I - file_of(s), rank_of(s)); }

function opposite_color(c) { return c ^ 1; }

// Move encoding: (from << 7) | to
function make_move(from, to) { return (from << 7) | to; }
function from_sq(m) { return m >> 7; }
function to_sq(m) { return m & 0x7F; }
function is_ok_move(m) { return from_sq(m) !== to_sq(m); }

const MOVE_NONE = 0;
const MOVE_NULL = 65;

// Score helpers: score = mg + (eg << 16)
function make_score(mg, eg) { return (mg & 0xFFFF) | ((eg & 0xFFFF) << 16); }
function mg_value(s) { return s & 0xFFFF; }
function eg_value(s) { return (s >> 16) & 0xFFFF; }

// Sign-extend 16-bit to 32-bit
function mg_value_signed(s) { const v = s & 0xFFFF; return v >= 0x8000 ? v - 0x10000 : v; }
function eg_value_signed(s) { const v = (s >> 16) & 0xFFFF; return v >= 0x8000 ? v - 0x10000 : v; }

const SCORE_ZERO = 0;

// Bitboard operations (using BigInt for 90-bit board)
function square_bb(s) { return 1n << BigInt(s); }
function popcount(b) { return b.toString(2).replace(/0/g, '').length; }

// Shift operations on bitboards
function shift_north(b) { return (b << BigInt(NORTH)) & ALL_SQUARES_BB; }
function shift_south(b) { return (b >> BigInt(-SOUTH)) & ALL_SQUARES_BB; }
function shift_east(b) { return ((b & ~FileABB) << BigInt(EAST)) & ALL_SQUARES_BB; }
function shift_west(b) { return ((b & ~FileIBB) >> BigInt(-WEST)) & ALL_SQUARES_BB; }

// All squares bitboard
const ALL_SQUARES_BB = (1n << BigInt(SQUARE_NB)) - 1n;

// File and Rank bitboards
const FileABB = 0x002008040201008040201n;  // file A
const FileBBB = FileABB << BigInt(EAST);
const FileCBB = FileBBB << BigInt(EAST);
const FileDBB = FileCBB << BigInt(EAST);
const FileEBB = FileDBB << BigInt(EAST);
const FileFBB = FileEBB << BigInt(EAST);
const FileGBB = FileFBB << BigInt(EAST);
const FileHBB = FileGBB << BigInt(EAST);
const FileIBB = FileHBB << BigInt(EAST);

const Rank0BB = 0x1FFn;
const Rank1BB = Rank0BB << BigInt(FILE_NB);
const Rank2BB = Rank1BB << BigInt(FILE_NB);
const Rank3BB = Rank2BB << BigInt(FILE_NB);
const Rank4BB = Rank3BB << BigInt(FILE_NB);
const Rank5BB = Rank4BB << BigInt(FILE_NB);
const Rank6BB = Rank5BB << BigInt(FILE_NB);
const Rank7BB = Rank6BB << BigInt(FILE_NB);
const Rank8BB = Rank7BB << BigInt(FILE_NB);
const Rank9BB = Rank8BB << BigInt(FILE_NB);

const FILE_BB = [FileABB, FileBBB, FileCBB, FileDBB, FileEBB, FileFBB, FileGBB, FileHBB, FileIBB];
const RANK_BB = [Rank0BB, Rank1BB, Rank2BB, Rank3BB, Rank4BB, Rank5BB, Rank6BB, Rank7BB, Rank8BB, Rank9BB];

// Between bitboard lookup (for rook/cannon files, king flying)
const betweenBB = [];
for (let s1 = 0; s1 < SQUARE_NB; s1++) {
  betweenBB[s1] = [];
  for (let s2 = 0; s2 < SQUARE_NB; s2++) {
    betweenBB[s1][s2] = 0n;
    if (file_of(s1) === file_of(s2) && rank_of(s1) !== rank_of(s2)) {
      const minR = Math.min(rank_of(s1), rank_of(s2));
      const maxR = Math.max(rank_of(s1), rank_of(s2));
      for (let r = minR + 1; r < maxR; r++) {
        betweenBB[s1][s2] |= square_bb(make_square(file_of(s1), r));
      }
    } else if (rank_of(s1) === rank_of(s2) && file_of(s1) !== file_of(s2)) {
      const minF = Math.min(file_of(s1), file_of(s2));
      const maxF = Math.max(file_of(s1), file_of(s2));
      for (let f = minF + 1; f < maxF; f++) {
        betweenBB[s1][s2] |= square_bb(make_square(f, rank_of(s1)));
      }
    }
  }
}

function between_bb(s1, s2) { return betweenBB[s1][s2]; }

// Line bitboard (between + endpoints)
const lineBB = [];
for (let s1 = 0; s1 < SQUARE_NB; s1++) {
  lineBB[s1] = [];
  for (let s2 = 0; s2 < SQUARE_NB; s2++) {
    if (file_of(s1) === file_of(s2) || rank_of(s1) === rank_of(s2)) {
      lineBB[s1][s2] = betweenBB[s1][s2] | square_bb(s1) | square_bb(s2);
    } else {
      lineBB[s1][s2] = 0n;
    }
  }
}

function line_bb(s1, s2) { return lineBB[s1][s2]; }

// Pawn attacks bitboard
function pawn_attacks_bb(color, pawns) {
  let attacks = 0n;
  if (color === WHITE) {
    attacks |= shift_east(pawns & ~Rank9BB) << BigInt(NORTH) & ALL_SQUARES_BB;
    attacks |= shift_west(pawns & ~Rank9BB) << BigInt(NORTH) & ALL_SQUARES_BB;
  } else {
    attacks |= shift_east(pawns & ~Rank0BB) >> BigInt(-SOUTH) & ALL_SQUARES_BB;
    attacks |= shift_west(pawns & ~Rank0BB) >> BigInt(-SOUTH) & ALL_SQUARES_BB;
  }
  return attacks;
}

// King attacks lookup
const kingAttacksBB = new Array(SQUARE_NB).fill(0n);
for (let s = 0; s < SQUARE_NB; s++) {
  let atk = 0n;
  const f = file_of(s), r = rank_of(s);
  if (r > 0) atk |= square_bb(make_square(f, r - 1));
  if (r < 9) atk |= square_bb(make_square(f, r + 1));
  if (f > 0) atk |= square_bb(make_square(f - 1, r));
  if (f < 8) atk |= square_bb(make_square(f + 1, r));
  kingAttacksBB[s] = atk;
}

// Advisor attacks lookup
const advisorAttacksBB = new Array(SQUARE_NB).fill(0n);
// White palace: D0-F2, diagonal moves
advisorAttacksBB[SQ_D0] = square_bb(SQ_E1);
advisorAttacksBB[SQ_F0] = square_bb(SQ_E1);
advisorAttacksBB[SQ_E1] = square_bb(SQ_D0) | square_bb(SQ_F0) | square_bb(SQ_D2) | square_bb(SQ_F2);
advisorAttacksBB[SQ_D2] = square_bb(SQ_E1);
advisorAttacksBB[SQ_F2] = square_bb(SQ_E1);
// Black palace: D7-F9, diagonal moves
advisorAttacksBB[SQ_D7] = square_bb(SQ_E8);
advisorAttacksBB[SQ_F7] = square_bb(SQ_E8);
advisorAttacksBB[SQ_E8] = square_bb(SQ_D7) | square_bb(SQ_F7) | square_bb(SQ_D9) | square_bb(SQ_F9);
advisorAttacksBB[SQ_D9] = square_bb(SQ_E8);
advisorAttacksBB[SQ_F9] = square_bb(SQ_E8);

// Bishop attacks lookup (with eye/pin squares)
const bishopMoves = []; // bishopMoves[sq] = [{to, eye}, ...]
for (let s = 0; s < SQUARE_NB; s++) {
  const moves = [];
  const f = file_of(s), r = rank_of(s);
  const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
  for (const [df, dr] of dirs) {
    const tf = f + df, tr = r + dr;
    const ef = f + df / 2, er = r + dr / 2; // eye
    if (tf >= 0 && tf <= 8 && tr >= 0 && tr <= 9 && ef >= 0 && ef <= 8 && er >= 0 && er <= 9) {
      // Bishop can't cross river
      if (r <= 4 && tr <= 4 || r >= 5 && tr >= 5) {
        moves.push({ to: make_square(tf, tr), eye: make_square(ef, er) });
      }
    }
  }
  bishopMoves[s] = moves;
}

// Knight attacks lookup (with pin squares)
const knightMoves = [];
for (let s = 0; s < SQUARE_NB; s++) {
  const moves = [];
  const f = file_of(s), r = rank_of(s);
  const knightJumps = [
    [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
    [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]
  ];
  for (const [df, dr, pf, pr] of knightJumps) {
    const tf = f + df, tr = r + dr;
    const pinF = f + pf, pinR = r + pr;
    if (tf >= 0 && tf <= 8 && tr >= 0 && tr <= 9) {
      moves.push({ to: make_square(tf, tr), pin: make_square(pinF, pinR) });
    }
  }
  knightMoves[s] = moves;
}

// King palace bitboards
const WhitePalaceBB = square_bb(SQ_D0) | square_bb(SQ_E0) | square_bb(SQ_F0)
  | square_bb(SQ_D1) | square_bb(SQ_E1) | square_bb(SQ_F1)
  | square_bb(SQ_D2) | square_bb(SQ_E2) | square_bb(SQ_F2);

const BlackPalaceBB = square_bb(SQ_D7) | square_bb(SQ_E7) | square_bb(SQ_F7)
  | square_bb(SQ_D8) | square_bb(SQ_E8) | square_bb(SQ_F8)
  | square_bb(SQ_D9) | square_bb(SQ_E9) | square_bb(SQ_F9);

const PalaceBB = [WhitePalaceBB, BlackPalaceBB];

// Rook attacks (sliding, needs occupied bitboard)
function rook_attacks_bb(s, occupied) {
  let result = 0n;
  // North
  for (let r = rank_of(s) + 1; r <= 9; r++) {
    const sq = make_square(file_of(s), r);
    result |= square_bb(sq);
    if (occupied & square_bb(sq)) break;
  }
  // South
  for (let r = rank_of(s) - 1; r >= 0; r--) {
    const sq = make_square(file_of(s), r);
    result |= square_bb(sq);
    if (occupied & square_bb(sq)) break;
  }
  // East
  for (let f = file_of(s) + 1; f <= 8; f++) {
    const sq = make_square(f, rank_of(s));
    result |= square_bb(sq);
    if (occupied & square_bb(sq)) break;
  }
  // West
  for (let f = file_of(s) - 1; f >= 0; f--) {
    const sq = make_square(f, rank_of(s));
    result |= square_bb(sq);
    if (occupied & square_bb(sq)) break;
  }
  return result;
}

// Cannon attacks (sliding with screen, needs occupied bitboard)
function cannon_attacks_bb(s, occupied) {
  let result = 0n;
  const dirs = [NORTH, SOUTH, EAST, WEST];
  for (const dir of dirs) {
    let sq = s;
    let screenFound = false;
    while (true) {
      const nf = file_of(sq) + (dir === EAST ? 1 : dir === WEST ? -1 : 0);
      const nr = rank_of(sq) + (dir === NORTH ? 1 : dir === SOUTH ? -1 : 0);
      if (nf < 0 || nf > 8 || nr < 0 || nr > 9) break;
      const nsq = make_square(nf, nr);
      if (!screenFound) {
        if (occupied & square_bb(nsq)) {
          screenFound = true;
        } else {
          result |= square_bb(nsq);
        }
      } else {
        if (occupied & square_bb(nsq)) {
          result |= square_bb(nsq);
          break;
        }
      }
      sq = nsq;
    }
  }
  return result;
}

// Generic attacks_bb dispatcher
function attacks_bb(pt, s, occupied) {
  switch (pt) {
    case KING: return kingAttacksBB[s];
    case ADVISOR: return advisorAttacksBB[s];
    case BISHOP: {
      let result = 0n;
      for (const m of bishopMoves[s]) {
        if (!(occupied & square_bb(m.eye))) result |= square_bb(m.to);
      }
      return result;
    }
    case KNIGHT: {
      let result = 0n;
      for (const m of knightMoves[s]) {
        if (!(occupied & square_bb(m.pin))) result |= square_bb(m.to);
      }
      return result;
    }
    case ROOK: return rook_attacks_bb(s, occupied);
    case CANNON: return cannon_attacks_bb(s, occupied);
    default: return 0n;
  }
}

// LSB extraction (least significant bit)
function lsb(b) {
  if (b === 0n) return -1;
  const binary = b.toString(2);
  return SQUARE_NB - binary.length;
}

// Pop and return LSB
function pop_lsb(b) {
  if (b === 0n) return -1;
  const idx = lsb(b);
  return idx;
}

// Iterate over set bits
function forEachBit(b, callback) {
  let temp = b;
  while (temp) {
    const idx = lsb(temp);
    callback(idx);
    temp ^= square_bb(idx);
  }
}

// Count pieces between squares (for cannon)
function count_between(s1, s2, occupied) {
  const between = betweenBB[s1][s2];
  return popcount(between & occupied);
}

// Check if on same file/rank
function same_file(s1, s2) { return file_of(s1) === file_of(s2); }
function same_rank(s1, s2) { return rank_of(s1) === rank_of(s2); }
function aligned(s1, s2) { return same_file(s1, s2) || same_rank(s1, s2); }

module.exports = {
  WHITE, BLACK, COLOR_NB,
  NO_PIECE_TYPE, ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING, PIECE_TYPE_NB,
  NO_PIECE, W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING, PIECE_NB,
  PawnValueMg, PawnValueEg, AdvisorValueMg, AdvisorValueEg, BishopValueMg, BishopValueEg,
  CannonValueMg, CannonValueEg, KnightValueMg, KnightValueEg, RookValueMg, RookValueEg,
  PieceValue,
  FILE_A, FILE_B, FILE_C, FILE_D, FILE_E, FILE_F, FILE_G, FILE_H, FILE_I, FILE_NB,
  RANK_0, RANK_1, RANK_2, RANK_3, RANK_4, RANK_5, RANK_6, RANK_7, RANK_8, RANK_9, RANK_NB,
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
  SQ_NONE, SQUARE_NB,
  NORTH, SOUTH, EAST, WEST, NORTH_EAST, NORTH_WEST, SOUTH_EAST, SOUTH_WEST,
  VALUE_ZERO, VALUE_DRAW, VALUE_KNOWN_WIN, VALUE_MATE, VALUE_INFINITE, VALUE_NONE,
  MAX_PLY, MAX_MOVES, VALUE_MATE_IN_MAX_PLY, VALUE_MATED_IN_MAX_PLY,
  DEPTH_NONE, DEPTH_OFFSET, DEPTH_QS_CHECKS, DEPTH_QS_NO_CHECKS, DEPTH_QS_RECAPTURES,
  BOUND_NONE, BOUND_UPPER, BOUND_LOWER, BOUND_EXACT,
  PIECE_TO_CHAR,
  make_square, file_of, rank_of, is_ok,
  type_of, color_of, make_piece, relative_rank, flip_rank, flip_file, opposite_color,
  make_move, from_sq, to_sq, is_ok_move, MOVE_NONE, MOVE_NULL,
  make_score, mg_value, eg_value, SCORE_ZERO,
  mg_value_signed, eg_value_signed,
  ALL_SQUARES_BB, FileABB, FileBBB, FileCBB, FileDBB, FileEBB, FileFBB, FileGBB, FileHBB, FileIBB,
  Rank0BB, Rank1BB, Rank2BB, Rank3BB, Rank4BB, Rank5BB, Rank6BB, Rank7BB, Rank8BB, Rank9BB,
  FILE_BB, RANK_BB,
  square_bb, popcount, shift_north, shift_south, shift_east, shift_west,
  between_bb, line_bb,
  pawn_attacks_bb,
  kingAttacksBB, advisorAttacksBB, bishopMoves, knightMoves,
  PalaceBB, WhitePalaceBB, BlackPalaceBB,
  rook_attacks_bb, cannon_attacks_bb, attacks_bb,
  lsb, pop_lsb, forEachBit, count_between, same_file, same_rank, aligned
};
