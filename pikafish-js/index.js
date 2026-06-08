"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const { Position, StateInfo, init: initPosition } = require('./position.js');
const { init: initPSQT } = require('./psqt.js');
const Search = require('./search.js');

// Global state list for move history
let states = [];

// Initialize all modules
function init() {
  B.init();
  initPosition();
  initPSQT();
}

// Move to UCI coordinate string
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
  
  let pos = new Position();
  states = [];
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
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
        states = [];
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
            states = [];
          } else if (tokens[idx] === 'startpos') {
            idx++;
            pos = new Position();
            pos.set('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
            states = [];
          }
          
          if (idx < tokens.length && tokens[idx] === 'moves') {
            idx++;
            while (idx < tokens.length) {
              const m = uciToMove(pos, tokens[idx]);
              if (m !== T.MOVE_NONE) {
                const st = new StateInfo();
                states.push(st);
                pos.do_move(m, st);
              }
              idx++;
            }
          }
        }
        break;
        
      case 'go':
        {
          let depth = 64;
          let movetime = Infinity;
          let nodes = Infinity;
          
          for (let i = 1; i < tokens.length; i++) {
            if (tokens[i] === 'depth' && i + 1 < tokens.length) {
              depth = parseInt(tokens[++i]);
            } else if (tokens[i] === 'nodes' && i + 1 < tokens.length) {
              nodes = parseInt(tokens[++i]);
            } else if (tokens[i] === 'movetime' && i + 1 < tokens.length) {
              movetime = parseInt(tokens[++i]);
            } else if (tokens[i] === 'infinite') {
              depth = 99;
            }
          }
          
          const result = Search.think(pos, depth);
          console.log('bestmove ' + moveToUci(result.move));
        }
        break;
        
      case 'quit':
        rl.close();
        process.exit(0);
        break;
        
      case 'd':
        console.log(pos.pretty());
        break;
        
      case 'perft':
        {
          const depth = parseInt(tokens[1]) || 3;
          const moves = pos.generate_moves();
          let total = 0;
          console.log('Perft ' + depth + ':');
          for (const m of moves) {
            const st = new StateInfo();
            pos.do_move(m, st);
            const count = perft(pos, depth - 1);
            pos.undo_move(m);
            total += count;
            console.log('  ' + moveToUci(m) + ': ' + count);
          }
          console.log('Total: ' + total);
        }
        break;
        
      case 'eval':
        console.log('Evaluation:', Search.evaluate(pos));
        break;
        
      case 'help':
        console.log('Available commands:');
        console.log('  uci             - Show engine info');
        console.log('  isready         - Check if ready');
        console.log('  position <fen>  - Set position');
        console.log('  position startpos - Set start position');
        console.log('  go [depth N]    - Search for best move');
        console.log('  d               - Display board');
        console.log('  perft [depth]   - Performance test');
        console.log('  eval            - Show evaluation');
        console.log('  quit            - Exit');
        break;
        
      default:
        console.log('Unknown command. Type "help" for available commands.');
    }
  });
}

// Perft function for testing
function perft(pos, depth) {
  if (depth === 0) return 1;
  
  const moves = pos.generate_moves();
  let total = 0;
  
  for (const m of moves) {
    const st = new StateInfo();
    pos.do_move(m, st);
    total += perft(pos, depth - 1);
    pos.undo_move(m);
  }
  
  return total;
}

// Export main API
module.exports = {
  init,
  Position,
  StateInfo,
  Search,
  moveToUci,
  uciToMove,
  uciLoop,
  perft
};

// If run directly, start UCI loop
if (require.main === module) {
  uciLoop();
}
