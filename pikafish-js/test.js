"use strict";

const { init, Position, Search, moveToUci } = require('./index.js');

console.log('=== Pikafish JS Test ===\n');

// Initialize engine
init();
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
  console.log(`  First 5 moves: ${moves.slice(0, 5).map(m => moveToUci(m)).join(', ')}`);
}

// Test thinking
console.log('\n🔍 Testing search (depth 3)...');
const limits = new Search.SearchLimits();
limits.depth = 3;

const startTime = Date.now();
const result = Search.think(pos, limits);
const endTime = Date.now();

console.log(`✅ Search completed`);
console.log(`  Best move: ${moveToUci(result.move)}`);
console.log(`  Value: ${result.value}`);
console.log(`  Nodes: ${result.nodes}`);
console.log(`  Time: ${endTime - startTime}ms`);
console.log(`  NPS: ${Math.floor(result.nodes / ((endTime - startTime) / 1000))} nodes/s`);

// Test making a move
if (result.move !== 0) {
  console.log('\n🎯 Testing move application...');
  pos.do_move(result.move);
  console.log('✅ Move applied');
  console.log(pos.pretty());
  
  // Undo the move
  pos.undo_move(result.move);
  console.log('✅ Move undone');
}

console.log('\n🎉 All tests completed!');
