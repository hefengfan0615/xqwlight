/*
 * Pikafish Chinese Chess Engine - Bitboard & Attack Tables
 * Converted from Stockfish/Pikafish C++ bitboard.h/cpp
 *
 * Board: 10 ranks x 9 files = 90 squares
 * Bitboard: BigInt, bit index = rank * 9 + file
 */

import {
  SQUARE_NB, FILE_NB, RANK_NB,
  NORTH, SOUTH, EAST, WEST,
  NORTH_EAST, SOUTH_EAST, SOUTH_WEST, NORTH_WEST,
  WHITE, BLACK,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING,
  colorOf, typeOf, makePiece, fileOf, rankOf, makeSquare, isOkSquare,
  SQ_A0, SQ_I0, SQ_A9, SQ_I9, SQ_NONE,
  PIECE_TYPE_NB, PIECE_NB, COLOR_NB
} from './pikafish_types.js';

// === Bitboard utilities (BigInt-based, 128-bit) ===

export function bbSet(bb, sq) { return bb | (1n << BigInt(sq)); }
export function bbClr(bb, sq) { return bb & ~(1n << BigInt(sq)); }
export function bbTest(bb, sq) { return (bb >> BigInt(sq)) & 1n; }
export function bbEmpty(bb) { return bb === 0n; }

// Count bits in a BigInt bitboard
export function popcount(bb) {
  let n = bb;
  n = n - ((n >> 1n) & 0x5555555555555555555555555n);
  n = (n & 0x3333333333333333333333333n) + ((n >> 2n) & 0x3333333333333333333333333n);
  n = (n + (n >> 4n)) & 0x0F0F0F0F0F0F0F0F0F0F0F0Fn;
  return Number((n * 0x010101010101010101010101n) >> 120n);
}

// Get least significant bit index
export function lsb(bb) {
  if (bb === 0n) return SQ_NONE;
  let sq = 0;
  while ((bb & 1n) === 0n) { bb >>= 1n; sq++; }
  return sq;
}

// Pop LSB and return square index
export function popLsb(bbRef) {
  const bit = bbRef.bb & -bbRef.bb;
  const sq = bit === 0n ? SQ_NONE : lsb(bit);
  bbRef.bb ^= bit;
  return sq;
}

/**
 * Create a ref wrapper so popLsb can mutate
 */
export function bbRef(bb) {
  return { bb };
}

// Shift operations
export function bbShift(bb, dir) {
  if (dir > 0) return bb << BigInt(dir);
  return bb >> BigInt(-dir);
}

// Square distance
export function squareDistance(s1, s2) {
  return Math.max(Math.abs(fileOf(s1) - fileOf(s2)),
                  Math.abs(rankOf(s1) - rankOf(s2)));
}

// Edge distance
export function edgeDistance(s) {
  return Math.min(fileOf(s), Math.min(rankOf(s), Math.min(FILE_NB - 1 - fileOf(s), RANK_NB - 1 - rankOf(s))));
}

// File distance
export function fileDistance(s1, s2) {
  return Math.abs(fileOf(s1) - fileOf(s2));
}

// Rank distance
export function rankDistance(s1, s2) {
  return Math.abs(rankOf(s1) - rankOf(s2));
}

// Check if squares are aligned
export function aligned(s1, s2, s3) {
  return (fileOf(s1) === fileOf(s2) && fileOf(s2) === fileOf(s3)) ||
         (rankOf(s1) === rankOf(s2) && rankOf(s2) === rankOf(s3));
}

// === Pre-computed tables ===

// Square BB for each square
const SquareBB = new Array(SQUARE_NB);
for (let s = 0; s < SQUARE_NB; s++) {
  SquareBB[s] = 1n << BigInt(s);
}

export { SquareBB };

// Between squares
const BetweenBB = [];
const LineBB = [];

