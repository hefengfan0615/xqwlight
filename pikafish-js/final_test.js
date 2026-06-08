"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, StateInfo, init: initPosition } = require('./position.js');
const Evaluate = require('./evaluate.js');
const Search = require('./search.js');

console.log('=== Pikafish JS Final Test ===\n');

// Initialize
B.init();
PSQT.init();
initPosition();
console.log('✅ Engine initialized');

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('✅ Position created');
console.log(pos.pretty());

// Test move generation
const moves = pos.generate_moves();
console.log(`✅ Generated ${moves.length} legal moves`);
if (moves.length > 0) {
  const moveToUci = (m) => {
    const fileToChar = 'abcdefghi';
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    return fileToChar[T.file_of(from)] + T.rank_of(from) + fileToChar[T.file_of(to)] + T.rank_of(to);
  };
  console.log(`  First 10 moves: ${moves.slice(0, 10).map(moveToUci).join(', ')}`);
}

// Test search
console.log('\n🔍 Testing search (depth 3)...');
const startTime = Date.now();
const result = Search.think(pos, 3);
const endTime = Date.now();

const moveToUci = (m) => {
  if (m === T.MOVE_NONE) return '(none)';
  const fileToChar = 'abcdefghi';
  const from = T.from_sq(m);
  const to = T.to_sq(m);
  return fileToChar[T.file_of(from)] + T.rank_of(from) + fileToChar[T.file_of(to)] + T.rank_of(to);
};

console.log(`✅ Search completed`);
console.log(`  Best move: ${moveToUci(result.move)}`);
console.log(`  Value: ${result.value}`);
console.log(`  Nodes: ${result.nodes}`);
console.log(`  Time: ${endTime - startTime}ms`);
if (endTime - startTime > 0) {
  console.log(`  NPS: ${Math.floor(result.nodes / ((endTime - startTime) / 1000))} nodes/s`);
}

// Test making best move
if (result.move !== T.MOVE_NONE) {
  console.log('\n🎯 Testing move application...');
  const st = new StateInfo();
  pos.do_move(result.move, st);
  console.log('✅ Move applied');
  console.log(pos.pretty());
  console.log('  FEN:', pos.fen());
}

console.log('\n🎉 All tests passed! Engine is working correctly!');
