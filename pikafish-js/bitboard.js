"use strict";

const T = require('./types.js');

// ==============================================
// Bitboard implementation
// ==============================================

// We'll use an array to represent the board state for easier manipulation in JS
// Also keep bitboard-like representation for compatibility

class Bitboard {
  constructor(low = 0, high = 0) {
    this.low = low >>> 0;
    this.high = high >>> 0;
  }

  // Convert to boolean
  toBool() {
    return this.low !== 0 || this.high !== 0;
  }

  // Copy
  clone() {
    return new Bitboard(this.low, this.high);
  }

  // Set a bit
  set(sq) {
    if (sq < 64) {
      this.low |= 1 << sq;
    } else {
      this.high |= 1 << (sq - 64);
    }
    return this;
  }

  // Clear a bit
  clear(sq) {
    if (sq < 64) {
      this.low &= ~(1 << sq);
    } else {
      this.high &= ~(1 << (sq - 64));
    }
    return this;
  }

  // Test a bit
  test(sq) {
    if (sq < 64) {
      return (this.low & (1 << sq)) !== 0;
    }
    return (this.high & (1 << (sq - 64))) !== 0;
  }

  // Bitwise operations
  not() {
    return new Bitboard(~this.low, ~this.high);
  }

  // Convert to BigInt
  toBigInt() {
    return (BigInt(this.high) << 64n) | BigInt(this.low);
  }

  and(other) {
    return new Bitboard(this.low & other.low, this.high & other.high);
  }

  or(other) {
    return new Bitboard(this.low | other.low, this.high | other.high);
  }

  xor(other) {
    return new Bitboard(this.low ^ other.low, this.high ^ other.high);
  }

  // Shift operations
  shl(amount) {
    if (amount >= 64) {
      return new Bitboard(0, this.low << (amount - 64));
    } else if (amount === 0) {
      return new Bitboard(this.low, this.high);
    } else {
      return new Bitboard(this.low << amount, (this.high << amount) | (this.low >>> (64 - amount)));
    }
  }

  shr(amount) {
    if (amount >= 64) {
      return new Bitboard(this.high >>> (amount - 64), 0);
    } else if (amount === 0) {
      return new Bitboard(this.low, this.high);
    } else {
      return new Bitboard((this.low >>> amount) | (this.high << (64 - amount)), this.high >>> amount);
    }
  }

  // Negation
  neg() {
    let carry = 1;
    let newLow = (~this.low + carry) >>> 0;
    let newHigh = (~this.high + (newLow < this.low ? 1 : 0)) >>> 0;
    return new Bitboard(newLow, newHigh);
  }

  // Subtract
  sub(other) {
    let borrow = 0;
    let newLow = this.low - other.low;
    if (newLow < 0) {
      borrow = 1;
      newLow += 0x100000000;
    }
    let newHigh = this.high - other.high - borrow;
    if (newHigh < 0) newHigh += 0x100000000;
    return new Bitboard(newLow >>> 0, newHigh >>> 0);
  }

  // Equals
  equals(other) {
    return this.low === other.low && this.high === other.high;
  }

  // Count set bits (popcount)
  popcount() {
    let count = 0;
    let n = this.low;
    while (n) {
      n &= n - 1;
      count++;
    }
    n = this.high;
    while (n) {
      n &= n - 1;
      count++;
    }
    return count;
  }

  // Find least significant bit
  lsb() {
    if (this.low !== 0) {
      let n = this.low & -this.low;
      let bitPos = 0;
      while (n >>= 1) bitPos++;
      return bitPos;
    }
    let n = this.high & -this.high;
    let bitPos = 64;
    while (n >>= 1) bitPos++;
    return bitPos;
  }

  // Pop least significant bit
  poplsb() {
    if (this.low !== 0) {
      let lsb = this.low & -this.low;
      let bitPos = 0;
      let n = lsb;
      while (n >>= 1) bitPos++;
      this.low ^= lsb;
      return bitPos;
    }
    let lsb = this.high & -this.high;
    let bitPos = 64;
    let n = lsb;
    while (n >>= 1) bitPos++;
    this.high ^= lsb;
    return bitPos;
  }

