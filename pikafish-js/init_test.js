"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');
const { Position, init: initPosition } = require('./position.js');

console.log('=== Init Test ===\n');

B.init();
console.log('✅ Bitboards initialized');

PSQT.init();
console.log('✅ PSQT initialized');

console.log('Calling initPosition...');
initPosition();
console.log('✅ Position initialized');

console.log('Creating position...');
const pos = new Position();
console.log('✅ Position created');

console.log('Setting FEN...');
pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
console.log('✅ Position set');
console.log(pos.pretty());

console.log('\n🎯 Init test complete!');