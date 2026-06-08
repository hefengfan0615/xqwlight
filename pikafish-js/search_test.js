"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, init: initPosition } = require('./position.js');
const Evaluate = require('./evaluate.js');
const Search = require('./search.js');

console.log('=== Search Test ===\n');

// Initialize
B.init();
PSQT.init();
initPosition();

// Create position
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('Position created');
console.log(pos.pretty());

// Test thinking
console.log('🔍 Testing search (depth 3)...');
const limits = new Search.SearchLimits();
limits.depth = 3;

const startTime = Date.now();
const result = Search.think(pos, limits);
const endTime = Date.now();

console.log(`✅ Search completed`);
console.log(`  Best move: ${result.move}`);
console.log(`  Value: ${result.value}`);
console.log(`  Nodes: ${result.nodes}`);
console.log(`  Time: ${endTime - startTime}ms`);
if (endTime - startTime > 0) {
  console.log(`  NPS: ${Math.floor(result.nodes / ((endTime - startTime) / 1000))} nodes/s`);
}

console.log('\n🎯 Search test complete!');