  // Static method to create from a single square
  static square(sq) {
    const b = new Bitboard();
    b.set(sq);
    return b;
  }
}

// ==============================================
// Predefined bitboards
// ==============================================

// Palace (9 squares for each side) - converted to BigInt
function makeBB(low, high) {
  return (BigInt(high) << 64n) | BigInt(low >>> 0);
}

const Palace = makeBB(0x70381C, 0xE07038);

// File bitboards - converted to BigInt
const FileABB = makeBB(0x8040201008040201, 0x20100);
const FileBBB = makeBB(0x1008040201008040, 0x40200);
const FileCBB = makeBB(0x2010080402010080, 0x80400);
const FileDBB = makeBB(0x4020100804020100, 0x100800);
const FileEBB = makeBB(0x8040201008040200, 0x201000);
const FileFBB = makeBB(0x10080402010080400, 0x402000);
const FileGBB = makeBB(0x20100804020100800, 0x804000);
const FileHBB = makeBB(0x40201008040201000, 0x1008000);
const FileIBB = makeBB(0x80402010080402000, 0x2010000);

// Rank bitboards - converted to BigInt
let Rank0BB = makeBB(0x1FF, 0);
let Rank1BB = Rank0BB << BigInt(T.FILE_NB);
let Rank2BB = Rank0BB << BigInt(T.FILE_NB * 2);
let Rank3BB = Rank0BB << BigInt(T.FILE_NB * 3);
let Rank4BB = Rank0BB << BigInt(T.FILE_NB * 4);
let Rank5BB = Rank0BB << BigInt(T.FILE_NB * 5);
let Rank6BB = Rank0BB << BigInt(T.FILE_NB * 6);
let Rank7BB = Rank0BB << BigInt(T.FILE_NB * 7);
let Rank8BB = Rank0BB << BigInt(T.FILE_NB * 8);
let Rank9BB = Rank0BB << BigInt(T.FILE_NB * 9);

const HalfBB = [
  Rank0BB | Rank1BB | Rank2BB | Rank3BB | Rank4BB,
  Rank5BB | Rank6BB | Rank7BB | Rank8BB | Rank9BB
];

const PawnBB = [
  HalfBB[T.BLACK] | (Rank3BB & FileABB) | (Rank3BB & FileCBB) | (Rank3BB & FileEBB) | (Rank3BB & FileGBB) | (Rank3BB & FileIBB) | (Rank4BB & FileABB) | (Rank4BB & FileCBB) | (Rank4BB & FileEBB) | (Rank4BB & FileGBB) | (Rank4BB & FileIBB),
  HalfBB[T.WHITE] | (Rank6BB & FileABB) | (Rank6BB & FileCBB) | (Rank6BB & FileEBB) | (Rank6BB & FileGBB) | (Rank6BB & FileIBB) | (Rank5BB & FileABB) | (Rank5BB & FileCBB) | (Rank5BB & FileEBB) | (Rank5BB & FileGBB) | (Rank5BB & FileIBB)
];

// Precompute PopCnt16
const PopCnt16 = new Array(1 << 16);
for (let i = 0; i < (1 << 16); i++) {
  let count = 0;
  let n = i;
  while (n) {
    n &= n - 1;
    count++;
  }
  PopCnt16[i] = count;
}

// Precompute SquareDistance
const SquareDistance = new Array(T.SQUARE_NB);
for (let i = 0; i < T.SQUARE_NB; i++) {
  SquareDistance[i] = new Array(T.SQUARE_NB);
  for (let j = 0; j < T.SQUARE_NB; j++) {
    SquareDistance[i][j] = Math.max(Math.abs(T.file_of(i) - T.file_of(j)), Math.abs(T.rank_of(i) - T.rank_of(j)));
  }
}

