"use strict";

// ============================================================
// Pikafish JS - UCI Protocol Interface
// ============================================================

const T = require('./types');
const Position = require('./position');
const { Search, moveToUci, uciToMove } = require('./search');
const { TranspositionTable } = require('./tables');

class UCI {
  constructor() {
    this.pos = new Position();
    this.pos.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w");
    this.search = new Search(this.pos);
    this.maxDepth = 64;
    this.moveTime = 3000;
    this.ponderMode = false;
  }

  startUCIMode() {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log("Pikafish JS by Pikafish Team (JS Port)");
    console.log("A free and strong UCI xiangqi engine");

    rl.on('line', (line) => {
      this.handleCommand(line.trim(), rl);
    });
  }

  handleCommand(cmd, rl) {
    const parts = cmd.split(/\s+/);
    const command = parts[0];

    switch (command) {
      case 'uci':
        this.cmdUCI();
        break;
      case 'isready':
        console.log("readyok");
        break;
      case 'ucinewgame':
        this.cmdNewGame();
        break;
      case 'setoption':
        this.cmdSetOption(parts.slice(1));
        break;
      case 'position':
        this.cmdPosition(parts.slice(1));
        break;
      case 'go':
        this.cmdGo(parts.slice(1), rl);
        break;
      case 'stop':
        this.cmdStop();
        break;
      case 'quit':
        this.cmdQuit(rl);
        break;
      case 'eval':
        this.cmdEval();
        break;
      case 'd':
        this.cmdDisplay();
        break;
      default:
        break;
    }
  }

  cmdUCI() {
    console.log("id name Pikafish JS");
    console.log("id author Pikafish Team (JS Port)");
    console.log("option name Hash type spin default 16 min 1 max 33554432");
    console.log("option name Threads type spin default 1 min 1 max 1");
    console.log("option name Move Time type spin default 3000 min 1 max 86400000");
    console.log("option name Max Depth type spin default 64 min 1 max 246");
    console.log("option name Clear Hash type button");
    console.log("uciok");
  }

  cmdNewGame() {
    this.search.tt.newSearch();
    this.search.killerTable.clear();
  }

  cmdSetOption(args) {
    const str = args.join(' ');
    const nameMatch = str.match(/name\s+(\S+)/);
    const valueMatch = str.match(/value\s+(\d+)/);
    if (!nameMatch || !valueMatch) return;

    const name = nameMatch[1];
    const value = parseInt(valueMatch[1]);

    switch (name) {
      case 'Hash':
        this.search.tt = new TranspositionTable(value);
        break;
      case 'Move Time':
        this.moveTime = value;
        break;
      case 'Max Depth':
        this.maxDepth = value;
        break;
    }
  }

  cmdPosition(args) {
    const str = args.join(' ');
    let fenPart, movesPart;

    if (str.startsWith('fen')) {
      const startIdx = 3;
      const movesIdx = str.indexOf('moves', startIdx);
      if (movesIdx !== -1) {
        fenPart = str.substring(startIdx, movesIdx).trim();
        movesPart = str.substring(movesIdx + 6).trim();
      } else {
        fenPart = str.substring(startIdx).trim();
        movesPart = '';
      }
    } else if (str.startsWith('startpos')) {
      fenPart = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";
      const movesIdx = str.indexOf('moves');
      if (movesIdx !== -1) {
        movesPart = str.substring(movesIdx + 6).trim();
      } else {
        movesPart = '';
      }
    } else {
      return;
    }

    this.pos.fromFen(fenPart);

    if (movesPart) {
      const moves = movesPart.split(/\s+/);
      for (const moveStr of moves) {
        const m = uciToMove(this.pos, moveStr);
        if (m !== T.MOVE_NONE && this.pos.legalMove(m)) {
          this.pos.makeMove(m);
        }
      }
    }
  }

  cmdGo(args, rl) {
    const str = args.join(' ');
    let depth = this.maxDepth;
    let movetime = this.moveTime;

    if (str.includes('depth')) {
      const depthMatch = str.match(/depth\s+(\d+)/);
      if (depthMatch) {
        depth = parseInt(depthMatch[1]);
        movetime = 300000;
      }
    }
    if (str.includes('movetime')) {
      const timeMatch = str.match(/movetime\s+(\d+)/);
      if (timeMatch) {
        movetime = parseInt(timeMatch[1]);
      }
    }
    if (str.includes('wtime') || str.includes('btime')) {
      const timeMatch = this.pos.sideToMove === T.WHITE ?
        str.match(/wtime\s+(\d+)/) : str.match(/btime\s+(\d+)/);
      if (timeMatch) {
        const timeLeft = parseInt(timeMatch[1]);
        movetime = Math.min(timeLeft / 30, 5000);
      }
    }

    const startTime = Date.now();
    const result = this.search.searchIterativeDeepening(depth, movetime);

    const elapsed = Date.now() - startTime;
    const score = result.score;
    const depth = result.depth;
    const nodes = result.nodes + result.qnodes;
    const nps = elapsed > 0 ? Math.round(nodes / (elapsed / 1000)) : 0;

    // Score display
    let scoreStr;
    if (Math.abs(score) >= T.VALUE_MATE_IN_MAX_PLY) {
      const mateIn = T.VALUE_MATE - Math.abs(score);
      const matePly = mateIn % 2 === 0 ? Math.ceil(mateIn / 2) : Math.floor(mateIn / 2);
      const sign = score > 0 ? 1 : -1;
      scoreStr = `mate ${sign * matePly}`;
    } else {
      scoreStr = `cp ${score}`;
    }

    // PV extraction (simplified - just the best move)
    const pv = moveToUci(result.bestMove);

    console.log(`info depth ${depth} score ${scoreStr} time ${elapsed} nodes ${nodes} nps ${nps} pv ${pv}`);
    console.log(`bestmove ${pv}`);
  }

  cmdStop() {
    this.search.stopped = true;
  }

  cmdQuit(rl) {
    if (rl) rl.close();
    process.exit(0);
  }

  cmdEval() {
    const Eval = require('./evaluate');
    const score = Eval.evaluate(this.pos);
    console.log(`Evaluation: ${this.pos.sideToMove === T.WHITE ? score : -score}`);
  }

  cmdDisplay() {
    const files = "abcdefghi";
    const board = [];
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      let row = (r + 1) + ' ';
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        const pc = this.pos.board[sq];
        row += this.pieceChar(pc) + ' ';
      }
      board.push(row);
    }
    console.log('\n' + board.join('\n') + '\n');
    console.log('FEN:', this.pos.toFen());
    console.log('Side to move:', this.pos.sideToMove === T.WHITE ? 'White' : 'Black');
    console.log('In check:', this.pos.checkers() ? 'Yes' : 'No');
  }

  pieceChar(pc) {
    if (pc === T.NO_PIECE) return '.';
    const pt = T.type_of_piece(pc);
    const color = T.color_of(pc);
    const chars = {
      [T.KING]: 'K', [T.ADVISOR]: 'A', [T.BISHOP]: 'B',
      [T.KNIGHT]: 'N', [T.ROOK]: 'R', [T.CANNON]: 'C', [T.PAWN]: 'P'
    };
    const ch = chars[pt] || '?';
    return color === T.WHITE ? ch : ch.toLowerCase();
  }
}

module.exports = UCI;
