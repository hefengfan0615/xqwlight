"use strict";

// ============================================================
// Pikafish JS - Bitboard and Attack Tables
// ============================================================

const T = require('./types');

// King attacks (from each palace square)
const kingAttacks = new Array(T.SQUARE_NB).fill(0).map(() => []);
for (const sq of T.PALACE_WHITE) {
  if (T.file_of(sq) > T.FILE_A) kingAttacks[sq].push(sq + T.WEST);
  if (T.file_of(sq) < T.FILE_I) kingAttacks[sq].push(sq + T.EAST);
  if (T.rank_of(sq) > T.RANK_0) kingAttacks[sq].push(sq + T.SOUTH);
  if (T.rank_of(sq) < T.RANK_2) kingAttacks[sq].push(sq + T.NORTH);
}
for (const sq of T.PALACE_BLACK) {
  if (T.file_of(sq) > T.FILE_A) kingAttacks[sq].push(sq + T.WEST);
  if (T.file_of(sq) < T.FILE_I) kingAttacks[sq].push(sq + T.EAST);
  if (T.rank_of(sq) > T.RANK_7) kingAttacks[sq].push(sq + T.SOUTH);
  if (T.rank_of(sq) < T.RANK_9) kingAttacks[sq].push(sq + T.NORTH);
}

// Advisor attacks (diagonal within palace)
const advisorAttacks = new Array(T.SQUARE_NB).fill(0).map(() => []);
// White palace
advisorAttacks[T.SQ_D0].push(T.SQ_E1);
advisorAttacks[T.SQ_F0].push(T.SQ_E1);
advisorAttacks[T.SQ_E1].push(T.SQ_D0, T.SQ_F0, T.SQ_D2, T.SQ_F2);
advisorAttacks[T.SQ_D2].push(T.SQ_E1);
advisorAttacks[T.SQ_F2].push(T.SQ_E1);
// Black palace
advisorAttacks[T.SQ_D7].push(T.SQ_E8);
advisorAttacks[T.SQ_F7].push(T.SQ_E8);
advisorAttacks[T.SQ_E8].push(T.SQ_D7, T.SQ_F7, T.SQ_D9, T.SQ_F9);
advisorAttacks[T.SQ_D9].push(T.SQ_E8);
advisorAttacks[T.SQ_F9].push(T.SQ_E8);

// Bishop/Elephant attacks (diagonal 2 squares, can't cross river, can be blocked)
const bishopAttacks = new Array(T.SQUARE_NB).fill(0).map(() => []);
const bishopPins = new Array(T.SQUARE_NB).fill(0).map(() => []); // blocking squares

function addBishopMove(from, dx, dy, riverLimit) {
  const fx = T.file_of(from), fy = T.rank_of(from);
  const toX = fx + dx, toY = fy + dy;
  const pinX = fx + Math.sign(dx), pinY = fy + Math.sign(dy);
  if (toX >= T.FILE_A && toX <= T.FILE_I && toY >= T.RANK_0 && toY <= T.RANK_9) {
    if (dy > 0 && toY <= riverLimit || dy < 0 && toY >= riverLimit) {
      const to = T.make_square(toX, toY);
      const pin = T.make_square(pinX, pinY);
      bishopAttacks[from].push(to);
      bishopPins[from].push(pin);
    }
  }
}

// White bishop (ranks 0-4, river limit is rank 4)
for (let f = T.FILE_A; f <= T.FILE_I; f += 2) {
  for (let r = T.RANK_0; r <= T.RANK_4; r += 2) {
    const sq = T.make_square(f, r);
    addBishopMove(sq, 2, 2, T.RANK_4);
    addBishopMove(sq, 2, -2, T.RANK_4);
    addBishopMove(sq, -2, 2, T.RANK_4);
    addBishopMove(sq, -2, -2, T.RANK_4);
  }
}

// Black bishop (ranks 5-9, river limit is rank 5)
for (let f = T.FILE_A; f <= T.FILE_I; f += 2) {
  for (let r = T.RANK_5; r <= T.RANK_9; r += 2) {
    const sq = T.make_square(f, r);
    addBishopMove(sq, 2, 2, T.RANK_5);
    addBishopMove(sq, 2, -2, T.RANK_5);
    addBishopMove(sq, -2, 2, T.RANK_5);
    addBishopMove(sq, -2, -2, T.RANK_5);
  }
}

// Knight attacks (L-shape, can be blocked)
const knightAttacks = new Array(T.SQUARE_NB).fill(0).map(() => []);
const knightPins = new Array(T.SQUARE_NB).fill(0).map(() => []);

