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

console.log('ALL_PIECES:', T.ALL_PIECES);
console.log('KNIGHT type:', T.KNIGHT);
console.log('PIECE_TYPE_NB:', T.PIECE_TYPE_NB);
console.log('byTypeBB length:', pos.byTypeBB.length);
console.log('byTypeBB[ALL_PIECES]:', pos.byTypeBB[T.ALL_PIECES]);
console.log('byTypeBB[KNIGHT]:', pos.byTypeBB[T.KNIGHT]);

console.log('\nMaking a move...');
const moves = pos.generate_moves();
console.log('Moves count:', moves.length);

const m = moves[0];
console.log('Making move:', T.from_sq(m), '->', T.to_sq(m));
pos.do_move(m);
console.log('After move - byTypeBB[KNIGHT]:', pos.byTypeBB[T.KNIGHT]);

console.log('\n✅ Test passed!');