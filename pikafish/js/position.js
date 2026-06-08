"use strict";

// ============================================================
// Pikafish JS - Position
// Board representation, FEN parsing, move making/unmaking,
// legality checking, check detection
// ============================================================

const T = require('./types');
const BB = require('./bitboard');

class Position {
  constructor() {
    this.board = new Int8Array(T.SQUARE_NB); // pieces on board
    this.sideToMove = T.WHITE;
    this.zobristKey = 0;
    this.history = []; // For undo
    this.gamePly = 0;
    this.rule60 = 0; // 60-move rule counter
    this.psqMg = [0, 0]; // PSQT middlegame scores per color
    this.psqEg = [0, 0]; // PSQT endgame scores per color
    this.piecesByColor = [0, 0]; // bitboards for each color
    this.piecesByType = new Int32Array(T.KING + 1); // count per piece type
    this.materialDiff = 0; // White material - Black material
    // Move list for repetition detection
    this.moveList = [];
    // Hash keys for repetition
    this.keyHistory = [];
  }

  // Place a piece on the board
  putPiece(pc, sq) {
    this.board[sq] = pc;
    const color = T.color_of(pc);
    this.piecesByColor[color]++;
    const pt = T.type_of_piece(pc);
    this.piecesByType[pt]++;
    this.zobristKey ^= T.zobrist_piece[pc][sq];
  }

  // Remove a piece from the board
  removePiece(sq) {
    const pc = this.board[sq];
    if (pc !== T.NO_PIECE) {
      const color = T.color_of(pc);
      this.piecesByColor[color]--;
      const pt = T.type_of_piece(pc);
      this.piecesByType[pt]--;
      this.zobristKey ^= T.zobrist_piece[pc][sq];
      this.board[sq] = T.NO_PIECE;
    }
  }

  // Move a piece (for setup only, doesn't update history)
  movePieceInternal(from, to) {
    const pc = this.board[from];
    this.removePiece(from);
    this.putPiece(pc, to);
  }

