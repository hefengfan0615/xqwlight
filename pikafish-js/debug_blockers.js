"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, StateInfo, init: initPosition } = require('./position.js');

console.log('=== Blockers Debug ===\n');

B.init();
PSQT.init();
initPosition();

const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');

console.log('Initial state:');
console.log('  byTypeBB[ALL_PIECES]:', typeof pos.byTypeBB[T.ALL_PIECES], pos.byTypeBB[T.ALL_PIECES]);
console.log('  byTypeBB[KNIGHT]:', typeof pos.byTypeBB[T.KNIGHT], pos.byTypeBB[T.KNIGHT]);

// Make a move
const moves = pos.generate_moves();
const m = moves[0];

console.log('\nMaking move...');
const st = new StateInfo();
pos.do_move(m, st);

console.log('After move:');
console.log('  byTypeBB[ALL_PIECES]:', typeof pos.byTypeBB[T.ALL_PIECES]);
console.log('  byTypeBB[KNIGHT]:', typeof pos.byTypeBB[T.KNIGHT]);
console.log('  byTypeBB[ROOK]:', typeof pos.byTypeBB[T.ROOK]);
console.log('  byTypeBB[CANNON]:', typeof pos.byTypeBB[T.CANNON]);

console.log('\n✅ Debug complete!');
