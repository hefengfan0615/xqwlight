"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position, StateInfo } = require('./position.js');

console.log('=== Bitboard Debug ===\n');

// Initialize bitboards
B.init();
console.log('✅ Bitboards initialized');

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');

console.log('Checking board vs bitboard...\n');

// Manual check board
console.log('Board array:');
for (let sq = 27; sq <= 35; sq++) {
  const pc = pos.board[sq];
  if (pc !== T.NO_PIECE) {
    console.log('  Square', sq, 'File', T.file_of(sq), 'Rank', T.rank_of(sq), ': Piece', pc);
  }
}

// Check bitboard
console.log('\nPawn bitboard for white:');
const pawns = pos.pieces(T.WHITE, T.PAWN);
console.log('  Low:', pawns.low.toString(16));
console.log('  High:', pawns.high.toString(16));

// Check each bit
console.log('\nChecking each bit in low:');
for (let i = 0; i < 64; i++) {
  if (pawns.test(i)) {
    console.log('  Bit', i, 'is set (Rank', T.rank_of(i), 'File', T.file_of(i), ')');
  }
}

console.log('\nChecking each bit in high:');
for (let i = 0; i < 26; i++) {
  const sq = 64 + i;
  if (pawns.test(sq)) {
    console.log('  Bit', sq, 'is set (Rank', T.rank_of(sq), 'File', T.file_of(sq), ')');
  }
}

console.log('\n=== Check pop_lsb implementation ===');
let b = pawns.clone();
console.log('Initial bitboard - Low:', b.low.toString(16), 'High:', b.high.toString(16));

if (b.toBool()) {
  const lsb = b.lsb();
  console.log('LSB:', lsb, 'Expected:', lsb);
  
  const singleBit = 1 << lsb;
  const expectedLsb = singleBit & b.low ? lsb : -1;
  console.log('Expected LSB via bit test:', expectedLsb);
  
  // Manual pop
  const before = b.low;
  b.low ^= singleBit;
  console.log('After pop - Before:', before.toString(16), 'After:', b.low.toString(16));
}

console.log('\n🎯 Bitboard debug done!');
