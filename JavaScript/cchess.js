/*
 * Chinese Chess - Game Controller
 * Ties together the engine and board display for interactive play
 */

import { Position } from './position.js';
import Search from './pikafish_search.js';
import { Board } from './board.js';
import { probeBook } from './book.js';
import {
  NO_PIECE, WHITE, BLACK,
  colorOf, typeOf,
  fromSq, toSq, makeMove, MOVE_NONE,
  VALUE_MATE, VALUE_DRAW,
  makeSquare, fileOf, rankOf,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
} from './pikafish_types.js';

// Starting FENs for different handicap levels
const STARTUP_FEN = [
  // 0: Normal
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w",
  // 1: Left knight removed
  "r1bakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w",
  // 2: Both knights removed
  "r1bakab1r/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w",
  // 3: 9 pieces removed (rooks, knights, cannons)
  "1nbakabn1/9/9/p1p1p1p1p/9/9/P1P1P1P1P/9/9/1NBAKABN1 w",
];

class CChess {
  constructor() {
    this.pos = new Position();
    this.search = new Search();
    this.board = null;

    // Game state
    this.mode = 0;        // 0=player first, 1=computer first, 2=two players
    this.level = 0;       // 0=beginner, 1=amateur, 2=professional
    this.handicap = 0;    // handicap level
    this.animated = true;

    this.history = [];     // Move history for undo
    this.fenHistory = [];
    this.busy = false;     // Computer thinking flag
    this.stopThinking = false;
    this.selectedSq = -1;
    this.playerColor = WHITE; // Player is always WHITE (red)
    this.computerColor = BLACK;

    // Time control
    this.levelTimes = [1000, 2000, 5000];  // ms per move per level
  }

  init(boardId) {
    this.board = new Board(boardId);
    this.board.canvas.addEventListener('click', (e) => this.onClick(e));
  }

  restart() {
    this.stopThinking = true;
    this.busy = false;
    this.history = [];
    this.fenHistory = [];

    const fen = STARTUP_FEN[this.handicap] || STARTUP_FEN[0];
    this.pos.set(fen);
    this.fenHistory.push(fen);
    this.search.clear();
    this.selectedSq = -1;
    this.board.clearSelection();

    this.draw();

    // Computer plays first if mode == 1
    if (this.mode === 1) {
      setTimeout(() => this.computerMove(), 500);
    }
  }

  draw() {
    const lastMove = this.history.length > 0
      ? this.history[this.history.length - 1]
      : null;
    this.board.draw(this.pos, lastMove);
  }

  onClick(e) {
    if (this.busy) return;
    if (this.mode === 2) {
      this.handleClick(e);
      return;
    }
    if (this.pos.sideToMove !== this.playerColor) return;
    this.handleClick(e);
  }

  handleClick(e) {
    const rect = this.board.canvas.getBoundingClientRect();
    const scaleX = this.board.canvas.width / rect.width;
    const scaleY = this.board.canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const sq = this.board.canvasToBoard(cx, cy);

    if (sq < 0) {
      this.selectedSq = -1;
      this.board.clearSelection();
      this.draw();
      return;
    }

    const pc = this.pos.board[sq];

    // If we have a selected square, try to make a move
    if (this.selectedSq >= 0) {
      const m = makeMove(this.selectedSq, sq);

      // Check if this is a legal move
      if (this.pos.isLegalMove(m)) {
        this.makeMove(m);
        this.board.clearSelection();
        this.selectedSq = -1;
        return;
      }

      // If clicking own piece, change selection
      if (pc !== NO_PIECE && colorOf(pc) === this.pos.sideToMove) {
        this.selectedSq = sq;
        const legalMoves = this.getLegalMovesFor(sq);
        this.board.selectSquare(sq, legalMoves);
        this.draw();
        return;
      }

      // Invalid move, deselect
      this.selectedSq = -1;
      this.board.clearSelection();
      this.draw();
      return;
    }

    // Select own piece
    if (pc !== NO_PIECE && colorOf(pc) === this.pos.sideToMove) {
      this.selectedSq = sq;
      const legalMoves = this.getLegalMovesFor(sq);
      this.board.selectSquare(sq, legalMoves);
      this.draw();
    }
  }