  // Initialize PSQ scores
  initPsq() {
    this.psqMg = [0, 0];
    this.psqEg = [0, 0];
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = this.board[sq];
      if (pc !== T.NO_PIECE) {
        const color = T.color_of(pc);
        const pt = T.type_of_piece(pc);
        const relSq = color === T.WHITE ? sq : T.flip_rank_sq(sq);
        // Use simplified PSQ (piece value only, actual PSQT in evaluate.js)
        this.psqMg[color] += T.PieceValue[0][pt];
        this.psqEg[color] += T.PieceValue[1][pt];
      }
    }
  }

  // Material difference (from white's perspective)
  material_diff() {
    let diff = 0;
    for (let pt = T.ROOK; pt <= T.BISHOP; pt++) {
      diff += (T.PieceValue[0][pt] + T.PieceValue[1][pt]) / 2 *
              (this.piecesByType[pt] - this.piecesByType[pt + 8]);
    }
    return diff;
  }

  // Check if square is in palace
  isInPalace(sq, color) {
    return color === T.WHITE ? T.PALACE_WHITE.has(sq) : T.PALACE_BLACK.has(sq);
  }

  // Check if a move is pseudo-legal (doesn't check if it leaves king in check)
  pseudoLegalMove(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    if (!T.is_ok_sq(from) || !T.is_ok_sq(to) || from === to) return false;
    const pc = this.board[from];
    if (pc === T.NO_PIECE) return false;
    if (T.color_of(pc) !== this.sideToMove) return false;
    return true;
  }

  // Check if a move is legal
  legalMove(m) {
    if (!this.pseudoLegalMove(m)) return false;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.board[from];
    const captured = this.board[to];
    const pt = T.type_of_piece(pc);

    // Can't capture own piece
    if (captured !== T.NO_PIECE && T.color_of(captured) === this.sideToMove) return false;

    switch (pt) {
      case T.KING:
        if (!T.PALACE_WHITE.has(to) && !T.PALACE_BLACK.has(to)) return false;
        if (!BB.kingAttacks[from].includes(to)) return false;
        break;
      case T.ADVISOR:
        if (!T.PALACE_WHITE.has(to) && !T.PALACE_BLACK.has(to)) return false;
        if (!BB.advisorAttacks[from].includes(to)) return false;
        break;
      case T.BISHOP: {
        const idx = BB.bishopAttacks[from].indexOf(to);
        if (idx === -1) return false;
        // Check eye (blocking square)
        const eye = BB.bishopPins[from][idx];
        if (this.board[eye] !== T.NO_PIECE) return false;
        break;
      }
      case T.KNIGHT: {
        const idx = BB.knightAttacks[from].indexOf(to);
        if (idx === -1) return false;
        // Check pin (blocking square)
        const pin = BB.knightPins[from][idx];
        if (this.board[pin] !== T.NO_PIECE) return false;
        break;
      }
      case T.ROOK: {
        if (T.file_of(from) !== T.file_of(to) && T.rank_of(from) !== T.rank_of(to)) return false;
        const between = BB.betweenSquares(from, to);
        for (const sq of between) {
          if (this.board[sq] !== T.NO_PIECE) return false;
        }
        break;
      }
      case T.CANNON: {
        if (T.file_of(from) !== T.file_of(to) && T.rank_of(from) !== T.rank_of(to)) return false;
        const between = BB.betweenSquares(from, to);
        if (captured === T.NO_PIECE) {
          // No capture: no pieces between
          for (const sq of between) {
            if (this.board[sq] !== T.NO_PIECE) return false;
          }
        } else {
          // Capture: exactly one piece between (screen)
          let screenCount = 0;
          for (const sq of between) {
            if (this.board[sq] !== T.NO_PIECE) screenCount++;
          }
          if (screenCount !== 1) return false;
        }
        break;
      }
      case T.PAWN: {
        const forward = BB.pawnAttacksForward[from];
        if (to === forward) return true;
        // Side moves only after crossing river
        const color = this.sideToMove;
        const crossed = color === T.WHITE ?
          T.rank_of(from) >= T.RANK_5 : T.rank_of(from) <= T.RANK_4;
        if (!crossed) return false;
        const captures = color === T.WHITE ?
          BB.pawnCapturesWhite[from] : BB.pawnCapturesBlack[from];
        return captures.includes(to);
      }
      default:
        return false;
    }

    // Check for flying general rule
    // Make the move temporarily and check if kings face each other
    const savedBoard = new Int8Array(this.board);
    const savedZobrist = this.zobristKey;
    this.board[to] = pc;
    this.board[from] = T.NO_PIECE;
    // Recalculate zobrist quickly
    this.zobristKey = savedZobrist ^ T.zobrist_piece[pc][from] ^
                      (captured !== T.NO_PIECE ? T.zobrist_piece[captured][to] : 0) ^
                      T.zobrist_piece[pc][to];
    const flyingGeneral = this.kingsFacing();
    // Restore
    this.board.set(savedBoard);
    this.zobristKey = savedZobrist;
    return !flyingGeneral;
  }

  // Check if kings are facing each other on same file with no pieces between
  kingsFacing() {
    let whiteKing = -1, blackKing = -1;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      if (this.board[sq] === T.W_KING) whiteKing = sq;
      else if (this.board[sq] === T.B_KING) blackKing = sq;
    }
    if (whiteKing === -1 || blackKing === -1) return false;
    if (T.file_of(whiteKing) !== T.file_of(blackKing)) return false;
    // Check if any pieces between
    const minR = Math.min(T.rank_of(whiteKing), T.rank_of(blackKing));
    const maxR = Math.max(T.rank_of(whiteKing), T.rank_of(blackKing));
    for (let r = minR + 1; r < maxR; r++) {
      if (this.board[T.make_square(T.file_of(whiteKing), r)] !== T.NO_PIECE) return false;
    }
    return true;
  }

  // Check if current side to move is in check
  checkers() {
    const us = this.sideToMove;
    const them = 1 - us;
    let kingSq = -1;
    const kingPc = us === T.WHITE ? T.W_KING : T.B_KING;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      if (this.board[sq] === kingPc) { kingSq = sq; break; }
    }
    if (kingSq === -1) return false; // Should not happen

    const themRook = them === T.WHITE ? T.W_ROOK : T.B_ROOK;
    const themCannon = them === T.WHITE ? T.W_CANNON : T.B_CANNON;
    const themKnight = them === T.WHITE ? T.W_KNIGHT : T.B_KNIGHT;
    const themPawn = them === T.WHITE ? T.W_PAWN : T.B_PAWN;
    const themKing = them === T.WHITE ? T.W_KING : T.B_KING;
    const usSide = us; // for pawn forward check

    // Rook/Cannon checks (sliding)
    for (const dir of BB.lineDirs) {
      let s = kingSq;
      let screenFound = false;
      while (true) {
        const nf = T.file_of(s) + (dir === T.EAST ? 1 : dir === T.WEST ? -1 : 0);
        const nr = T.rank_of(s) + (dir === T.NORTH ? 1 : dir === T.SOUTH ? -1 : 0);
        if (nf < T.FILE_A || nf > T.FILE_I || nr < T.RANK_0 || nr > T.RANK_9) break;
        s = T.make_square(nf, nr);
        const pc = this.board[s];
        if (pc === T.NO_PIECE) continue;
        if (!screenFound) {
          if (pc === themRook || pc === themKing) return true;
          screenFound = true;
        } else {
          if (pc === themCannon) return true;
          break;
        }
      }
    }

    // Knight checks
    for (let i = 0; i < BB.knightAttacks[kingSq].length; i++) {
      if (this.board[BB.knightAttacks[kingSq][i]] === themKnight) {
        const pin = BB.knightPins[kingSq][i];
        if (this.board[pin] === T.NO_PIECE) return true;
      }
    }

    // Pawn checks
    // Pawns attack forward and sideways (if crossed river)
    if (T.rank_of(kingSq) > T.RANK_0) {
      const sqBelow = T.make_square(T.file_of(kingSq), T.rank_of(kingSq) - 1);
      if (us === T.WHITE && this.board[sqBelow] === themPawn) return true;
    }
    if (T.rank_of(kingSq) < T.RANK_9) {
      const sqAbove = T.make_square(T.file_of(kingSq), T.rank_of(kingSq) + 1);
      if (us === T.BLACK && this.board[sqAbove] === themPawn) return true;
    }
    // Side pawn attacks
    const crossedRiver = us === T.WHITE ?
      T.rank_of(kingSq) >= T.RANK_5 : T.rank_of(kingSq) <= T.RANK_4;
    if (crossedRiver || true) { // Enemy pawns can attack sideways from their perspective
      if (T.file_of(kingSq) > T.FILE_A) {
        const sqLeft = T.make_square(T.file_of(kingSq) - 1, T.rank_of(kingSq));
        if (this.board[sqLeft] === themPawn) {
          // Check if pawn has crossed from its perspective
          const pawnCrossed = (them === T.WHITE && T.rank_of(sqLeft) >= T.RANK_5) ||
                              (them === T.BLACK && T.rank_of(sqLeft) <= T.RANK_4);
          if (pawnCrossed) return true;
        }
      }
      if (T.file_of(kingSq) < T.FILE_I) {
        const sqRight = T.make_square(T.file_of(kingSq) + 1, T.rank_of(kingSq));
        if (this.board[sqRight] === themPawn) {
          const pawnCrossed = (them === T.WHITE && T.rank_of(sqRight) >= T.RANK_5) ||
                              (them === T.BLACK && T.rank_of(sqRight) <= T.RANK_4);
          if (pawnCrossed) return true;
        }
      }
    }

    return false;
  }

  // Make a move (with full history tracking)
  makeMove(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.board[from];
    const captured = this.board[to];

    // Save state for undo
    const state = {
      move: m,
      captured,
      zobristKey: this.zobristKey,
      rule60: this.rule60,
      psqMg: [...this.psqMg],
      psqEg: [...this.psqEg],
      piecesByType: Int32Array.from(this.piecesByType)
    };
    this.history.push(state);

    // Update board
    this.board[from] = T.NO_PIECE;
    this.board[to] = pc;

    // Update zobrist
    this.zobristKey ^= T.zobrist_piece[pc][from] ^ T.zobrist_piece[pc][to];
    if (captured !== T.NO_PIECE) {
      this.zobristKey ^= T.zobrist_piece[captured][to];
      const captColor = T.color_of(captured);
      const captPt = T.type_of_piece(captured);
      this.piecesByType[captPt]--;
      this.psqMg[captColor] -= T.PieceValue[0][captPt];
      this.psqEg[captColor] -= T.PieceValue[1][captPt];
    }

    this.piecesByColor[this.sideToMove]--;
    this.piecesByColor[this.sideToMove]++;

    // Update 60-move rule
    if (T.type_of_piece(pc) === T.PAWN || captured !== T.NO_PIECE) {
      this.rule60 = 0;
    } else {
      this.rule60++;
    }

    // Switch side
    this.sideToMove = 1 - this.sideToMove;
    this.zobristKey ^= T.zobrist_side;
    this.gamePly++;
    this.moveList.push(m);
    this.keyHistory.push(this.zobristKey);

    return true;
  }

  // Undo the last move
  undoMove() {
    if (this.history.length === 0) return;
    const state = this.history.pop();
    const m = state.move;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.board[to];

    // Restore board
    this.board[to] = state.captured;
    this.board[from] = pc;

    // Restore state
    this.zobristKey = state.zobristKey;
    this.rule60 = state.rule60;
    this.psqMg = state.psqMg;
    this.psqEg = state.psqEg;
    this.piecesByType = state.piecesByType;
    this.sideToMove = 1 - this.sideToMove;
    this.gamePly--;
    this.moveList.pop();
    this.keyHistory.pop();

    // Restore piece color counts
    if (state.captured !== T.NO_PIECE) {
      this.piecesByColor[T.color_of(state.captured)]++;
    }
  }

  // Null move (for null-move pruning)
  makeNullMove() {
    const state = {
      move: T.MOVE_NULL,
      captured: T.NO_PIECE,
      zobristKey: this.zobristKey,
      rule60: this.rule60,
      psqMg: [...this.psqMg],
      psqEg: [...this.psqEg],
      piecesByType: Int32Array.from(this.piecesByType)
    };
    this.history.push(state);
    this.rule60++;
    this.sideToMove = 1 - this.sideToMove;
    this.zobristKey ^= T.zobrist_side;
    this.gamePly++;
    this.moveList.push(T.MOVE_NULL);
    this.keyHistory.push(this.zobristKey);
  }

  undoNullMove() {
    const state = this.history.pop();
    this.zobristKey = state.zobristKey;
    this.rule60 = state.rule60;
    this.sideToMove = 1 - this.sideToMove;
    this.gamePly--;
    this.moveList.pop();
    this.keyHistory.pop();
  }

  // Parse FEN string and set up the position
  fromFen(fen) {
    this.board = new Int8Array(T.SQUARE_NB);
    this.piecesByColor = [0, 0]; // Simplified: just count pieces per color
    this.piecesByType = new Int32Array(T.KING + 1);
    this.zobristKey = 0;
    this.history = [];
    this.gamePly = 0;
    this.rule60 = 0;
    this.moveList = [];
    this.keyHistory = [];

    const parts = fen.split(' ');
    const placement = parts[0];
    const sideStr = parts[1] || 'w';

    // Parse placement - FEN format: ranks from 9 down to 0
    let rank = T.RANK_9;
    let file = T.FILE_A;
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      if (ch === '/') {
        rank--;
        file = T.FILE_A;
        continue;
      }
      if (ch >= '1' && ch <= '9') {
        file += parseInt(ch);
        continue;
      }

      let pc;
      const upper = ch.toUpperCase();
      switch (upper) {
        case 'K': pc = upper === ch ? T.W_KING : T.B_KING; break;
        case 'A': pc = upper === ch ? T.W_ADVISOR : T.B_ADVISOR; break;
        case 'B': case 'E': pc = upper === ch ? T.W_BISHOP : T.B_BISHOP; break;
        case 'N': case 'H': pc = upper === ch ? T.W_KNIGHT : T.B_KNIGHT; break;
        case 'R': pc = upper === ch ? T.W_ROOK : T.B_ROOK; break;
        case 'C': pc = upper === ch ? T.W_CANNON : T.B_CANNON; break;
        case 'P': pc = upper === ch ? T.W_PAWN : T.B_PAWN; break;
        default: continue;
      }

      const sq = T.make_square(file, rank);
      this.board[sq] = pc;
      const color = T.color_of(pc);
      this.piecesByColor[color]++;
      const pt = T.type_of_piece(pc);
      this.piecesByType[pt]++;
      this.zobristKey ^= T.zobrist_piece[pc][sq];
      file++;
    }

    this.sideToMove = sideStr === 'w' ? T.WHITE : T.BLACK;
    if (this.sideToMove === T.BLACK) {
      this.zobristKey ^= T.zobrist_side;
    }
    this.keyHistory.push(this.zobristKey);
    this.initPsq();
  }

  // Convert position to FEN string
  toFen() {
    let fen = '';
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      let empty = 0;
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        const pc = this.board[sq];
        if (pc === T.NO_PIECE) {
          empty++;
        } else {
          if (empty > 0) {
            fen += empty;
            empty = 0;
          }
          const pt = T.type_of_piece(pc);
          const color = T.color_of(pc);
          let ch;
          switch (pt) {
            case T.KING: ch = 'K'; break;
            case T.ADVISOR: ch = 'A'; break;
            case T.BISHOP: ch = 'B'; break;
            case T.KNIGHT: ch = 'N'; break;
            case T.ROOK: ch = 'R'; break;
            case T.CANNON: ch = 'C'; break;
            case T.PAWN: ch = 'P'; break;
          }
          fen += color === T.WHITE ? ch.toUpperCase() : ch.toLowerCase();
        }
      }
      if (empty > 0) fen += empty;
      if (r > T.RANK_0) fen += '/';
    }
    fen += this.sideToMove === T.WHITE ? ' w' : ' b';
    return fen;
  }

  // Find king square for a color
  kingSquare(color) {
    const kingPc = color === T.WHITE ? T.W_KING : T.B_KING;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      if (this.board[sq] === kingPc) return sq;
    }
    return -1;
  }

  // Count pieces of a type for a color
  countPiece(color, pt) {
    const startPc = T.make_piece(color, pt);
    return this.piecesByType[pt];
  }

  // Get piece on square
  pieceOn(sq) {
    return this.board[sq];
  }

  // Check for repetition (returns 0 if no repetition, 1+ otherwise)
  repetition(minRepeats = 1) {
    const currentKey = this.zobristKey;
    let count = 0;
    for (let i = this.keyHistory.length - 2; i >= 0; i--) {
      if (this.keyHistory[i] === currentKey) {
        count++;
        if (count >= minRepeats) return count;
      }
    }
    return count;
  }
}

module.exports = Position;
