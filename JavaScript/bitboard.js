/*
 * bitboard.js - Bitboard utilities and pre-computed attack tables.
 * Ported from Pikafish (https://github.com/official-pikafish/Pikafish)
 *
 * Layout:
 *   - The board is 9 files x 10 ranks. Square index = file + rank * 9 (0..89).
 *   - We use BigInt to store up to 90 bits per bitboard. Square s corresponds
 *     to bit (1n << BigInt(s)).
 *   - Pre-computed attack tables for every piece on every square, used by
 *     move generation and check detection.
 */
"use strict";

var ONE  = 1n;
var ZERO = 0n;
var ALL90 = (ONE << 90n) - 1n;        // all 90 squares
var FILE_A = 0x1C0000001C0000001C0n;  // 10 bits set on file 0 -- recomputed below
// Above placeholder, computed programmatically:

// Helpers operating on BigInt bitboards ------------------------------
function BB(sq)        { return ONE << BigInt(sq); }
function bb_or(a, b)   { return a | b; }
function bb_and(a, b)  { return a & b; }
function bb_xor(a, b)  { return a ^ b; }
function bb_sub(a, b)  { return a & ~b; }
function bb_test(b, sq) { return ((b >> BigInt(sq)) & 1n) !== 0n; }
function bb_set(b, sq)  { return b | (ONE << BigInt(sq)); }
function bb_clr(b, sq)  { return b & ~(ONE << BigInt(sq)); }
function bb_empty(b)    { return b === 0n; }

// popcount: BigInt -> Number
function popcount(b) {
  var s = b.toString(16);
  var c = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i) - 48;
    if (ch > 9) ch -= 39;
    if (ch & 1) c++;       if (ch & 2) c++;    if (ch & 4) c++;   if (ch & 8) c++;
  }
  return c;
}

// Iterate over set bits; calls cb(sq) for each square index 0..89
function for_each(b, cb) {
  while (b !== 0n) {
    var sq = Number(b & -b).toString(2).length - 1;  // wrong, see below
    // We want trailing-zero count for BigInt. Use a loop:
    var s = 0;
    var t = b & -b;   // BigInt lowest set bit
    // Count trailing zeros:
    var n = 0;
    while ((t & 1n) === 0n) { t >>= 1n; n++; }
    cb(n);
    b ^= (ONE << BigInt(n));
  }
}

// Simpler: BigInt -> Number for trailing-zero count (square index)
function bb_lsb(b) {
  if (b === 0n) return -1;
  var t = b & -b;
  var n = 0;
  while ((t & 1n) === 0n) { t >>= 1n; n++; }
  return n;
}

// Pop the least-significant set bit and return its square
function bb_poplsb(arr) { // arr = [bb] modified in place
  if (arr[0] === 0n) return -1;
  var t = arr[0] & -arr[0];
  var n = 0;
  while ((t & 1n) === 0n) { t >>= 1n; n++; }
  arr[0] ^= (ONE << BigInt(n));
  return n;
}

// Re-define for_each using bb_lsb (cleaner)
function forEachBit(b, cb) {
  var t = b;
  while (t !== 0n) {
    var s = bb_lsb(t);
    cb(s);
    t &= t - 1n;
  }
}

// File and rank masks
function file_mask(f) {
  var b = 0n;
  for (var r = 0; r < 10; r++) b |= ONE << BigInt(f + r * 9);
  return b;
}
function rank_mask(r) {
  var b = 0n;
  for (var f = 0; f < 9; f++) b |= ONE << BigInt(f + r * 9);
  return b;
}
var FILE_MASK = [];
for (var ff = 0; ff < 9; ff++) FILE_MASK.push(file_mask(ff));
var RANK_MASK = [];
for (var rr = 0; rr < 10; rr++) RANK_MASK.push(rank_mask(rr));

// Palace masks (3x3)
function make_palace(r0) {
  var b = 0n;
  for (var df = 0; df < 3; df++)
    for (var dr = 0; dr < 3; dr++)
      b |= ONE << BigInt(3 + df + (r0 + dr) * 9);
  return b;
}
var PALACE_RED   = make_palace(0);
var PALACE_BLACK = make_palace(7);
function palace_of(c) { return c === RED ? PALACE_RED : PALACE_BLACK; }

