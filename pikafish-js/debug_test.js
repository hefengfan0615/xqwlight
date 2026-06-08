"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position } = require('./position.js');

console.log('=== Debug Test ===\n');

// Initialize bitboards
console.log('Initializing bitboards...');
B.init();
console.log('✅ Bitboards initialized');

// Create position
console.log('Creating position...');
const pos = new Position();
console.log('Setting FEN...');
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('✅ Position created\n');

// Test basic functions
console.log('Testing basic functions...');
console.log('  Side to move:', pos.side_to_move() === T.WHITE ? 'white' : 'black');
console.log('  In check:', pos.in_check());

// Try a simple pawn move
console.log('\n=== Testing pawn move a3-a4 ===');
const from = T.make_square(T.FILE_A, T.RANK_3);
const to = T.make_square(T.FILE_A, T.RANK_4);
console.log('  From:', from, 'To:', to);
const testMove = T.make_move(from, to);
console.log('  Move:', testMove);

console.log('\nChecking if piece at a3 is correct...');
const pc = pos.piece_on(from);
console.log('  Piece:', pc, 'Type:', T.type_of(pc), 'Color:', T.color_of(pc));

console.log('\nChecking legal_move_for_piece...');
const legalPiece = pos.legal_move_for_piece(pc, from, to);
console.log('  legal_move_for_piece:', legalPiece);

if (legalPiece) {
  console.log('\nChecking capture...');
  const captured = pos.piece_on(to);
  console.log('  Captured:', captured);
  console.log('  Own piece at to?', captured !== T.NO_PIECE && T.color_of(captured) === T.color_of(pc));
  
  console.log('\nMaking move for check test...');
  pos.do_move(testMove);
  console.log('✅ Move made');
  
  console.log('\nFinding own king...');
  const us = T.BLACK; // Now black's turn
  const ksq = pos.square(T.KING, us);
  console.log('  King square:', ksq);
  
  console.log('\nGetting attackers...');
  const attackers = pos.attackers_to(ksq, T.WHITE);
  console.log('  Attackers:', attackers.toBool());
  
  pos.undo_move(testMove);
  console.log('✅ Move undone');
}

console.log('\n🎯 Debug test complete!');
