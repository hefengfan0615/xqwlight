"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, init: initPosition } = require('./position.js');

console.log('=== Simple Test ===\n');

// Initialize
B.init();
console.log('✅ Bitboards initialized');

PSQT.init();
console.log('✅ PSQT initialized');

initPosition();
console.log('✅ Position module initialized');

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('✅ Position created');
console.log(pos.pretty());

// Test basic functions
console.log('✅ Testing basic functions...');
console.log('  Side to move:', pos.side_to_move() === T.WHITE ? 'white' : 'black');
console.log('  In check:', pos.in_check());
console.log('  Piece at a0:', pos.piece_on(T.make_square(T.FILE_A, T.RANK_0)));

// Try a simple pawn move
console.log('\n✅ Testing simple move...');
const from = T.make_square(T.FILE_A, T.RANK_3);
const to = T.make_square(T.FILE_A, T.RANK_4);
const testMove = T.make_move(from, to);
console.log('  Legal:', pos.legal(testMove));

if (pos.legal(testMove)) {
  console.log('  Making move a3a4...');
  pos.do_move(testMove);
  console.log(pos.pretty());
  pos.undo_move(testMove);
  console.log('  Undo successful!');
}

// Generate moves
console.log('\n✅ Generating moves...');
const moves = pos.generate_moves();
console.log('  Total moves:', moves.length);
console.log('  First 5:', moves.slice(0, 5).map(m => T.from_sq(m) + '-' + T.to_sq(m)).join(', '));

console.log('\n🎯 Simple test complete!');