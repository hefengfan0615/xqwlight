"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position, init: initPosition } = require('./position.js');
const { init: initPSQT } = require('./psqt.js');
const Search = require('./search.js');

// Initialize all modules
function init() {
  B.init();
  initPosition();
  initPSQT();
}

// Move to coordinate string (simplified)
function moveToUci(move) {
  if (move === T.MOVE_NONE) return '(none)';
  
  const from = T.from_sq(move);
  const to = T.to_sq(move);
  
  const fileToChar = 'abcdefghi';
  const rankToChar = '0123456789';
  
  const fromFile = fileToChar[T.file_of(from)];
  const fromRank = rankToChar[T.rank_of(from)];
  const toFile = fileToChar[T.file_of(to)];
  const toRank = rankToChar[T.rank_of(to)];
  
  return fromFile + fromRank + toFile + toRank;
}

// UCI coordinate to move
function uciToMove(pos, uci) {
  const fileToChar = 'abcdefghi';
  
  const fromFile = fileToChar.indexOf(uci[0]);
  const fromRank = parseInt(uci[1]);
  const toFile = fileToChar.indexOf(uci[2]);
  const toRank = parseInt(uci[3]);
  
  const from = T.make_square(fromFile, fromRank);
  const to = T.make_square(toFile, toRank);
  
  const moves = pos.generate_moves();
  
  for (const m of moves) {
    if (T.from_sq(m) === from && T.to_sq(m) === to) {
      return m;
    }
  }
  
  return T.MOVE_NONE;
}

// Simple UCI loop
function uciLoop() {
  init();
  
  console.log('id name Pikafish JS');
  console.log('id author Pikafish Team');
  console.log('uciok');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  let pos = new Position();
  pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  
  rl.on('line', (line) => {
    const tokens = line.trim().split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    
    switch (cmd) {
      case 'uci':
        console.log('id name Pikafish JS');
        console.log('id author Pikafish Team');
        console.log('uciok');
        break;
        
      case 'isready':
        console.log('readyok');
        break;
        
      case 'ucinewgame':
        pos = new Position();
        pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
        break;
        
      case 'position':
        {
          let idx = 1;
          let fen = '';
          
          if (tokens[idx] === 'fen') {
            idx++;
            while (idx < tokens.length && tokens[idx] !== 'moves') {
              fen += tokens[idx] + ' ';
              idx++;
            }
            pos = new Position();
            pos.set(fen.trim());
          } else if (tokens[idx] === 'startpos') {
            idx++;
            pos = new Position();
            pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
          }
          
          if (idx < tokens.length && tokens[idx] === 'moves') {
            idx++;
            while (idx < tokens.length) {
              const m = uciToMove(pos, tokens[idx]);
              if (m !== T.MOVE_NONE) {
                pos.do_move(m);
              }
              idx++;
            }
          }
        }
        break;
        
      case 'go':
        {
          const limits = new Search.SearchLimits();
          
          for (let i = 1; i < tokens.length; i++) {
            if (tokens[i] === 'depth' && i + 1 < tokens.length) {
              limits.depth = parseInt(tokens[++i]);
            } else if (tokens[i] === 'nodes' && i + 1 < tokens.length) {
              limits.nodes = parseInt(tokens[++i]);
            } else if (tokens[i] === 'movetime' && i + 1 < tokens.length) {
              limits.time = parseInt(tokens[++i]);
            }
          }
          
          const result = Search.think(pos, limits);
          console.log('bestmove ' + moveToUci(result.move));
        }
        break;
        
      case 'quit':
        rl.close();
        break;
        
      case 'd':
        console.log(pos.pretty());
        break;
    }
  });
}

// Export main API
module.exports = {
  init,
  Position,
  Search,
  moveToUci,
  uciToMove,
  uciLoop
};

// If run directly, start UCI loop
if (require.main === module) {
  uciLoop();
}
