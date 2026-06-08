"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');

// ==============================================
// Zobrist hashing keys
// ==============================================

const Zobrist = {
  psq: new Array(T.PIECE_NB),
  side: 0
};

function init_zobrist() {
  let seed = 1070372;
  function rand() {
    seed = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    const high = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    return BigInt(seed) | (BigInt(high) << 32n);
  }
  
  const pieces = [T.W_ROOK, T.W_ADVISOR, T.W_CANNON, T.W_PAWN, T.W_KNIGHT, T.W_BISHOP, T.W_KING,
                  T.B_ROOK, T.B_ADVISOR, T.B_CANNON, T.B_PAWN, T.B_KNIGHT, T.B_BISHOP, T.B_KING];
  
  for (const pc of pieces) {
    Zobrist.psq[pc] = new Array(T.SQUARE_NB);
    for (let sq = 0; sq < T.SQUARE_NB; sq++) {
      Zobrist.psq[pc][sq] = rand();
    }
  }
  Zobrist.side = rand();
}

// ==============================================
// StateInfo
// ==============================================

class StateInfo {
  constructor() {
    this.key = 0n;
    this.materialKey = 0n;
    this.material = [0, 0];
    this.check10 = [0, 0];
    this.rule60 = 0;
    this.pliesFromNull = 0;
    this.checkersBB = 0n;
    this.previous = null;
    this.blockersForKing = [0n, 0n];
    this.pinners = [0n, 0n];
    this.checkSquares = new Array(T.PIECE_TYPE_NB).fill(0n);
    this.needSlowCheck = false;
    this.capturedPiece = T.NO_PIECE;
  }
  
  clone() {
    const st = new StateInfo();
    Object.assign(st, this);
    st.checkSquares = [...this.checkSquares];
    return st;
  }
}

// ==============================================
// Position class
// ==============================================

class Position {
  constructor() {
    this.board = new Array(T.SQUARE_NB).fill(T.NO_PIECE);
    this.byTypeBB = new Array(T.PIECE_TYPE_NB).fill(0n);
    this.byColorBB = [0n, 0n];
    this.pieceCount = new Array(T.PIECE_NB).fill(0);
    this.sideToMove = T.WHITE;
    this.gamePly = 0;
    this.psq = 0;
    this.st = new StateInfo();
  }
  
  set(fenStr, si) {
    // Clear all
    this.board.fill(T.NO_PIECE);
    this.byTypeBB.fill(0n);
    this.byColorBB = [0n, 0n];
    this.pieceCount.fill(0);
    this.psq = 0;
    this.sideToMove = T.WHITE;
    this.gamePly = 0;
    
    const tokens = fenStr.trim().split(/\s+/);
    let idx = 0;
    let sq = T.SQ_A9;
    
    const PieceToChar = " RACPNBK racpnbk";
    
    // Parse piece placement
    while (idx < tokens[0].length) {
      const c = tokens[0][idx];
      if (c >= '1' && c <= '9') {
        sq += (parseInt(c)) * T.EAST;
      } else if (c === '/') {
        sq += 2 * T.SOUTH;
      } else {
        const charIdx = PieceToChar.indexOf(c);
        if (charIdx !== -1) {
          this.put_piece(charIdx, sq);
          sq++;
        }
      }
      idx++;
    }
    
    // Parse active color
    if (tokens.length > 1) {
      this.sideToMove = tokens[1] === 'w' ? T.WHITE : T.BLACK;
    }
    
    // Parse halfmove and fullmove
    if (tokens.length > 4) {
      this.st.rule60 = parseInt(tokens[4]) || 0;
    }
    if (tokens.length > 5) {
      let fullmove = parseInt(tokens[5]) || 1;
      this.gamePly = Math.max(2 * (fullmove - 1), 0) + (this.sideToMove === T.BLACK ? 1 : 0);
    }
    
    this.st = si || new StateInfo();
    this.set_state(this.st);
    
    return this;
  }
  