function initBetweenAndLine() {
  for (let s1 = 0; s1 < SQUARE_NB; s1++) {
    BetweenBB[s1] = [];
    LineBB[s1] = [];
    for (let s2 = 0; s2 < SQUARE_NB; s2++) {
      BetweenBB[s1][s2] = 0n;
      LineBB[s1][s2] = 0n;
    }
  }

  const dirs = [NORTH, SOUTH, EAST, WEST, NORTH_EAST, NORTH_WEST, SOUTH_EAST, SOUTH_WEST];
  for (let s1 = 0; s1 < SQUARE_NB; s1++) {
    const f1 = fileOf(s1), r1 = rankOf(s1);
    for (const dir of dirs) {
      let bb = 0n;
      for (let s = s1 + dir; isOkSquare(s) && squareDistance(s, s - dir) <= 2; s += dir) {
        bb = bbSet(bb, s);
      }
      // For each s2 in the same line, record between squares
      for (let s2 = s1 + dir, step = 1; isOkSquare(s2); s2 += dir, step++) {
        LineBB[s1][s2] = bb;
        if (step > 1) {
          let between = 0n;
          for (let s = s1 + dir; s !== s2; s += dir) {
            between = bbSet(between, s);
          }
          BetweenBB[s1][s2] = between;
        }
      }
    }
  }
}

// Pseudo-attacks for each piece type
// [pieceType][square] = bitboard of pseudo-legal moves on empty board
const PseudoAttacks = [];
for (let pt = 0; pt < PIECE_TYPE_NB; pt++) {
  PseudoAttacks[pt] = new Array(SQUARE_NB);
  for (let s = 0; s < SQUARE_NB; s++) {
    PseudoAttacks[pt][s] = 0n;
  }
}

// Knight leg squares (blocking squares)
const KnightLeg = new Array(SQUARE_NB);
for (let s = 0; s < SQUARE_NB; s++) KnightLeg[s] = [];

// Direction-based sliding attacks
function slidingAttack(s, occupied, deltas) {
  let att = 0n;
  for (const d of deltas) {
    for (let sq = s + d; isOkSquare(sq); sq += d) {
      // Check board boundary (no wrapping from i-file to a-file)
      if ((d === EAST || d === WEST) && rankOf(sq) !== rankOf(sq - d)) break;
      att = bbSet(att, sq);
      if ((occupied >> BigInt(sq)) & 1n) break;
    }
  }
  return att;
}

function initPseudoAttacks() {
  // ---- Rook (车) ----
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    // Horizontal
    for (let ff = 0; ff < FILE_NB; ff++) {
      if (ff !== f) att = bbSet(att, makeSquare(ff, r));
    }
    // Vertical
    for (let rr = 0; rr < RANK_NB; rr++) {
      if (rr !== r) att = bbSet(att, makeSquare(f, rr));
    }
    PseudoAttacks[ROOK][s] = att;
  }

  // ---- Cannon (炮) ----
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    for (let ff = 0; ff < FILE_NB; ff++)
      if (ff !== f) att = bbSet(att, makeSquare(ff, r));
    for (let rr = 0; rr < RANK_NB; rr++)
      if (rr !== r) att = bbSet(att, makeSquare(f, rr));
    PseudoAttacks[CANNON][s] = att;
  }

  // ---- Knight (马) ----
  const knightDirs = [
    [-2, -1, WEST], [-1, -2, SOUTH], [1, -2, SOUTH], [2, -1, EAST],
    [2, 1, EAST], [1, 2, NORTH], [-1, 2, NORTH], [-2, 1, WEST]
  ];
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    const legs = [];
    for (const [df, dr, legDir] of knightDirs) {
      const ff = f + df, rr = r + dr;
      if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
        const to = makeSquare(ff, rr);
        att = bbSet(att, to);
        // Leg square
        const legSq = s + legDir;
        legs.push({ to, leg: legSq });
      }
    }
    PseudoAttacks[KNIGHT][s] = att;
    KnightLeg[s] = legs;
  }

  // ---- Bishop (象/相) ----
  const bishopDirs = [
    [-2, -2], [2, -2], [2, 2], [-2, 2]
  ];
  const bishopLegDirs = [NORTH_WEST, NORTH_EAST, SOUTH_EAST, SOUTH_WEST];
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    for (let i = 0; i < 4; i++) {
      const [df, dr] = bishopDirs[i];
      const ff = f + df, rr = r + dr;
      if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
        att = bbSet(att, makeSquare(ff, rr));
      }
    }
    PseudoAttacks[BISHOP][s] = att;
  }

  // ---- Advisor (士/仕) ----
  const advisorDirs = [NORTH_WEST, NORTH_EAST, SOUTH_EAST, SOUTH_WEST];
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    for (const d of advisorDirs) {
      const ff = f + (d === NORTH_WEST || d === SOUTH_WEST ? -1 : 1);
      const rr = r + (d === NORTH_WEST || d === NORTH_EAST ? 1 : -1);
      if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
        att = bbSet(att, makeSquare(ff, rr));
      }
    }
    PseudoAttacks[ADVISOR][s] = att;
  }

  // ---- King (将/帅) ----
  const kingDirs = [NORTH, SOUTH, EAST, WEST];
  for (let s = 0; s < SQUARE_NB; s++) {
    const f = fileOf(s), r = rankOf(s);
    let att = 0n;
    for (const d of kingDirs) {
      const sq = s + d;
      if (isOkSquare(sq) && squareDistance(s, sq) <= 1) {
        att = bbSet(att, sq);
      }
    }
    PseudoAttacks[KING][s] = att;
  }
}