// Precompute SquareBB
const SquareBB = new Array(T.SQUARE_NB);
for (let sq = 0; sq < T.SQUARE_NB; sq++) {
  SquareBB[sq] = 1n << BigInt(sq);
}

// Precompute LineBB and BetweenBB (simplified version)
const LineBB = new Array(T.SQUARE_NB);
const BetweenBB = new Array(T.SQUARE_NB);
for (let i = 0; i < T.SQUARE_NB; i++) {
  LineBB[i] = new Array(T.SQUARE_NB);
  BetweenBB[i] = new Array(T.SQUARE_NB);
  for (let j = 0; j < T.SQUARE_NB; j++) {
    LineBB[i][j] = 0n;
    BetweenBB[i][j] = 0n;
    
    if (i === j) continue;
    
    const fi = T.file_of(i);
    const ri = T.rank_of(i);
    const fj = T.file_of(j);
    const rj = T.rank_of(j);
    
    if (fi === fj || ri === rj) {
      let from = Math.min(i, j);
      let to = Math.max(i, j);
      for (let k = from; k <= to; k++) {
        if (fi === T.file_of(k)) {
          LineBB[i][j] |= (1n << BigInt(k));
          if (k > Math.min(i, j) && k < Math.max(i, j)) {
            BetweenBB[i][j] |= (1n << BigInt(k));
          }
        }
      }
      if (ri === rj) {
        for (let f = Math.min(fi, fj); f <= Math.max(fi, fj); f++) {
          let k = T.make_square(f, ri);
          LineBB[i][j] |= (1n << BigInt(k));
          if (k > Math.min(i, j) && k < Math.max(i, j)) {
            BetweenBB[i][j] |= (1n << BigInt(k));
          }
        }
      }
    }
  }
}

// Precompute PseudoAttacks, PawnAttacks
const PseudoAttacks = new Array(T.PIECE_TYPE_NB);
const PawnAttacks = new Array(T.COLOR_NB);
const PawnAttacksTo = new Array(T.COLOR_NB);

// Initialize PseudoAttacks with BigInt arrays
for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
  PseudoAttacks[pt] = new Array(T.SQUARE_NB);
  for (let sq = 0; sq < T.SQUARE_NB; sq++) {
    PseudoAttacks[pt][sq] = 0n;
  }
}

for (let c = 0; c < T.COLOR_NB; c++) {
  PawnAttacks[c] = new Array(T.SQUARE_NB);
  PawnAttacksTo[c] = new Array(T.SQUARE_NB);
  for (let sq = 0; sq < T.SQUARE_NB; sq++) {
    PawnAttacks[c][sq] = 0n;
    PawnAttacksTo[c][sq] = 0n;
  }
}

// ==============================================
// Helper functions
// ==============================================

function square_bb(sq) {
  return SquareBB[sq];
}

function rank_bb(r) {
  return Rank0BB << BigInt(T.FILE_NB * r);
}

function file_bb(f) {
  return FileABB << BigInt(f);
}

function more_than_one(b) {
  return b & (b - 1n);
}

function shift(b, d) {
  if (d === T.NORTH) return (b & ~Rank9BB) << 9n;
  if (d === T.SOUTH) return b >> 9n;
  if (d === T.EAST) return (b & ~FileIBB) << 1n;
  if (d === T.WEST) return (b & ~FileABB) >> 1n;
  if (d === T.NORTH_EAST) return ((b & ~Rank9BB) << 9n & ~FileIBB) << 1n;
  if (d === T.SOUTH_EAST) return (b >> 9n & ~FileIBB) << 1n;
  if (d === T.SOUTH_WEST) return (b >> 9n & ~FileABB) >> 1n;
  if (d === T.NORTH_WEST) return ((b & ~Rank9BB) << 9n & ~FileABB) >> 1n;
  return 0n;
}

