// Quick functional test: concatenate all module sources and run in single global scope.
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
console.log("Loaded position, FEN:", pos.to_fen());

var counts = {};
for (var i = 0; i < 90; i++) {
  var pc = pos.pieceOn[i];
  if (pc) {
    var k = type_of(pc) + (color_of(pc) === 0 ? "r" : "b");
    counts[k] = (counts[k] || 0) + 1;
  }
}
console.log("Piece counts:", JSON.stringify(counts));

var moves = [];
pos.generate_pseudo(moves);
console.log("Pseudo-legal moves:", moves.length);

var legal = 0;
for (var i = 0; i < moves.length; i++) {
  if (pos.do_move(moves[i])) { legal++; pos.undo_move(); }
}
console.log("Legal moves:", legal);

var s = new Search(pos, 14);
s.onInfo = function(info) {
  console.log("info d=" + info.depth + " score=" + info.score + " nodes=" + info.nodes + " time=" + info.time + "ms knps=" + info.knps.toFixed(1));
};
var best = s.searchMain(3, 2000);
console.log("Best move at depth 3:", moveToIccs(best));
`;

eval.call(global, code);
