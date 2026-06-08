/*
 * nnue.js - Simplified NNUE-style evaluation.
 * Inspired by Pikafish / Stockfish NNUE.
 *
 * A full NNUE inference engine requires the trained network weights
 * (typically 2 (HalfKP) -> hidden -> 1).  To keep this port self-contained
 * we approximate the network with a hand-tuned feature model: each piece
 * on each square contributes a weight taken from a piece-square table.
 * The hidden layer is a single "phase-aware" sum, and the output is a
 * single sigmoid-mapped score in centipawns.
 *
 * Phase (mg / eg) is determined by total non-pawn material.
 */
"use strict";

// Piece-square tables (Pikafish-inspired, *centipawns* per piece).
// Each table is indexed by piece type (0..6) and square (0..89).
// Tables are tuned from "red at bottom" perspective; for black pieces we
// mirror vertically (rank r -> 9 - r) before lookup.

var PST = [
  // KING
  [
    -10,-10,-10,-10,-10,-10,-10,-10,-10,
    -10,-10,-10,-10,-10,-10,-10,-10,-10,
     -5, -5, -5, -5, -5, -5, -5, -5, -5,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      0,  0,  0,  0,  0,  0,  0,  0,  0,
      5,  5,  5,  5,  5,  5,  5,  5,  5,
     10, 10, 10, 10, 10, 10, 10, 10, 10,
     10, 10, 10, 10, 10, 10, 10, 10, 10,
     10, 10, 10, 10, 10, 10, 10, 10, 10
  ],
  // ADVISOR
  [
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,2,4,2,0,0,0,
    0,0,0,4,0,4,0,0,0,
    0,0,0,2,4,2,0,0,0,
    0,0,0,0,0,0,0,0,0
  ],
  // BISHOP
  [
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,2,0,0,0,2,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,
    0,0,2,0,0,0,2,0,0,
    0,0,0,0,0,0,0,0,0
  ],
  // KNIGHT
  [
    -5, -4, -3, -3, -3, -3, -3, -4, -5,
    -4, -2,  0,  0,  0,  0,  0, -2, -4,
    -3,  0,  1,  2,  2,  2,  1,  0, -3,
    -3,  1,  2,  3,  3,  3,  2,  1, -3,
    -3,  0,  2,  4,  4,  4,  2,  0, -3,
    -3,  1,  3,  4,  5,  4,  3,  1, -3,
    -3,  1,  3,  4,  5,  4,  3,  1, -3,
    -3,  0,  2,  4,  4,  4,  2,  0, -3,
    -4, -2,  0,  1,  1,  1,  0, -2, -4,
    -5, -4, -3, -3, -3, -3, -3, -4, -5
  ],
  // ROOK
  [
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     1,  1,  1,  2,  2,  2,  1,  1,  1,
     2,  2,  2,  3,  3,  3,  2,  2,  2,
     2,  2,  2,  3,  3,  3,  2,  2,  2,
     1,  1,  1,  2,  2,  2,  1,  1,  1,
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     0,  0,  0,  1,  1,  1,  0,  0,  0
  ],
  // CANNON
  [
     1,  1,  2,  3,  3,  3,  2,  1,  1,
     1,  2,  3,  4,  4,  4,  3,  2,  1,
     2,  3,  4,  5,  5,  5,  4,  3,  2,
     2,  3,  5,  6,  6,  6,  5,  3,  2,
     3,  5,  6,  7,  7,  7,  6,  5,  3,
     3,  5,  6,  7,  7,  7,  6,  5,  3,
     2,  3,  5,  6,  6,  6,  5,  3,  2,
     2,  3,  4,  5,  5,  5,  4,  3,  2,
     1,  2,  3,  4,  4,  4,  3,  2,  1,
     1,  1,  2,  3,  3,  3,  2,  1,  1
  ],
  // PAWN
  [
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     8, 10, 12, 14, 16, 14, 12, 10,  8,
    16, 20, 22, 24, 26, 24, 22, 20, 16,
    18, 22, 24, 26, 28, 26, 24, 22, 18,
    18, 22, 24, 26, 28, 26, 24, 22, 18,
    18, 22, 24, 26, 28, 26, 24, 22, 18,
    18, 22, 24, 26, 28, 26, 24, 22, 18
  ],
];

// Mobility: extra bonus for the number of squares a sliding piece attacks.
function mobility_bonus(pc, sqCount) {
  if (pc === ROOK)   return sqCount * 2;
  if (pc === CANNON) return sqCount * 1;
  if (pc === KNIGHT) return sqCount * 1;
  return 0;
}

// Phase weight (used for tapered evaluation). Sum of (piece_value) for
// all pieces on the board, normalised to [0..1].
var PHASE_INC = [0, 1, 1, 4, 9, 9, 2, 0];
function phase_of(pos) {
  var p = 0;
  for (var s = 0; s < 90; s++) {
    var pc = pos.pieceOn[s];
    if (pc) p += PHASE_INC[type_of(pc)];
  }
  // Max possible phase ~ 2*(9+9+4) + 2*(9+9+4) + 2*(2*2) + 2*(2*1) ~= 56
  return Math.min(1, p / 24);
}

function evaluate(pos) {
  // Material + PST, side-relative. Positive means good for side to move.
  var mgScore = 0;
  var egScore = 0;
  var phase = phase_of(pos);
  for (var s = 0; s < 90; s++) {
    var pc = pos.pieceOn[s];
    if (!pc) continue;
    var t = type_of(pc);
    var c = color_of(pc);
    var pstSq = (c === RED) ? s : sq_mirror(s);
    var v = PST[t][pstSq];
    // mg/eg: pawn value scales with phase (in EG pawns are worth more)
    if (t === PAWN) {
      egScore += (c === RED ? +1 : -1) * (PIECE_TYPE_VALUE[t] + v);
    } else {
      mgScore += (c === RED ? +1 : -1) * (PIECE_TYPE_VALUE[t] + v);
    }
  }

  // Mobility: rook/cannon/knight
  for (var c2 = 0; c2 < 2; c2++) {
    var our = pos.byColorBB[c2];
    var occ = pos.occupied_bb();
    var tt = our;
    while (tt !== 0n) {
      var sq = bb_lsb(tt);
      tt &= tt - 1n;
      var pc = pos.pieceOn[sq];
      var t2 = type_of(pc);
      var att = 0n;
      if (t2 === ROOK) att = rook_attacks(sq, occ) & ~pos.byColorBB[c2];
      else if (t2 === CANNON) att = (cannon_attacks(sq, occ) & ~occ) | (cannon_attacks(sq, occ) & pos.byColorBB[1 - c2] & ~rook_attacks(sq, occ));
      else if (t2 === KNIGHT) att = KNIGHT_ATT[sq] & ~pos.byColorBB[c2];
      else continue;
      var cnt = popcount(att);
      mgScore += (c2 === pos.sideToMove ? +1 : -1) * mobility_bonus(t2, cnt);
    }
  }

  var score = Math.round(mgScore * phase + egScore * (1 - phase));
  if (pos.sideToMove === BLACK) score = -score;
  return score;
}

// Mirror a square: file f -> 8-f, rank r -> 9-r.
function sq_mirror(sq) {
  return (8 - file_of(sq)) + (9 - rank_of(sq)) * 9;
}
