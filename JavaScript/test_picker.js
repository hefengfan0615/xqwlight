// Debug search
"use strict";
const fs = require("fs");
const path = require("path");

const order = ["cchess.js","bitboard.js","position.js","nnue.js","movepick.js","search.js"];
let code = "";
for (const f of order) {
  code += fs.readFileSync(path.join(__dirname, f), "utf8") + "\n";
}

code += `
var pos = new Position();
pos.set_fen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");

// Test move picker directly
var picker = new MovePicker(pos, 0, [0, 0], new Array(7*256).fill(0));
var count = 0;
var moves = [];
while (true) {
  var mv = picker.next();
  if (mv === 0) break;
  moves.push(mv);
  count++;
  if (count > 50) break;
}
console.log("MovePicker yielded", count, "moves");
console.log("First 5 moves:");
for (var i = 0; i < Math.min(5, moves.length); i++) {
  console.log("  ", moveToIccs(moves[i]), "piece", pos.pieceOn[SRC(moves[i])]);
}
`;

eval.call(global, code);