// Palace squares for each color
// White palace: ranks 7-9, files 3-5 (d7-f9)
// Black palace: ranks 0-2, files 3-5 (d0-f2)
const PalaceBB = [
  // White (ranks 0-2, files 3-5)
  (() => {
    let bb = 0n;
    for (let r = 0; r <= 2; r++)
      for (let f = 3; f <= 5; f++)
        bb = bbSet(bb, makeSquare(f, r));
    return bb;
  })(),
  // Black (ranks 7-9, files 3-5)
  (() => {
    let bb = 0n;
    for (let r = 7; r <= 9; r++)
      for (let f = 3; f <= 5; f++)
        bb = bbSet(bb, makeSquare(f, r));
    return bb;
  })()
];

export { PalaceBB };

function inPalace(s, c) {
  const f = fileOf(s), r = rankOf(s);
  if (c === WHITE) return f >= 3 && f <= 5 && r >= 0 && r <= 2;
  return f >= 3 && f <= 5 && r >= 7 && r <= 9;
}

function ownHalf(s, c) {
  const r = rankOf(s);
  if (c === WHITE) return r <= 4;
  return r >= 5;
}

export { inPalace, ownHalf };

// Initialize tables
initBetweenAndLine();
initPseudoAttacks();

// === Attack functions ===

/**
 * Rook attacks: sliding along ranks and files
 */
export function rookAttacks(s, occupied) {
  return slidingAttack(s, occupied, [NORTH, SOUTH, EAST, WEST]);
}

/**
 * Cannon attacks:
 * - Non-capture: like rook (slide until blocked)
 * - Capture: slide until finding a mount, then attack first piece behind it
 */
export function cannonAttacks(s, occupied, targetBB) {
  let att = 0n;

  for (const d of [NORTH, SOUTH, EAST, WEST]) {
    let mount = false;
    for (let sq = s + d; isOkSquare(sq); sq += d) {
      // Check board boundary (no wrapping from i-file to a-file)
      if ((d === EAST || d === WEST) && rankOf(sq) !== rankOf(sq - d)) break;
      if ((occupied >> BigInt(sq)) & 1n) {
        if (!mount) {
          mount = true;
        } else {
          // Capture this piece (it's behind the mount)
          att = bbSet(att, sq);
          break;
        }
      } else if (!mount) {
        // Non-capture move (can move to empty squares)
        att = bbSet(att, sq);
      }
    }
  }

  return att;
}

/**
 * Cannon attacks simplified (just the capture targets given occupied)
 */
export function cannonCaptureAttacks(s, occupied) {
  return cannonAttacks(s, occupied, 0n);
}

/**
 * Knight attacks considering leg blocks
 */
export function knightAttacks(s, occupied) {
  let att = 0n;
  const legs = KnightLeg[s];
  for (const { to, leg } of legs) {
    if (!((occupied >> BigInt(leg)) & 1n)) {
      att = bbSet(att, to);
    }
  }
  return att;
}

/**
 * Bishop (Elephant) attacks considering leg blocks
 * Bishops cannot cross the river
 */
export function bishopAttacks(s, occupied, c) {
  let att = 0n;
  const f = fileOf(s), r = rankOf(s);
  const dirs = [
    { df: -2, dr: 2, legDir: NORTH_WEST, legDf: -1, legDr: 1 },
    { df: 2, dr: 2, legDir: NORTH_EAST, legDf: 1, legDr: 1 },
    { df: 2, dr: -2, legDir: SOUTH_EAST, legDf: 1, legDr: -1 },
    { df: -2, dr: -2, legDir: SOUTH_WEST, legDf: -1, legDr: -1 }
  ];
  for (const { df, dr, legDf, legDr } of dirs) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
      // Must stay in own half
      if (!ownHalf(makeSquare(ff, rr), c)) continue;
      const legSq = makeSquare(f + legDf, r + legDr);
      if (!((occupied >> BigInt(legSq)) & 1n)) {
        att = bbSet(att, makeSquare(ff, rr));
      }
    }
  }
  return att;
}