// Pre-computed attack tables.
// Index = square. Value = BigInt bitboard of squares attacked (assuming no blockers
// for sliding pieces; non-sliding piece attacks are pre-resolved).
var KING_ATT  = new Array(90);
var ADVISOR_ATT = new Array(90);
var BISHOP_ATT = new Array(90);
var KNIGHT_ATT = new Array(90);
var PAWN_ATT_RED  = new Array(90);
var PAWN_ATT_BLACK= new Array(90);

// Sliding attacks computed on the fly using a generic ray function.
function ray(sq, delta, blockers) {
  var b = 0n;
  var s = sq + delta;
  while (s >= 0 && s < 90) {
    // Make sure we don't wrap around the file
    var fs = file_of(sq);
    var fd = file_of(s);
    if (delta === +1 || delta === -1) {
      // horizontal: file must be increasing/decreasing by 1 each step
      if (Math.abs(fd - fs) !== 1) break;
    } else {
      // vertical or diagonal: if delta = ±1, must be on same file;
      // otherwise file should be consistent
      var step_file = fd - fs;
      if (delta === +9 || delta === -9) {
        if (step_file !== 0) break;
      } else {
        if (Math.abs(step_file) > 1) break;
      }
    }
    b |= ONE << BigInt(s);
    if (((blockers >> BigInt(s)) & 1n) !== 0n) break;
    sq = s;
    s = sq + delta;
  }
  return b;
}

// Simpler and more correct: hand-coded sliders using file/rank checks
function rook_attacks(sq, occ) {
  var b = 0n;
  var f0 = file_of(sq), r0 = rank_of(sq);
  // north
  for (var r = r0 - 1; r >= 0; r--) {
    var s = f0 + r * 9;
    b |= ONE << BigInt(s);
    if (((occ >> BigInt(s)) & 1n) !== 0n) break;
  }
  // south
  for (var r = r0 + 1; r < 10; r++) {
    var s = f0 + r * 9;
    b |= ONE << BigInt(s);
    if (((occ >> BigInt(s)) & 1n) !== 0n) break;
  }
  // west
  for (var f = f0 - 1; f >= 0; f--) {
    var s = f + r0 * 9;
    b |= ONE << BigInt(s);
    if (((occ >> BigInt(s)) & 1n) !== 0n) break;
  }
  // east
  for (var f = f0 + 1; f < 9; f++) {
    var s = f + r0 * 9;
    b |= ONE << BigInt(s);
    if (((occ >> BigInt(s)) & 1n) !== 0n) break;
  }
  return b;
}

function cannon_attacks(sq, occ) {
  var b = 0n;
  var f0 = file_of(sq), r0 = rank_of(sq);
  // north
  var jumped = false;
  for (var r = r0 - 1; r >= 0; r--) {
    var s = f0 + r * 9;
    var occ_here = ((occ >> BigInt(s)) & 1n) !== 0n;
    if (!jumped) {
      if (!occ_here) b |= ONE << BigInt(s);
      else jumped = true;
    } else {
      if (occ_here) { b |= ONE << BigInt(s); break; }
    }
  }
  // south
  jumped = false;
  for (var r = r0 + 1; r < 10; r++) {
    var s = f0 + r * 9;
    var occ_here = ((occ >> BigInt(s)) & 1n) !== 0n;
    if (!jumped) {
      if (!occ_here) b |= ONE << BigInt(s);
      else jumped = true;
    } else {
      if (occ_here) { b |= ONE << BigInt(s); break; }
    }
  }
  // west
  jumped = false;
  for (var f = f0 - 1; f >= 0; f--) {
    var s = f + r0 * 9;
    var occ_here = ((occ >> BigInt(s)) & 1n) !== 0n;
    if (!jumped) {
      if (!occ_here) b |= ONE << BigInt(s);
      else jumped = true;
    } else {
      if (occ_here) { b |= ONE << BigInt(s); break; }
    }
  }
  // east
  jumped = false;
  for (var f = f0 + 1; f < 9; f++) {
    var s = f + r0 * 9;
    var occ_here = ((occ >> BigInt(s)) & 1n) !== 0n;
    if (!jumped) {
      if (!occ_here) b |= ONE << BigInt(s);
      else jumped = true;
    } else {
      if (occ_here) { b |= ONE << BigInt(s); break; }
    }
  }
  return b;
}

