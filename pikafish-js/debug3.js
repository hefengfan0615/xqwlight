"use strict";
const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, init: initPosition } = require('./position.js');

B.init();
PSQT.init();
initPosition();

const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');

console.log('Before move:');
console.log('  byTypeBB[ALL_PIECES] type:', typeof pos.byTypeBB[T.ALL_PIECES]);
console.log('  byTypeBB[KNIGHT] type:', typeof pos.byTypeBB[T.KNIGHT]);
console.log('  byTypeBB[CANNON] type:', typeof pos.byTypeBB[T.CANNON]);
console.log('  byTypeBB[ROOK] type:', typeof pos.byTypeBB[T.ROOK]);

const moves = pos.generate_moves();
const m = moves[0];

console.log('\nMaking move', T.from_sq(m), '->', T.to_sq(m));
pos.do_move(m);

console.log('\nAfter move:');
console.log('  byTypeBB[ALL_PIECES] type:', typeof pos.byTypeBB[T.ALL_PIECES], 'value:', pos.byTypeBB[T.ALL_PIECES]);
console.log('  byTypeBB[KNIGHT] type:', typeof pos.byTypeBB[T.KNIGHT], 'value:', pos.byTypeBB[T.KNIGHT]);

// Check the attackers_to call
console.log('\nTesting attackers_to...');
const ksq = pos.square(T.KING, pos.sideToMove);
console.log('  King square:', ksq);
console.log('  byTypeBB[ALL_PIECES]:', typeof pos.byTypeBB[T.ALL_PIECES]);
console.log('  byTypeBB[KNIGHT]:', typeof pos.byTypeBB[T.KNIGHT]);

const knightAttacks = B.attacks_bb(T.KNIGHT, ksq, pos.byTypeBB[T.ALL_PIECES]);
console.log('  Knight attacks type:', typeof knightAttacks);
console.log('  Result:', knightAttacks & pos.byTypeBB[T.KNIGHT]);

console.log('\n✅ Test passed!');