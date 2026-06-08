"use strict";

// ============================================================
// Pikafish JS - Node.js Test Script
// ============================================================

const T = require('./js/types');
const Position = require('./js/position');
const MoveGen = require('./js/movegen');
const Eval = require('./js/evaluate');
const { Search, moveToUci, uciToMove } = require('./js/search');

console.log("Pikafish JS Test Suite\n");

// Test 1: FEN parsing and board display
console.log("Test 1: FEN Parsing and Board Display");
console.log("=".repeat(50));
const pos = new Position();
pos.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w");

function displayBoard(p) {
  const files = "abcdefghi";
  console.log("  a b c d e f g h i");
  for (let r = T.RANK_9; r >= T.RANK_0; r--) {
    let row = (r + 1) + " ";
    for (let f = T.FILE_A; f <= T.FILE_I; f++) {
      const sq = T.make_square(f, r);
      const pc = p.board[sq];
      row += pieceChar(pc) + " ";
    }
    console.log(row);
  }
}

function pieceChar(pc) {
  if (pc === T.NO_PIECE) return ".";
  const pt = T.type_of_piece(pc);
  const color = T.color_of(pc);
  const chars = {
    [T.KING]: "K", [T.ADVISOR]: "A", [T.BISHOP]: "B",
    [T.KNIGHT]: "N", [T.ROOK]: "R", [T.CANNON]: "C", [T.PAWN]: "P"
  };
  const ch = chars[pt] || "?";
  return color === T.WHITE ? ch.toUpperCase() : ch.toLowerCase();
}

displayBoard(pos);
console.log(`Side to move: ${pos.sideToMove === T.WHITE ? 'White' : 'Black'}`);
console.log();

// Test 2: Legal move generation
console.log("Test 2: Legal Move Generation");
console.log("=".repeat(50));
const moves = MoveGen.generateLegalMoves(pos);
console.log(`Total legal moves: ${moves.length}`);
console.log("First 10 moves:");
for (let i = 0; i < Math.min(10, moves.length); i++) {
  console.log(`  ${i + 1}. ${moveToUci(moves[i])}`);
}
console.log();

// Test 3: Evaluation
console.log("Test 3: Static Evaluation");
console.log("=".repeat(50));
const score = Eval.evaluate(pos);
console.log(`Initial position evaluation: ${score} (from White's perspective)`);
console.log();

// Test 4: Make/Undo move
console.log("Test 4: Make and Undo Move");
console.log("=".repeat(50));
const m = moves[0];
console.log(`Making move: ${moveToUci(m)}`);
pos.makeMove(m);
console.log(`Evaluation after move: ${Eval.evaluate(pos)}`);
pos.undoMove();
console.log(`Evaluation after undo: ${Eval.evaluate(pos)}`);
console.log();

// Test 5: Check detection
console.log("Test 5: Check Detection");
console.log("=".repeat(50));
const checkPos = new Position();
checkPos.fromFen("4k4/9/9/9/9/9/9/9/9/4K3R w"); // Rook checking king
console.log(`Position: ${checkPos.toFen()}`);
console.log(`In check: ${checkPos.checkers() ? 'Yes' : 'No'}`);
console.log();

// Test 6: Search depth 3
console.log("Test 6: Alpha-Beta Search (Depth 3)");
console.log("=".repeat(50));
const searchPos = new Position();
searchPos.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w");
const search = new Search(searchPos);
const result = search.searchIterativeDeepening(3, 5000);
console.log(`Best move: ${moveToUci(result.bestMove)}`);
console.log(`Score: ${result.score}`);
console.log(`Depth reached: ${result.depth}`);
console.log(`Nodes searched: ${result.nodes}`);
console.log(`Time: ${result.time}ms`);
console.log();

// Test 7: Deeper search (depth 5)
console.log("Test 7: Deeper Search (Depth 5)");
console.log("=".repeat(50));
const searchPos2 = new Position();
searchPos2.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w");
const search2 = new Search(searchPos2);
const result2 = search2.searchIterativeDeepening(5, 10000);
console.log(`Best move: ${moveToUci(result2.bestMove)}`);
console.log(`Score: ${result2.score}`);
console.log(`Depth reached: ${result2.depth}`);
console.log(`Nodes searched: ${result2.nodes + result2.qnodes}`);
console.log(`Time: ${result2.time}ms`);
console.log();

// Test 8: Middle game position
console.log("Test 8: Middle Game Search");
console.log("=".repeat(50));
const midPos = new Position();
midPos.fromFen("rnbakabr1/9/2c1c4/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b");
const search3 = new Search(midPos);
const result3 = search3.searchIterativeDeepening(4, 8000);
console.log(`Position: ${midPos.toFen()}`);
console.log(`Best move: ${moveToUci(result3.bestMove)}`);
console.log(`Score: ${result3.score}`);
console.log(`Depth reached: ${result3.depth}`);
console.log(`Nodes: ${result3.nodes + result3.qnodes}`);
console.log();

console.log("All tests completed successfully!");
