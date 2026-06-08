// Debug test 2
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

var m = MOVE(54, 45); // a3-a4
pos.do_move(m);
console.log("After a3-a4, side to move:", pos.sideToMove);
console.log("Red king at:", pos.kingSq[0], "Black king at:", pos.kingSq[1]);
console.log("Red king position (file,rank):", file_of(pos.kingSq[0]), rank_of(pos.kingSq[0]));

// Show what's on the board
for (var r = 0; r < 10; r++) {
  var line = "";
  for (var f = 0; f < 9; f++) {
    var pc = pos.pieceOn[f + r*9];
    if (pc === 0) line += ". ";
    else if (color_of(pc) === 0) line += "R ";
    else line += "B ";
  }
  console.log("rank " + r + ": " + line);
}

// Now find the attackers on the red king
var att = pos.attackers_to(pos.kingSq[0], 1);
console.log("Attackers bitboard:", att.toString(2).padStart(90, '0'));
console.log("Attacker squares:");
var t = att;
while (t !== 0n) {
  var s = bb_lsb(t);
  t &= t - 1n;
  console.log("  sq", s, "file", file_of(s), "rank", rank_of(s), "piece", pos.pieceOn[s], "type", type_of(pos.pieceOn[s]));
}
pos.undo_move();
`;

eval.call(global, code);
