// Debug test
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
console.log("Side to move:", pos.sideToMove);
console.log("Red king at:", pos.kingSq[0], "file", file_of(pos.kingSq[0]), "rank", rank_of(pos.kingSq[0]));
console.log("Black king at:", pos.kingSq[1], "file", file_of(pos.kingSq[1]), "rank", rank_of(pos.kingSq[1]));

var moves = [];
pos.generate_pseudo(moves);
console.log("Total moves:", moves.length);
for (var i = 0; i < Math.min(5, moves.length); i++) {
  var m = moves[i];
  var from = SRC(m), to = DST(m);
  var pc = pos.pieceOn[from];
  console.log("Move", i, moveToIccs(m), "piece", pc, "type", type_of(pc),
              "from sq", from, "to sq", to);
}

// Try the first move
var m0 = moves[0];
console.log("---");
console.log("Trying move", moveToIccs(m0));
var ok = pos.do_move(m0);
console.log("do_move returned:", ok);
console.log("Side after:", pos.sideToMove);
console.log("Red king at:", pos.kingSq[0]);
console.log("Black king at:", pos.kingSq[1]);
console.log("Attackers on red king:", pos.attackers_to(pos.kingSq[0], 1).toString(2));
console.log("attackers on red king count:", popcount(pos.attackers_to(pos.kingSq[0], 1)));
if (!ok) pos.undo_move();
`;

eval.call(global, code);
