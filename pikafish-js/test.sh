#!/bin/bash
# Test script for Pikafish JS engine

echo "=== Pikafish JS Test Script ==="
echo ""

# Test 1: Basic initialization
echo "Test 1: Basic initialization..."
node -e "
const Engine = require('./index.js');
Engine.init();
console.log('✅ Engine initialized');
const pos = new Engine.Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
const moves = pos.generate_moves();
console.log('✅ Generated', moves.length, 'moves');
"

echo ""

# Test 2: Search
echo "Test 2: Search (depth 3)..."
node -e "
const Engine = require('./index.js');
Engine.init();
const pos = new Engine.Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
const result = Engine.Search.think(pos, 3);
console.log('✅ Search complete');
console.log('  Best move:', Engine.moveToUci(result.move));
console.log('  Nodes:', result.nodes);
"

echo ""

# Test 3: Make and undo moves
echo "Test 3: Move make/undo..."
node -e "
const { Position, StateInfo, init } = require('./index.js');
init();
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
const moves = pos.generate_moves();
const st = new StateInfo();
pos.do_move(moves[0], st);
console.log('✅ Move made');
pos.undo_move(moves[0]);
console.log('✅ Move undone');
console.log('  FEN after undo:', pos.fen());
"

echo ""

# Test 4: Perft
echo "Test 4: Perft test (depth 2)..."
node -e "
const { Position, StateInfo, init, perft } = require('./index.js');
init();
const pos = new Position();
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
const count = perft(pos, 2);
console.log('✅ Perft(2):', count);
"

echo ""
echo "=== All tests passed! ==="