function pawn_attacks_bb(c, sq) {
  const sqBit = 1n << BigInt(sq);
  const attack = shift(sqBit, c === T.WHITE ? T.NORTH : T.SOUTH);
  if ((c === T.WHITE && T.rank_of(sq) > T.RANK_4) || (c === T.BLACK && T.rank_of(sq) < T.RANK_5)) {
    return attack | shift(sqBit, T.WEST) | shift(sqBit, T.EAST);
  }
  return attack;
}

function pawn_attacks_to_bb(c, sq) {
  const sqBit = 1n << BigInt(sq);
  const attack = shift(sqBit, c === T.WHITE ? T.SOUTH : T.NORTH);
  if ((c === T.WHITE && T.rank_of(sq) > T.RANK_4) || (c === T.BLACK && T.rank_of(sq) < T.RANK_5)) {
    return attack | shift(sqBit, T.WEST) | shift(sqBit, T.EAST);
  }
  return attack;
}

function line_bb(s1, s2) {
  return LineBB[s1][s2];
}

function between_bb(s1, s2) {
  return BetweenBB[s1][s2];
}

function aligned(s1, s2, s3) {
  return (line_bb(s1, s2) & (1n << BigInt(s3))) !== 0n;
}

function distance(s1, s2) {
  return SquareDistance[s1][s2];
}

function popcount(b) {
  if (b === 0n) return 0;
  let count = 0;
  let n = b;
  while (n > 0n) {
    n &= n - 1n;
    count++;
  }
  return count;
}

function lsb(b) {
  // Get position of least significant bit for BigInt
  if (b === 0n) return -1;
  const bit = b & -b; // isolate LSB
  let count = 0;
  let n = bit;
  while (n > 1n) {
    n >>= 1n;
    count++;
  }
  return count;
}

function least_significant_square_bb(b) {
  return square_bb(lsb(b));
}

// Pop least significant bit - returns [square, newBitboard]
// Since JS passes primitives by value, we must return the modified bitboard
function pop_lsb(b) {
  const sq = lsb(b);
  const newB = b ^ (1n << BigInt(sq));
  return [sq, newB];
}

// ==============================================
// Magic bitboards (simplified implementation)
// ==============================================

// We'll implement simpler attack generation for initial version
const RookAttacks = new Array(T.SQUARE_NB);
const CannonAttacks = new Array(T.SQUARE_NB);
const BishopAttacks = new Array(T.SQUARE_NB);
const KnightAttacks = new Array(T.SQUARE_NB);
const KnightToAttacks = new Array(T.SQUARE_NB);

function init_attacks() {
  // Initialize KnightToAttacks first
  for (let sq = 0; sq < T.SQUARE_NB; sq++) {
    KnightToAttacks[sq] = 0n;
  }
  
  // Initialize attack tables for all pieces
  for (let sq = 0; sq < T.SQUARE_NB; sq++) {
    RookAttacks[sq] = 0n;
    CannonAttacks[sq] = 0n;
    BishopAttacks[sq] = 0n;
    KnightAttacks[sq] = 0n;
    
    // Knight moves
    const knightOffsets = [
      T.NORTH + T.NORTH + T.WEST,
      T.NORTH + T.NORTH + T.EAST,
      T.SOUTH + T.SOUTH + T.WEST,
      T.SOUTH + T.SOUTH + T.EAST,
      T.WEST + T.WEST + T.NORTH,
      T.WEST + T.WEST + T.SOUTH,
      T.EAST + T.EAST + T.NORTH,
      T.EAST + T.EAST + T.SOUTH
    ];
    
    for (let offset of knightOffsets) {
      let to = sq + offset;
      if (T.is_ok(to) && SquareDistance[sq][to] === 2) {
        KnightAttacks[sq] |= (1n << BigInt(to));
        // KnightToAttacks is the opposite - squares that can attack this square with knight
        KnightToAttacks[to] |= (1n << BigInt(sq));
      }
    }
    
    // Bishop (elephant) moves
    const bishopOffsets = [
      T.NORTH_EAST + T.NORTH_EAST,
      T.NORTH_WEST + T.NORTH_WEST,
      T.SOUTH_EAST + T.SOUTH_EAST,
      T.SOUTH_WEST + T.SOUTH_WEST
    ];
    
    for (let offset of bishopOffsets) {
      let to = sq + offset;
      if (T.is_ok(to)) {
        // Check if in own half
        let tr = T.rank_of(to);
        let halfOk = (tr <= T.RANK_4) || (tr >= T.RANK_5);
        if (halfOk) {
          BishopAttacks[sq] |= (1n << BigInt(to));
        }
      }
    }
  }
}

