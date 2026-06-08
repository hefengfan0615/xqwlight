"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position, StateInfo } = require('./position.js');

B.init();

const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');

console.log('Starting step-by-step debug...\n');

// Test step 1: Check piece
const from = T.make_square(T.FILE_A, T.RANK_3);
const to = T.make_square(T.FILE_A, T.RANK_4);
const testMove = T.make_move(from, to);
const pc = pos.piece_on(from);

console.log('Step 1: Check piece at a3');
console.log('  Piece:', pc, 'Type:', T.type_of(pc), 'Color:', T.color_of(pc));
console.log('  Is PAWN?', T.type_of(pc) === T.PAWN);

console.log('\nStep 2: Check pawn move legality');
const pawnLegal = pos.legal_pawn_move(from, to, T.color_of(pc));
console.log('  Pawn move legal?', pawnLegal);

console.log('\nStep 3: Manual do_move (without set_state)');
pos.board[to] = pc;
pos.board[from] = T.NO_PIECE;
console.log('  Board updated');

const newSide = T.BLACK;
const king = pos.square(T.KING, newSide);
console.log('  Black king at:', king, '(Expected 85 = E9)');

console.log('\nStep 4: Check attackers_to with just pawns');
const whitePawns = pos.pieces(T.WHITE, T.PAWN);
console.log('  White pawns count:', whitePawns.popcount());

// Manually iterate
let tempPawns = whitePawns.clone();
let count = 0;
while (tempPawns.toBool() && count < 10) {
  const s = tempPawns.poplsb();
  console.log('  Pawn at:', s, 'File:', T.file_of(s), 'Rank:', T.rank_of(s));
  count++;
}

console.log('\n✅ Test complete!');