  getLegalMovesFor(sq) {
    const moves = [];
    const us = this.pos.sideToMove;
    const att = []; // We don't precompute attacks here
    const legalMoves = [];
    this.pos.generateLegalMoves(legalMoves);
    for (const m of legalMoves) {
      if (fromSq(m) === sq) moves.push(m);
    }
    return moves;
  }

  makeMove(m) {
    if (!this.pos.doMove(m)) return;

    this.history.push(m);
    this.fenHistory.push(this.pos.fen());

    // Play sound for capture
    const captured = this.pos.st.captured;
    if (captured !== NO_PIECE && this.board.soundEnabled) {
      this.playSound('capture');
    } else if (this.pos.inCheck() && this.board.soundEnabled) {
      this.playSound('check');
    } else if (this.board.soundEnabled) {
      this.playSound('move');
    }

    this.updateMoveList();
    this.draw();

    // Check game end
    const legalMoves = [];
    this.pos.generateLegalMoves(legalMoves);
    if (legalMoves.length === 0) {
      if (this.pos.inCheck()) {
        const winner = this.pos.sideToMove === WHITE ? '黑方' : '红方';
        alert(winner + '获胜！');
      } else {
        alert('和棋！');
      }
      return;
    }

    // Computer's turn
    if (this.mode !== 2 && this.pos.sideToMove === this.computerColor) {
      setTimeout(() => this.computerMove(), 200);
    }
  }

  computerMove() {
    if (this.busy) return;
    this.busy = true;
    this.stopThinking = false;
    this.draw();

    const timeMs = this.levelTimes[this.level] || 2000;
    const maxDepth = [6, 10, 20][this.level] || 10;

    // Try opening book first
    if (this.history.length < 4) {
      const bookMove = probeBook(this.pos.fen());
      if (bookMove) {
        const m = this.pos.moveFromString(bookMove);
        if (m !== MOVE_NONE && this.pos.isLegalMove(m)) {
          this.busy = false;
          this.makeMove(m);
          return;
        }
      }
    }

    // Search for best move
    const bestMove = this.search.search(this.pos, {
      moveTime: timeMs,
      maxDepth: maxDepth,
    });

    this.busy = false;

    if (bestMove !== MOVE_NONE) {
      this.makeMove(bestMove);
    }

    this.draw();
  }

  undo() {
    if (this.history.length === 0) return;
    if (this.busy) return;

    // Undo both player and computer moves if in computer mode
    const count = this.mode !== 2 && this.history.length >= 2 ? 2 : 1;
    for (let i = 0; i < count && this.history.length > 0; i++) {
      const m = this.history.pop();
      this.pos.undoMove(m);
      this.fenHistory.pop();
    }

    this.board.clearSelection();
    this.selectedSq = -1;
    this.updateMoveList();
    this.draw();
  }

  updateMoveList() {
    const sel = document.getElementById('selMoveList');
    if (!sel) return;

    // Clear existing options
    sel.innerHTML = '<option selected value="0">=== 开始 ===</option>';

    for (let i = 0; i < this.history.length; i++) {
      const m = this.history[i];
      const opt = document.createElement('option');
      opt.value = (i + 1).toString();
      const from = fromSq(m), to = toSq(m);
      const fromFile = String.fromCharCode(97 + fileOf(from));
      const fromRank = 9 - rankOf(from);
      const toFile = String.fromCharCode(97 + fileOf(to));
      const toRank = 9 - rankOf(to);

      const num = Math.floor(i / 2) + 1;
      const prefix = i % 2 === 0 ? `${num}. ` : '    ';
      opt.text = prefix + fromFile + fromRank + toFile + toRank;
      sel.appendChild(opt);
    }
    sel.selectedIndex = sel.options.length - 1;
  }

  retract() {
    this.undo();
  }

  restartClick() {
    this.restart();
  }

  playSound(type) {
    try {
      const sounds = {
        'move': 'sounds/move.wav',
        'capture': 'sounds/capture.wav',
        'check': 'sounds/check.wav',
      };
      if (sounds[type]) {
        new Audio(sounds[type]).play().catch(() => {});
      }
    } catch (e) {}
  }
}

// Global instance
const game = new CChess();

export { game, CChess };