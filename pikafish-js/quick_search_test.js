"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, StateInfo, init: initPosition } = require('./position.js');
const Evaluate = require('./evaluate.js');
const Search = require('./search.js');

console.log('=== Quick Search Test ===\n');

// Initialize
B.init();
PSQT.init();
initPosition();

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');

console.log('Position created');

// Test making a single move with StateInfo
console.log('\nTesting single move with StateInfo...');
const moves = pos.generate_moves();
console.log('Moves:', moves.length);

if (moves.length > 0) {
  const m = moves[0];
  const st = new StateInfo();
  console.log('Making move...');
  pos.do_move(m, st);
  console.log('✅ Move made');
  pos.undo_move(m);
  console.log('✅ Move undone');
}

// Test depth 1 search
console.log('\n🔍 Testing search (depth 1)...');
const startTime = Date.now();
const result = Search.think(pos, 1);
const endTime = Date.now();

console.log('✅ Search completed');
console.log('  Best move:', result.move);
console.log('  Value:', result.value);
console.log('  Nodes:', result.nodes);
console.log('  Time:', endTime - startTime, 'ms');

console.log('\n🎯 Quick search test complete!');