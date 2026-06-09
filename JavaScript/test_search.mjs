// Simple test of the pikafish search engine
import { Position } from './position.js';
import Search from './pikafish_search.js';
import { MOVE_NONE } from './pikafish_types.js';

// Starting position
const FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

const pos = new Position();
pos.set(FEN);

const search = new Search();

let infoCount = 0;
let bestMoveInfo = null;
search.onInfo = (info) => {
  infoCount++;
  const pvStr = info.pv ? info.pv.map(m => pos.moveToString(m)).join(' ') : '';
  console.log(`info depth=${info.depth} seldepth=${info.seldepth} score=${formatScore(info.score)} nodes=${info.nodes} nps=${info.nps} time=${info.time}ms pv=[${pvStr}]`);
  bestMoveInfo = info;
};
search.onBestMove = (m, v) => {
  console.log(`bestmove ${m !== MOVE_NONE ? pos.moveToString(m) : '0000'}  score=${formatScore(v)}`);
};

function formatScore(v) {
  const MATE = 32000;
  if (v >= MATE - 240) {
    return `mate ${Math.ceil((MATE - v) / 2)}`;
  }
  if (v <= -(MATE - 240)) {
    return `mate ${-Math.ceil((MATE + v) / 2)}`;
  }
  return `cp ${v}`;
}

console.log('Starting search test...');
console.log('FEN:', FEN);
console.log('Initial pos.st:', pos.st ? 'OK' : 'NULL');

const start = Date.now();
const best = search.search(pos, {
  moveTime: 2000,  // 2 seconds
  maxDepth: 6,
  maxNodes: 200000,  // safety limit
});
console.log('After search pos.st:', pos.st ? 'OK' : 'NULL');
const elapsed = Date.now() - start;

console.log(`\n=== Result ===`);
console.log(`Best move: ${best !== MOVE_NONE ? pos.moveToString(best) : 'NONE'}`);
console.log(`Total time: ${elapsed}ms`);
console.log(`Total nodes: ${search.nodes.toLocaleString()}`);
console.log(`Completed depth: ${search.completedDepth}`);
console.log(`Selective depth: ${search.selDepth}`);
console.log(`Info callbacks received: ${infoCount}`);
console.log(`\nNode NPS: ${(search.nodes * 1000 / elapsed).toLocaleString()}`);

if (best === MOVE_NONE) {
  console.error('FAILED: search returned no move');
  process.exit(1);
}
if (infoCount === 0) {
  console.error('WARNING: no onInfo callbacks received');
}
if (search.nodes === 0) {
  console.error('FAILED: no nodes searched');
  process.exit(1);
}

console.log('\n✓ All basic tests passed');