function addKnightMove(from, df, dr) {
  const fx = T.file_of(from), fy = T.rank_of(from);
  let pinSq;
  if (Math.abs(df) === 1) {
    const pinF = fx + Math.sign(df);
    const pinR = fy;
    pinSq = T.make_square(pinF, pinR);
  } else {
    const pinF = fx;
    const pinR = fy + Math.sign(dr);
    pinSq = T.make_square(pinF, pinR);
  }
  const toX = fx + df;
  const toY = fy + dr;
  if (toX >= T.FILE_A && toX <= T.FILE_I && toY >= T.RANK_0 && toY <= T.RANK_9) {
    const to = T.make_square(toX, toY);
    knightAttacks[from].push(to);
    knightPins[from].push(pinSq);
  }
}

for (let f = T.FILE_A; f <= T.FILE_I; f++) {
  for (let r = T.RANK_0; r <= T.RANK_9; r++) {
    const sq = T.make_square(f, r);
    addKnightMove(sq, 2, 1);
    addKnightMove(sq, 2, -1);
    addKnightMove(sq, -2, 1);
    addKnightMove(sq, -2, -1);
    addKnightMove(sq, 1, 2);
    addKnightMove(sq, 1, -2);
    addKnightMove(sq, -1, 2);
    addKnightMove(sq, -1, -2);
  }
}

// Pawn attacks
const pawnAttacksForward = new Array(T.SQUARE_NB);
const pawnCapturesWhite = new Array(T.SQUARE_NB).fill(0).map(() => []);
const pawnCapturesBlack = new Array(T.SQUARE_NB).fill(0).map(() => []);

// White pawns move NORTH (up in rank)
for (let f = T.FILE_A; f <= T.FILE_I; f++) {
  for (let r = T.RANK_0; r <= T.RANK_9; r++) {
    const sq = T.make_square(f, r);
    // Forward move
    if (r < T.RANK_9) {
      pawnAttacksForward[sq] = T.make_square(f, r + 1);
    } else {
      pawnAttacksForward[sq] = -1;
    }
    // Side captures (only after crossing river, i.e., rank >= 5)
    if (r >= T.RANK_5) {
      if (f > T.FILE_A) pawnCapturesWhite[sq].push(T.make_square(f - 1, r));
      if (f < T.FILE_I) pawnCapturesWhite[sq].push(T.make_square(f + 1, r));
    }
  }
}

// Black pawns move SOUTH (down in rank)
for (let f = T.FILE_A; f <= T.FILE_I; f++) {
  for (let r = T.RANK_0; r <= T.RANK_9; r++) {
    const sq = T.make_square(f, r);
    // Forward move
    if (r > T.RANK_0) {
      pawnAttacksForward[sq] = T.make_square(f, r - 1);
    } else {
      pawnAttacksForward[sq] = -1;
    }
    // Side captures (only after crossing river, i.e., rank <= 4)
    if (r <= T.RANK_4) {
      if (f > T.FILE_A) pawnCapturesBlack[sq].push(T.make_square(f - 1, r));
      if (f < T.FILE_I) pawnCapturesBlack[sq].push(T.make_square(f + 1, r));
    }
  }
}

// Line directions for sliding pieces (Rook, Cannon)
const lineDirs = [T.NORTH, T.SOUTH, T.EAST, T.WEST];

// Between squares (for line attacks)
function betweenSquares(sq1, sq2) {
  const squares = [];
  if (T.file_of(sq1) === T.file_of(sq2)) {
    const minR = Math.min(T.rank_of(sq1), T.rank_of(sq2));
    const maxR = Math.max(T.rank_of(sq1), T.rank_of(sq2));
    for (let r = minR + 1; r < maxR; r++) {
      squares.push(T.make_square(T.file_of(sq1), r));
    }
  } else if (T.rank_of(sq1) === T.rank_of(sq2)) {
    const minF = Math.min(T.file_of(sq1), T.file_of(sq2));
    const maxF = Math.max(T.file_of(sq1), T.file_of(sq2));
    for (let f = minF + 1; f < maxF; f++) {
      squares.push(T.make_square(f, T.rank_of(sq1)));
    }
  }
  return squares;
}

module.exports = {
  kingAttacks,
  advisorAttacks,
  bishopAttacks,
  bishopPins,
  knightAttacks,
  knightPins,
  pawnAttacksForward,
  pawnCapturesWhite,
  pawnCapturesBlack,
  betweenSquares,
  lineDirs
};