function attacks_bb_sliding(sq, occupied, dirs) {
  let attacks = 0n;
  for (let d of dirs) {
    let s = sq + d;
    while (T.is_ok(s)) {
      attacks |= (1n << BigInt(s));
      if (occupied & (1n << BigInt(s))) break;
      s += d;
    }
  }
  return attacks;
}

function attacks_bb_rook(sq, occupied) {
  return attacks_bb_sliding(sq, occupied, [T.NORTH, T.SOUTH, T.EAST, T.WEST]);
}

function attacks_bb_cannon(sq, occupied) {
  let attacks = 0n;
  const dirs = [T.NORTH, T.SOUTH, T.EAST, T.WEST];
  
  for (let d of dirs) {
    let s = sq + d;
    let jumped = false;
    while (T.is_ok(s)) {
      if (!jumped) {
        if (occupied & (1n << BigInt(s))) {
          jumped = true;
        }
      } else {
        if (occupied & (1n << BigInt(s))) {
          attacks |= (1n << BigInt(s));
          break;
        }
      }
      s += d;
    }
  }
  return attacks;
}

function attacks_bb(pt, sq, occupied) {
  switch (pt) {
    case T.ROOK: return attacks_bb_rook(sq, occupied);
    case T.CANNON: return attacks_bb_cannon(sq, occupied);
    case T.BISHOP: return BishopAttacks[sq];
    case T.KNIGHT: return KnightAttacks[sq];
    default: return 0n;
  }
}

// Initialize everything
function init() {
  init_attacks();
  // Setup pawn attacks
  for (let c = 0; c < T.COLOR_NB; c++) {
    for (let sq = 0; sq < T.SQUARE_NB; sq++) {
      PawnAttacks[c][sq] = pawn_attacks_bb(c, sq);
      PawnAttacksTo[c][sq] = pawn_attacks_to_bb(c, sq);
    }
  }
}

function pretty(b) {
  let s = "+---+---+---+---+---+---+---+---+---+\n";
  for (let r = T.RANK_9; r >= T.RANK_0; r--) {
    for (let f = T.FILE_A; f <= T.FILE_I; f++) {
      let sq = T.make_square(f, r);
      s += (b & (1n << BigInt(sq))) ? "| X " : "|   ";
    }
    s += "| " + r + "\n+---+---+---+---+---+---+---+---+---+\n";
  }
  s += "  a   b   c   d   e   f   g   h   i\n";
  return s;
}

module.exports = {
  Bitboard,
  Palace,
  FileABB, FileBBB, FileCBB, FileDBB, FileEBB, FileFBB, FileGBB, FileHBB, FileIBB,
  Rank0BB, Rank1BB, Rank2BB, Rank3BB, Rank4BB,
  Rank5BB, Rank6BB, Rank7BB, Rank8BB, Rank9BB,
  HalfBB, PawnBB,
  PopCnt16, SquareDistance,
  SquareBB, LineBB, BetweenBB,
  PseudoAttacks, PawnAttacks, PawnAttacksTo,
  square_bb, rank_bb, file_bb,
  more_than_one, shift,
  pawn_attacks_bb, pawn_attacks_to_bb,
  line_bb, between_bb, aligned, distance,
  popcount, lsb, least_significant_square_bb, pop_lsb,
  attacks_bb, attacks_bb_rook, attacks_bb_cannon,
  KnightAttacks, BishopAttacks,
  init, pretty
};