  fen() {
    const PieceToChar = " RACPNBK racpnbk";
    let s = '';
    
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      let emptyCnt = 0;
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        if (this.empty(sq)) {
          emptyCnt++;
        } else {
          if (emptyCnt) {
            s += emptyCnt;
            emptyCnt = 0;
          }
          s += PieceToChar[this.board[sq]];
        }
      }
      if (emptyCnt) s += emptyCnt;
      if (r > T.RANK_0) s += '/';
    }
    
    s += this.sideToMove === T.WHITE ? ' w ' : ' b ';
    s += '- - ' + this.st.rule60 + ' ' + (1 + (this.gamePly - (this.sideToMove === T.BLACK ? 1 : 0)) / 2);
    
    return s;
  }
  
  // Put a piece on a square
  put_piece(pc, sq) {
    this.board[sq] = pc;
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    this.byTypeBB[T.ALL_PIECES] |= (1n << BigInt(sq));
    this.byTypeBB[pt] |= (1n << BigInt(sq));
    this.byColorBB[c] |= (1n << BigInt(sq));
    
    this.pieceCount[pc]++;
    this.pieceCount[T.make_piece(c, T.ALL_PIECES)]++;
    this.psq += PSQT.psq_score(pc, sq);
  }
  
  // Remove a piece from a square
  remove_piece(sq) {
    const pc = this.board[sq];
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    const sqBit = 1n << BigInt(sq);
    this.byTypeBB[T.ALL_PIECES] ^= sqBit;
    this.byTypeBB[pt] ^= sqBit;
    this.byColorBB[c] ^= sqBit;
    
    this.board[sq] = T.NO_PIECE;
    this.pieceCount[pc]--;
    this.pieceCount[T.make_piece(c, T.ALL_PIECES)]--;
    this.psq -= PSQT.psq_score(pc, sq);
  }
  
  // Move a piece
  move_piece(from, to) {
    const pc = this.board[from];
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    const fromToBit = (1n << BigInt(from)) | (1n << BigInt(to));
    this.byTypeBB[T.ALL_PIECES] ^= fromToBit;
    this.byTypeBB[pt] ^= fromToBit;
    this.byColorBB[c] ^= fromToBit;
    
    this.board[from] = T.NO_PIECE;
    this.board[to] = pc;
    this.psq += PSQT.psq_score(pc, to) - PSQT.psq_score(pc, from);
  }
  
  piece_on(sq) { return this.board[sq]; }
  empty(sq) { return this.board[sq] === T.NO_PIECE; }
  
  pieces(ptOrColor, pt) {
    if (typeof pt === 'undefined') {
      if (typeof ptOrColor === 'undefined') {
        return this.byTypeBB[T.ALL_PIECES];
      }
      return (ptOrColor === T.WHITE || ptOrColor === T.BLACK) 
        ? this.byColorBB[ptOrColor] 
        : this.byTypeBB[ptOrColor];
    } else {
      return this.byColorBB[ptOrColor] & this.byTypeBB[pt];
    }
  }
  
  count(pt, c) {
    if (typeof c === 'undefined') {
      return this.count(pt, T.WHITE) + this.count(pt, T.BLACK);
    }
    return this.pieceCount[T.make_piece(c, pt)];
  }
  
  square(pt, c) {
    const b = this.byColorBB[c] & this.byTypeBB[pt];
    if (b !== 0n) {
      return B.lsb(b);
    }
    return T.SQ_NONE;
  }
  
  side_to_move() { return this.sideToMove; }
  psq_score() { return this.psq; }
  
  // Checking
  checkers() { return this.st.checkersBB; }
  in_check() { return this.st.checkersBB !== 0n; }
  check_squares(pt) { return this.st.checkSquares[pt]; }
  blockers_for_king(c) { return this.st.blockersForKing[c]; }
  pinners(c) { return this.st.pinners[c]; }
  
  // Attacks
  attackers_to(s, occupied) {
    if (typeof occupied === 'undefined') {
      occupied = this.byTypeBB[T.ALL_PIECES];
    }
    
    return (B.pawn_attacks_to_bb(T.WHITE, s) & this.byColorBB[T.WHITE] & this.byTypeBB[T.PAWN])
         | (B.pawn_attacks_to_bb(T.BLACK, s) & this.byColorBB[T.BLACK] & this.byTypeBB[T.PAWN])
         | (B.attacks_bb(T.KNIGHT, s, occupied) & this.byTypeBB[T.KNIGHT])
         | (B.attacks_bb(T.ROOK, s, occupied) & this.byTypeBB[T.ROOK])
         | (B.attacks_bb(T.CANNON, s, occupied) & this.byTypeBB[T.CANNON])
         | (B.attacks_bb(T.BISHOP, s, occupied) & this.byTypeBB[T.BISHOP])
         | (B.PseudoAttacks[T.ADVISOR][s] & this.byTypeBB[T.ADVISOR])
         | (B.PseudoAttacks[T.KING][s] & this.byTypeBB[T.KING]);
  }
  
  checkers_to(c, s, occupied) {
    if (typeof occupied === 'undefined') {
      occupied = this.byTypeBB[T.ALL_PIECES];
    }
    const color = c & 1; // Ensure color is 0 or 1
    
    return ((B.pawn_attacks_to_bb(color, s) & this.byTypeBB[T.PAWN])
          | (B.attacks_bb(T.KNIGHT, s, occupied) & this.byTypeBB[T.KNIGHT])
          | (B.attacks_bb(T.ROOK, s, occupied) & (this.byTypeBB[T.KING] | this.byTypeBB[T.ROOK]))
          | (B.attacks_bb(T.CANNON, s, occupied) & this.byTypeBB[T.CANNON]))
          & this.byColorBB[color];
  }
  
  // Properties of moves
  legal(m) {
    const us = this.sideToMove;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    
    if (pc === T.NO_PIECE || T.color_of(pc) !== us) return false;
    
    const occupied = (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to));
    const pt = T.type_of(pc);
    const ksq = pt === T.KING ? to : this.square(T.KING, us);
    
    if (!this.st.needSlowCheck && ksq !== to && !(this.st.blockersForKing[us] & (1n << BigInt(from)))) {
      return true;
    }
    
    if (pt === T.KING) {
      return !(this.checkers_to(~us & 1, to, occupied));
    }
    
    return !(this.checkers_to(~us & 1, ksq, occupied) & ~(1n << BigInt(to)));
  }
  
  gives_check(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const ksq = this.square(T.KING, ~this.sideToMove & 1);
    const pt = T.type_of(this.piece_on(from));
    
    if (pt === T.CANNON) {
      if (B.attacks_bb(T.CANNON, to, (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to))) & (1n << BigInt(ksq))) {
        return true;
      }
    } else if (this.st.checkSquares[pt] & (1n << BigInt(to))) {
      return true;
    }
    
    if (B.attacks_bb(T.ROOK, ksq, this.byTypeBB[T.ALL_PIECES]) & this.byColorBB[this.sideToMove] & this.byTypeBB[T.CANNON]) {
      return this.checkers_to(this.sideToMove, ksq, (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to)));
    } else if ((this.st.blockersForKing[~this.sideToMove & 1] & (1n << BigInt(from))) && !B.aligned(from, to, ksq)) {
      return true;
    }
    
    return false;
  }
  
  // Doing and undoing moves
  do_move(m, newSt, givesCheck) {
    if (typeof givesCheck === 'undefined') {
      givesCheck = this.gives_check(m);
    }
    
    const us = this.sideToMove;
    const them = ~us & 1;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    const captured = this.piece_on(to);
    
    // Copy state
    if (newSt) {
      this.st.materialKey = newSt.materialKey;
      this.st.material[0] = newSt.material[0];
      this.st.material[1] = newSt.material[1];
      this.st.check10[0] = newSt.check10[0];
      this.st.check10[1] = newSt.check10[1];
      this.st.rule60 = newSt.rule60;
      this.st.pliesFromNull = newSt.pliesFromNull;
      this.st.previous = newSt.previous;
    }
    
    this.st.previous = this.st;
    this.st.move = m;
    
    ++this.gamePly;
    this.st.rule60++;
    ++this.st.pliesFromNull;
    
    if (captured) {
      this.st.material[them] -= T.PieceValue[T.MG][captured];
      this.remove_piece(to);
      this.st.materialKey ^= Zobrist.psq[captured][this.pieceCount[captured]];
      this.st.check10[0] = 0;
      this.st.check10[1] = 0;
      this.st.rule60 = 0;
    }
    
    let k = this.st.key ^ Zobrist.side;
    k ^= Zobrist.psq[pc][from] ^ Zobrist.psq[pc][to];
    
    this.move_piece(from, to);
    
    this.st.capturedPiece = captured;
    this.st.key = k;
    
    this.st.checkersBB = givesCheck ? this.checkers_to(us, this.square(T.KING, them)) : 0n;
    
    this.sideToMove = them;
    
    this.set_check_info(this.st);
  }
  
  undo_move(m) {
    this.sideToMove = ~this.sideToMove & 1;
    
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    
    this.move_piece(to, from);
    
    if (this.st.capturedPiece !== T.NO_PIECE) {
      this.put_piece(this.st.capturedPiece, to);
    }
    
    this.st = this.st.previous;
    --this.gamePly;
  }
  
  // Set state
  set_state(si) {
    si.key = 0n;
    si.materialKey = 0n;
    si.material[0] = 0;
    si.material[1] = 0;
    si.checkersBB = this.checkers_to(~this.sideToMove & 1, this.square(T.KING, this.sideToMove));
    
    this.set_check_info(si);
    
    let b = this.byTypeBB[T.ALL_PIECES];
    while (b !== 0n) {
      let sq, newB;
      [sq, newB] = B.pop_lsb(b);
      b = newB;
      const pc = this.piece_on(sq);
      si.key ^= Zobrist.psq[pc][sq];
      
      if (T.type_of(pc) !== T.KING) {
        si.material[T.color_of(pc)] += T.PieceValue[T.MG][pc];
      }
    }
    
    if (this.sideToMove === T.BLACK) {
      si.key ^= Zobrist.side;
    }
    
    const pieces = [T.W_ROOK, T.W_ADVISOR, T.W_CANNON, T.W_PAWN, T.W_KNIGHT, T.W_BISHOP, T.W_KING,
                    T.B_ROOK, T.B_ADVISOR, T.B_CANNON, T.B_PAWN, T.B_KNIGHT, T.B_BISHOP, T.B_KING];
    
    for (const pc of pieces) {
      for (let cnt = 0; cnt < this.pieceCount[pc]; cnt++) {
        si.materialKey ^= Zobrist.psq[pc][cnt];
      }
    }
  }
  
  set_check_info(si) {
    const us = this.sideToMove;
    const them = ~us & 1;
    const uksq = this.square(T.KING, us);
    const oksq = this.square(T.KING, them);
    
    const themPieces = this.byColorBB[them];
    const usPieces = this.byColorBB[us];
    
    const themResult = this.blockers_for_king(themPieces, uksq);
    si.blockersForKing[us] = themResult.blockers;
    si.pinners[them] = themResult.pinners;
    
    const usResult = this.blockers_for_king(usPieces, oksq);
    si.blockersForKing[them] = usResult.blockers;
    si.pinners[us] = usResult.pinners;
    
    si.needSlowCheck = si.checkersBB !== 0n || 
      (B.attacks_bb(T.ROOK, uksq, this.byTypeBB[T.ALL_PIECES]) & this.byColorBB[them] & this.byTypeBB[T.CANNON]);
    
    si.checkSquares[T.PAWN] = B.pawn_attacks_to_bb(this.sideToMove, oksq);
    si.checkSquares[T.KNIGHT] = B.attacks_bb(T.KNIGHT, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.CANNON] = B.attacks_bb(T.CANNON, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.ROOK] = B.attacks_bb(T.ROOK, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.ADVISOR] = 0n;
    si.checkSquares[T.BISHOP] = 0n;
    si.checkSquares[T.KING] = 0n;
  }
  
  blockers_for_king(sliders, s) {
    let blockers = 0n;
    let pinners = 0n;
    
    const snipers = (
      (B.attacks_bb(T.ROOK, s, this.byTypeBB[T.ALL_PIECES]) & (this.byTypeBB[T.ROOK] | this.byTypeBB[T.CANNON] | this.byTypeBB[T.KING])) |
      (B.attacks_bb(T.KNIGHT, s, this.byTypeBB[T.ALL_PIECES]) & this.byTypeBB[T.KNIGHT])
    ) & sliders;
    
    const occupancy = this.byTypeBB[T.ALL_PIECES] ^ (snipers & ~this.byTypeBB[T.CANNON]);
    
    let snipersCopy = snipers;
    while (snipersCopy !== 0n) {
      let sniperSq, newSnipers;
      [sniperSq, newSnipers] = B.pop_lsb(snipersCopy);
      snipersCopy = newSnipers;
      const isCannon = T.type_of(this.piece_on(sniperSq)) === T.CANNON;
      
      let b;
      if (isCannon) {
        b = B.between_bb(s, sniperSq) & (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(sniperSq)));
      } else {
        b = B.between_bb(s, sniperSq) & occupancy;
      }
      
      if (b !== 0n) {
        const pop = B.popcount(b);
        if ((!isCannon && pop <= 1) || (isCannon && pop === 2)) {
          blockers |= b;
          if (b & this.byColorBB[T.color_of(this.piece_on(s))]) {
            pinners |= (1n << BigInt(sniperSq));
          }
        }
      }
    }
    
    return { blockers, pinners };
  }
  
  // Move generation
  generate_moves() {
    const moves = [];
    const us = this.sideToMove;
    let pieces = this.byColorBB[us];
    
    while (pieces !== 0n) {
      let from, newPieces;
      [from, newPieces] = B.pop_lsb(pieces);
      pieces = newPieces;
      const pc = this.board[from];
      const pt = T.type_of(pc);
      
      // Generate pseudo-legal moves
      const pseudoMoves = this.generate_pseudo_moves(pc, from);
      
      // Filter legal moves
      for (const to of pseudoMoves) {
        const m = T.make_move(from, to);
        if (this.legal(m)) {
          moves.push(m);
        }
      }
    }
    
    return moves;
  }
  
  generate_pseudo_moves(pc, from) {
    const moves = [];
    const pt = T.type_of(pc);
    const us = T.color_of(pc);
    const toSq = T.to_sq;
    
    let attacks;
    switch (pt) {
      case T.KING:
        attacks = B.PseudoAttacks[T.KING][from];
        break;
      case T.ADVISOR:
        attacks = B.PseudoAttacks[T.ADVISOR][from];
        break;
      case T.BISHOP:
        attacks = B.PseudoAttacks[T.BISHOP][from];
        break;
      case T.KNIGHT:
        attacks = B.PseudoAttacks[T.KNIGHT][from];
        break;
      case T.ROOK:
        attacks = B.attacks_bb(T.ROOK, from, this.byTypeBB[T.ALL_PIECES]);
        break;
      case T.CANNON:
        attacks = B.attacks_bb(T.CANNON, from, this.byTypeBB[T.ALL_PIECES]);
        break;
      case T.PAWN:
        attacks = B.pawn_attacks_bb(us, from);
        break;
      default:
        return moves;
    }
    
    let b = attacks;
    while (b !== 0n) {
      let to, newB;
      [to, newB] = B.pop_lsb(b);
      b = newB;
      if (!(this.byColorBB[us] & (1n << BigInt(to)))) {
        moves.push(to);
      }
    }
    
    return moves;
  }
  
  is_on_semiopen_file(c, s) {
    return !(this.byColorBB[c] & this.byTypeBB[T.PAWN] & B.file_bb(s));
  }
  
  // Clone position
  clone() {
    const pos = new Position();
    pos.board = [...this.board];
    pos.byTypeBB = [...this.byTypeBB];
    pos.byColorBB = [...this.byColorBB];
    pos.pieceCount = [...this.pieceCount];
    pos.sideToMove = this.sideToMove;
    pos.gamePly = this.gamePly;
    pos.psq = this.psq;
    pos.st = this.st.clone();
    return pos;
  }
  
  // Pretty print board
  pretty() {
    const PieceToChar = " RACPNBK racpnbk";
    let s = '  +---+---+---+---+---+---+---+---+---+\n';
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      s += r + ' |';
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        const pc = this.piece_on(sq);
        s += ' ' + PieceToChar[pc] + ' |';
      }
      s += '\n  +---+---+---+---+---+---+---+---+---+\n';
    }
    s += '    a   b   c   d   e   f   g   h   i\n';
    s += '  Side to move: ' + (this.sideToMove === T.WHITE ? 'white' : 'black') + '\n';
    s += '  FEN: ' + this.fen() + '\n';
    return s;
  }
}

// Initialize
function init() {
  init_zobrist();
}

module.exports = {
  Position,
  StateInfo,
  init
};
