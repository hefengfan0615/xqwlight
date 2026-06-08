"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position, StateInfo } = require('./position.js');

console.log('=== Minimal Debug Test ===\n');

// Initialize bitboards
B.init();
console.log('✅ Bitboards initialized');

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('✅ Position created\n');

// Test do_move with debug
const from = T.make_square(T.FILE_A, T.RANK_3);
const to = T.make_square(T.FILE_A, T.RANK_4);
const testMove = T.make_move(from, to);

console.log('Making move step by step...');
console.log('1. Move: a3 -> a4');

// Manual do_move
const pc = pos.board[from];
const captured = pos.board[to];
console.log('2. Piece:', pc, 'Captured:', captured);

pos.move_piece(from, to);
console.log('3. Piece moved');

pos.sideToMove = T.BLACK;
pos.gamePly++;
console.log('4. Side changed to black');

// Now test set_state
console.log('5. Finding black king...');
const theirKing = pos.square(T.KING, T.BLACK);
console.log('   Black king at:', theirKing);

console.log('6. Finding white attackers...');
// Test just pawns first
console.log('   White pawns bitboard...');
const whitePawns = pos.pieces(T.WHITE, T.PAWN);
console.log('   White pawn count:', whitePawns.popcount());

let b = whitePawns.clone();
let pawnCount = 0;
while (b.toBool() && pawnCount < 10) {
  const s = b.poplsb();
  console.log('   Checking pawn at:', s, 'Rank:', T.rank_of(s));
  pawnCount++;
}

console.log('\n🎯 Minimal debug test done!');