/**
 * Advisor attacks (must stay in palace)
 */
export function advisorAttacks(s, c) {
  let att = 0n;
  const f = fileOf(s), r = rankOf(s);
  const dirs = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  for (const [df, dr] of dirs) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
      const sq = makeSquare(ff, rr);
      if (inPalace(sq, c)) {
        att = bbSet(att, sq);
      }
    }
  }
  return att;
}

/**
 * King attacks (must stay in palace)
 */
export function kingAttacks(s, c) {
  let att = 0n;
  const f = fileOf(s), r = rankOf(s);
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [df, dr] of dirs) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < FILE_NB && rr >= 0 && rr < RANK_NB) {
      const sq = makeSquare(ff, rr);
      if (inPalace(sq, c)) {
        att = bbSet(att, sq);
      }
    }
  }
  return att;
}

/**
 * Pawn attacks: forward before crossing river, forward+sideways after
 */
export function pawnAttacks(s, c) {
  let att = 0n;
  const r = rankOf(s);

  // Forward
  const push = c === WHITE ? NORTH : SOUTH;
  const fwd = s + push;
  if (isOkSquare(fwd)) {
    att = bbSet(att, fwd);
  }

  // After crossing river: can also move sideways
  const crossed = c === WHITE ? r >= 5 : r <= 4;
  if (crossed) {
    const left = s + WEST;
    if (isOkSquare(left) && fileDistance(s, left) === 1)
      att = bbSet(att, left);
    const right = s + EAST;
    if (isOkSquare(right) && fileDistance(s, right) === 1)
      att = bbSet(att, right);
  }

  return att;
}

/**
 * Get pseudo-legal attacks for a piece on a square
 */
export function attacksByPieceType(pt, s, c, occupied = 0n) {
  switch (pt) {
    case ROOK:    return rookAttacks(s, occupied);
    case CANNON:  return cannonAttacks(s, occupied);
    case KNIGHT:  return knightAttacks(s, occupied);
    case BISHOP:  return bishopAttacks(s, occupied, c);
    case ADVISOR: return advisorAttacks(s, c);
    case KING:    return kingAttacks(s, c);
    case PAWN:    return pawnAttacks(s, c);
    default:      return 0n;
  }
}

/**
 * Flying general check: check if two kings face each other on same file
 */
export function flyingGeneralCheck(kingSqW, kingSqB, occupied) {
  if (fileOf(kingSqW) !== fileOf(kingSqB)) return false;
  const f = fileOf(kingSqW);
  const rW = rankOf(kingSqW), rB = rankOf(kingSqB);
  const minR = Math.min(rW, rB), maxR = Math.max(rW, rB);
  for (let r = minR + 1; r < maxR; r++) {
    const sq = makeSquare(f, r);
    if ((occupied >> BigInt(sq)) & 1n) return false;
  }
  return true;
}

// === Board masks ===

export const FileBB = [
  0x40201008040201n,
  0x40201008040201n << 1n,
  0x40201008040201n << 2n,
  0x40201008040201n << 3n,
  0x40201008040201n << 4n,
  0x40201008040201n << 5n,
  0x40201008040201n << 6n,
  0x40201008040201n << 7n,
  0x40201008040201n << 8n,
];

function initFileBB() {
  for (let f = 0; f < FILE_NB; f++) {
    let bb = 0n;
    for (let r = 0; r < RANK_NB; r++)
      bb = bbSet(bb, makeSquare(f, r));
    FileBB[f] = bb;
  }
}
initFileBB();

export const RankBB = [];
function initRankBB() {
  for (let r = 0; r < RANK_NB; r++) {
    let bb = 0n;
    for (let f = 0; f < FILE_NB; f++)
      bb = bbSet(bb, makeSquare(f, r));
    RankBB[r] = bb;
  }
}
initRankBB();

export { BetweenBB, LineBB, PseudoAttacks, KnightLeg };