function init_bitboards() {
  for (var sq = 0; sq < 90; sq++) {
    var f = file_of(sq), r = rank_of(sq);

    // KING
    var k = 0n;
    for (var d = 0; d < 4; d++) {
      var t = sq + KING_DELTA[d];
      if (t < 0 || t >= 90) continue;
      if (Math.abs(file_of(t) - f) > 1) continue;
      k |= ONE << BigInt(t);
    }
    KING_ATT[sq] = k;

    // ADVISOR
    var a = 0n;
    for (var d = 0; d < 4; d++) {
      var t = sq + ADVISOR_DELTA[d];
      if (t < 0 || t >= 90) continue;
      if (Math.abs(file_of(t) - f) !== 1) continue;
      a |= ONE << BigInt(t);
    }
    ADVISOR_ATT[sq] = a;

    // BISHOP (only attacks within its own half)
    var bb = 0n;
    for (var d = 0; d < 4; d++) {
      var t = sq + BISHOP_TARGETS[d];
      var mid = sq + BISHOP_BLOCKS[d];
      if (t < 0 || t >= 90) continue;
      if (Math.abs(file_of(t) - f) !== 2) continue;
      bb |= ONE << BigInt(t);
    }
    BISHOP_ATT[sq] = bb;

    // KNIGHT
    var kn = 0n;
    for (var g = 0; g < 4; g++) {
      var blockSq = sq + KNIGHT_BLOCK_DELTAS[g];
      if (blockSq < 0 || blockSq >= 90) continue;
      // Make sure we stay on the board
      if (Math.abs(file_of(blockSq) - f) > 1) continue;
      for (var k2 = 0; k2 < 2; k2++) {
        var t = sq + KNIGHT_TARGETS[g][k2];
        if (t < 0 || t >= 90) continue;
        if (Math.abs(file_of(t) - f) > 2) continue;
        if (Math.abs(rank_of(t) - r) > 2) continue;
        kn |= ONE << BigInt(t);
      }
    }
    KNIGHT_ATT[sq] = kn;

    // PAWN
    var pr = 0n, pb = 0n;
    // Red pawns move forward (north = -9) once they've crossed the river (rank <= 4)
    // Black pawns move forward (south = +9) once they've crossed the river (rank >= 5)
    if (r <= 4) {
      // Red pawn: forward
      if (r > 0) pr |= ONE << BigInt(sq - 9);
      // side moves after crossing
      if (r < 5) {
        if (f > 0) pr |= ONE << BigInt(sq - 1);
        if (f < 8) pr |= ONE << BigInt(sq + 1);
      }
    }
    if (r >= 5) {
      // Black pawn: forward (south)
      if (r < 9) pb |= ONE << BigInt(sq + 9);
      if (f > 0) pb |= ONE << BigInt(sq - 1);
      if (f < 8) pb |= ONE << BigInt(sq + 1);
    }
    PAWN_ATT_RED[sq]   = pr;
    PAWN_ATT_BLACK[sq] = pb;
  }
}
init_bitboards();

// Attack-from-piece helper used by Position.attackers()
function piece_attacks(pt, sq, occ) {
  switch (pt) {
    case KING:    return KING_ATT[sq];
    case ADVISOR: return ADVISOR_ATT[sq];
    case BISHOP:  return BISHOP_ATT[sq];
    case KNIGHT:  return KNIGHT_ATT[sq];
    case ROOK:    return rook_attacks(sq, occ);
    case CANNON:  return cannon_attacks(sq, occ);
    case PAWN:    { /* attacker color is determined by caller */ return 0n; }
  }
  return 0n;
}

function pawn_attacks_for_color(sq, c) {
  return c === RED ? PAWN_ATT_RED[sq] : PAWN_ATT_BLACK[sq];
}
