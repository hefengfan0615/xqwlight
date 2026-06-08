"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');

// ==============================================
// Zobrist hashing keys
// ==============================================

const Zobrist = {
  psq: new Array(T.PIECE_NB),
  side: 0
};

// Initialize Zobrist keys with a simple PRNG
function init_zobrist() {
  let seed = 1070372;
  function prng() {
    seed = seed * 1103515245 + 12345;
    return seed;
  }
  
  for (let pc = 0; pc < T.PIECE_NB; pc++) {
    Zobrist.psq[pc] = new Array(T.SQUARE_NB);
    for (let sq = 0; sq < T.SQUARE_NB; sq++) {
      Zobrist.psq[pc][sq] = prng() + '_' + prng(); // Use string to simulate 64-bit key
    }
  }
  Zobrist.side = prng() + '_' + prng();
}

// ==============================================
// StateInfo - for undoing moves
// ==============================================

class StateInfo {
  constructor() {
    this.key = '';
    this.materialKey = '';
    this.checkersBB = new B.Bitboard();
    this.blockersForKing = new Array(T.COLOR_NB);
    this.pinners = new Array(T.COLOR_NB);
    this.checkSquares = new Array(T.PIECE_TYPE_NB);
    for (let c = 0; c < T.COLOR_NB; c++) {
      this.blockersForKing[c] = new B.Bitboard();
      this.pinners[c] = new B.Bitboard();
    }
    for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
      this.checkSquares[pt] = new B.Bitboard();
    }
    this.needSlowCheck = false;
    this.capturedPiece = T.NO_PIECE;
    this.rule60 = 0;
    this.pliesFromNull = 0;
    this.previous = null;
  }
  
  clone() {
    const st = new StateInfo();
    st.key = this.key;
    st.materialKey = this.materialKey;
    st.checkersBB = this.checkersBB.clone();
    for (let c = 0; c < T.COLOR_NB; c++) {
      st.blockersForKing[c] = this.blockersForKing[c].clone();
      st.pinners[c] = this.pinners[c].clone();
    }
    for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
      st.checkSquares[pt] = this.checkSquares[pt].clone();
    }
    st.needSlowCheck = this.needSlowCheck;
    st.capturedPiece = this.capturedPiece;
    st.rule60 = this.rule60;
    st.pliesFromNull = this.pliesFromNull;
    return st;
  }
}

// ==============================================
// Position class
// ==============================================

class Position {
  constructor() {
    this.board = new Array(T.SQUARE_NB).fill(T.NO_PIECE);
    this.byTypeBB = new Array(T.PIECE_TYPE_NB);
    this.byColorBB = new Array(T.COLOR_NB);
    for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
      this.byTypeBB[pt] = new B.Bitboard();
    }
    for (let c = 0; c < T.COLOR_NB; c++) {
      this.byColorBB[c] = new B.Bitboard();
    }
    this.pieceCount = new Array(T.PIECE_NB).fill(0);
    this.sideToMove = T.WHITE;
    this.gamePly = 0;
    this.psq = 0; // Piece square table score (placeholder)
    this.st = new StateInfo();
    this.history = [];
  }
  
  // Initialize position from FEN string
  set(fenStr, st) {
    // Clear the board
    this.board = new Array(T.SQUARE_NB).fill(T.NO_PIECE);
    for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
      this.byTypeBB[pt] = new B.Bitboard();
    }
    for (let c = 0; c < T.COLOR_NB; c++) {
      this.byColorBB[c] = new B.Bitboard();
    }
    this.pieceCount = new Array(T.PIECE_NB).fill(0);
    this.st = st || new StateInfo();
    
    const tokens = fenStr.split(/\s+/);
    let idx = 0;
    let rank = T.RANK_9;
    let file = T.FILE_A;
    
    // Parse piece placement
    while (idx < tokens[0].length) {
      const c = tokens[0][idx];
      if (c === '/') {
        rank--;
        file = T.FILE_A;
      } else if (c >= '1' && c <= '9') {
        file += parseInt(c);
      } else {
        // Parse piece
        const piece = this.char_to_piece(c);
        if (piece !== T.NO_PIECE) {
          this.put_piece(piece, T.make_square(file, rank));
        }
        file++;
      }
      idx++;
    }
    
    // Parse active color
    if (tokens.length > 1) {
      this.sideToMove = tokens[1] === 'b' ? T.BLACK : T.WHITE;
    }
    
    // Parse halfmove and fullmove (simplified)
    if (tokens.length > 4) {
      this.st.rule60 = parseInt(tokens[4]) || 0;
    }
    if (tokens.length > 5) {
      this.gamePly = 2 * (parseInt(tokens[5]) || 1) - (this.sideToMove === T.BLACK ? 2 : 1);
    }
    
    this.set_state(this.st);
    return this;
  }
  
  // Generate FEN string
  fen() {
    let s = '';
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      let empty = 0;
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        const pc = this.board[sq];
        if (pc === T.NO_PIECE) {
          empty++;
        } else {
          if (empty > 0) {
            s += empty;
            empty = 0;
          }
          s += this.piece_to_char(pc);
        }
      }
      if (empty > 0) {
        s += empty;
      }
      if (r > T.RANK_0) {
        s += '/';
      }
    }
    s += ' ' + (this.sideToMove === T.WHITE ? 'w' : 'b');
    s += ' - - ' + this.st.rule60 + ' ' + Math.floor((this.gamePly + 1) / 2);
    return s;
  }
  
  // Helper to convert piece to FEN character
  piece_to_char(pc) {
    const pieceChars = ' KACPNBR kacpnbr';
    return pieceChars[pc] || '?';
  }
  
  // Helper to convert FEN character to piece
  char_to_piece(c) {
    const pieceMap = {
      'K': T.W_KING, 'A': T.W_ADVISOR, 'B': T.W_BISHOP,
      'N': T.W_KNIGHT, 'R': T.W_ROOK, 'C': T.W_CANNON, 'P': T.W_PAWN,
      'k': T.B_KING, 'a': T.B_ADVISOR, 'b': T.B_BISHOP,
      'n': T.B_KNIGHT, 'r': T.B_ROOK, 'c': T.B_CANNON, 'p': T.B_PAWN
    };
    return pieceMap[c] || T.NO_PIECE;
  }
  
  // Put a piece on a square
  put_piece(pc, sq) {
    this.board[sq] = pc;
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    this.byTypeBB[pt].set(sq);
    this.byTypeBB[T.ALL_PIECES].set(sq);
    this.byColorBB[c].set(sq);
    
    this.pieceCount[pc]++;
    this.pieceCount[T.make_piece(c, T.ALL_PIECES)]++;
  }
  
  // Remove a piece from a square
  remove_piece(sq) {
    const pc = this.board[sq];
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    this.byTypeBB[pt].clear(sq);
    this.byTypeBB[T.ALL_PIECES].clear(sq);
    this.byColorBB[c].clear(sq);
    
    this.board[sq] = T.NO_PIECE;
    
    this.pieceCount[pc]--;
    this.pieceCount[T.make_piece(c, T.ALL_PIECES)]--;
  }
  
  // Move a piece
  move_piece(from, to) {
    const pc = this.board[from];
    this.remove_piece(from);
    this.put_piece(pc, to);
  }
  
  // Get piece on a square
  piece_on(sq) {
    return this.board[sq];
  }
  
  // Check if square is empty
  empty(sq) {
    return this.board[sq] === T.NO_PIECE;
  }
  
  // Get color's pieces bitboard
  pieces(ptOrColor, pt) {
    if (typeof pt === 'undefined') {
      if (typeof ptOrColor === 'undefined') {
        return this.byTypeBB[T.ALL_PIECES];
      }
      return (ptOrColor === T.WHITE || ptOrColor === T.BLACK) 
        ? this.byColorBB[ptOrColor] 
        : this.byTypeBB[ptOrColor];
    } else {
      // Both color and piece type specified
      return this.byColorBB[ptOrColor].and(this.byTypeBB[pt]);
    }
  }
  
  // Check if move gives check (simplified)
  gives_check(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    const us = this.sideToMove;
    const them = ~us & 1;
    const ksq = this.square(T.KING, them);
    
    // Make move on a copy
    this.do_move(m);
    const result = this.attackers_to(ksq, us).toBool();
    this.undo_move(m);
    return result;
  }
  
  // Make a move
  do_move(m, newSt) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.board[from];
    
    // Save state for undo
    const st = newSt || new StateInfo();
    st.previous = this.st;
    st.rule60 = this.st.rule60 + 1;
    st.pliesFromNull = this.st.pliesFromNull + 1;
    st.capturedPiece = this.board[to];
    
    this.history.push(this.st);
    this.st = st;
    
    // Capture piece if any
    if (st.capturedPiece !== T.NO_PIECE) {
      this.remove_piece(to);
      st.rule60 = 0;
    }
    
    // Move piece
    this.move_piece(from, to);
    
    // Switch sides
    this.sideToMove = ~this.sideToMove & 1;
    this.gamePly++;
    
    // Update check info
    this.set_state(st);
    
    return true;
  }
  
  // Undo a move
  undo_move(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.board[to];
    const captured = this.st.capturedPiece;
    
    // Move piece back
    this.move_piece(to, from);
    
    // Restore captured piece
    if (captured !== T.NO_PIECE) {
      this.put_piece(captured, to);
    }
    
    // Restore state
    this.st = this.history.pop();
    
    // Switch sides back
    this.sideToMove = ~this.sideToMove & 1;
    this.gamePly--;
  }
  
  // Find square of a piece
  square(pt, c) {
    let b = this.pieces(c, pt);
    if (b.toBool()) {
      return B.lsb(b);
    }
    return T.SQ_NONE;
  }
  
  // Check for legal move (simplified)
  legal(m) {
    if (!T.is_ok_move(m)) return false;
    
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const us = this.sideToMove;
    const pc = this.piece_on(from);
    
    if (pc === T.NO_PIECE || T.color_of(pc) !== us) return false;
    
    const captured = this.piece_on(to);
    if (captured !== T.NO_PIECE && T.color_of(captured) === us) return false;
    
    // Check legality based on piece type
    if (!this.legal_move_for_piece(pc, from, to)) return false;
    
    // Make move and check if king is attacked
    this.do_move(m);
    const ksq = this.square(T.KING, us);
    const inCheck = this.attackers_to(ksq, ~us & 1).toBool();
    this.undo_move(m);
    
    return !inCheck;
  }
  
  // Check legal move for a piece type
  legal_move_for_piece(pc, from, to) {
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    const toPt = this.piece_on(to);
    
    switch (pt) {
      case T.KING:
        return this.in_palace(to) && B.distance(from, to) === 1;
      
      case T.ADVISOR:
        return this.in_palace(to) && 
               Math.abs(T.file_of(from) - T.file_of(to)) === 1 &&
               Math.abs(T.rank_of(from) - T.rank_of(to)) === 1;
      
      case T.BISHOP:
        if (this.in_opposite_half(to, c)) return false;
        const midX = (T.file_of(from) + T.file_of(to)) / 2;
        const midY = (T.rank_of(from) + T.rank_of(to)) / 2;
        const midSq = T.make_square(midX, midY);
        return this.empty(midSq) &&
               Math.abs(T.file_of(from) - T.file_of(to)) === 2 &&
               Math.abs(T.rank_of(from) - T.rank_of(to)) === 2;
      
      case T.KNIGHT:
        const dx = Math.abs(T.file_of(from) - T.file_of(to));
        const dy = Math.abs(T.rank_of(from) - T.rank_of(to));
        if (!((dx === 1 && dy === 2) || (dx === 2 && dy === 1))) {
          return false;
        }
        // Check leg is not blocked
        let legSq;
        if (dx === 1) {
          legSq = T.make_square(T.file_of(from), 
                               (T.rank_of(from) + T.rank_of(to)) / 2);
        } else {
          legSq = T.make_square((T.file_of(from) + T.file_of(to)) / 2, 
                               T.rank_of(from));
        }
        return this.empty(legSq);
      
      case T.ROOK:
        return this.legal_slide(from, to);
      
      case T.CANNON:
        if (this.empty(to)) {
          return this.legal_slide(from, to);
        } else {
          return this.legal_cannon_capture(from, to);
        }
      
      case T.PAWN:
        return this.legal_pawn_move(from, to, c);
      
      default:
        return false;
    }
  }
  
  // Check if slide is legal
  legal_slide(from, to) {
    if (T.file_of(from) !== T.file_of(to) && T.rank_of(from) !== T.rank_of(to)) {
      return false;
    }
    
    const dx = Math.sign(T.file_of(to) - T.file_of(from));
    const dy = Math.sign(T.rank_of(to) - T.rank_of(from));
    let sq = T.make_square(T.file_of(from) + dx, T.rank_of(from) + dy);
    
    while (sq !== to) {
      if (!this.empty(sq)) return false;
      sq = T.make_square(T.file_of(sq) + dx, T.rank_of(sq) + dy);
    }
    
    return true;
  }
  
  // Check if cannon capture is legal
  legal_cannon_capture(from, to) {
    if (T.file_of(from) !== T.file_of(to) && T.rank_of(from) !== T.rank_of(to)) {
      return false;
    }
    
    const dx = Math.sign(T.file_of(to) - T.file_of(from));
    const dy = Math.sign(T.rank_of(to) - T.rank_of(from));
    let sq = T.make_square(T.file_of(from) + dx, T.rank_of(from) + dy);
    let count = 0;
    
    while (sq !== to) {
      if (!this.empty(sq)) count++;
      sq = T.make_square(T.file_of(sq) + dx, T.rank_of(sq) + dy);
    }
    
    return count === 1;
  }
  
  // Check if pawn move is legal
  legal_pawn_move(from, to, c) {
    const forward = c === T.WHITE ? 1 : -1;
    
    const dx = T.file_of(to) - T.file_of(from);
    const dy = T.rank_of(to) - T.rank_of(from);
    
    // Forward move
    if (dx === 0 && dy === forward) return true;
    
    // Sideways move (only in enemy half)
    if (Math.abs(dx) === 1 && dy === 0) {
      const halfLine = c === T.WHITE ? T.RANK_5 : T.RANK_4;
      if (c === T.WHITE && T.rank_of(from) <= halfLine) return true;
      if (c === T.BLACK && T.rank_of(from) >= halfLine) return true;
    }
    
    return false;
  }
  
  // Check if square is in palace
  in_palace(sq) {
    const f = T.file_of(sq);
    const r = T.rank_of(sq);
    return (f >= T.FILE_D && f <= T.FILE_F) && 
           ((r >= T.RANK_0 && r <= T.RANK_2) || (r >= T.RANK_7 && r <= T.RANK_9));
  }
  
  // Check if square is in opposite half
  in_opposite_half(sq, c) {
    const r = T.rank_of(sq);
    return (c === T.WHITE && r > T.RANK_4) ||
           (c === T.BLACK && r < T.RANK_5);
  }
  
  // Get attackers to a square
  attackers_to(sq, byColor) {
    let attackers = new B.Bitboard();
    if (typeof byColor === 'undefined') {
      attackers = attackers.or(this.attackers_to(sq, T.WHITE));
      attackers = attackers.or(this.attackers_to(sq, T.BLACK));
      return attackers;
    }
    
    // Check pawns
    const pawns = this.pieces(byColor, T.PAWN);
    let b = pawns.clone();
    while (b.toBool()) {
      const s = B.pop_lsb(b);
      if (B.pawn_attacks_bb(byColor, s).test(sq)) {
        attackers.set(s);
      }
    }
    
    // Check knights
    const knights = this.pieces(byColor, T.KNIGHT);
    b = knights.clone();
    while (b.toBool()) {
      const s = B.pop_lsb(b);
      if (B.KnightAttacks[s].test(sq)) {
        if (this.legal_move_for_piece(T.make_piece(byColor, T.KNIGHT), s, sq)) {
          attackers.set(s);
        }
      }
    }
    
    // Check rooks and cannons
    const rooks = this.pieces(byColor, T.ROOK);
    b = rooks.clone();
    while (b.toBool()) {
      const s = B.pop_lsb(b);
      if (this.legal_slide(s, sq)) {
        attackers.set(s);
      }
    }
    
    const cannons = this.pieces(byColor, T.CANNON);
    b = cannons.clone();
    while (b.toBool()) {
      const s = B.pop_lsb(b);
      if (this.empty(sq)) {
        if (this.legal_slide(s, sq)) {
          attackers.set(s);
        }
      } else {
        if (this.legal_cannon_capture(s, sq)) {
          attackers.set(s);
        }
      }
    }
    
    return attackers;
  }
  
  // Generate all legal moves
  generate_moves() {
    const moves = [];
    const us = this.sideToMove;
    const pieces = this.pieces(us);
    
    let b = pieces.clone();
    while (b.toBool()) {
      const from = B.pop_lsb(b);
      const pieceMoves = this.generate_piece_moves(from);
      moves.push(...pieceMoves);
    }
    
    return moves;
  }
  
  // Generate moves for a piece
  generate_piece_moves(from) {
    const moves = [];
    const pc = this.board[from];
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    
    for (let to = 0; to < T.SQUARE_NB; to++) {
      if (from === to) continue;
      
      const captured = this.piece_on(to);
      if (captured !== T.NO_PIECE && T.color_of(captured) === c) continue;
      
      if (this.legal_move_for_piece(pc, from, to)) {
        // Make the move and check if it's legal
        const m = T.make_move(from, to);
        if (this.legal(m)) {
          moves.push(m);
        }
      }
    }
    
    return moves;
  }
  
  // Set state (check info etc.)
  set_state(st) {
    const us = this.sideToMove;
    const them = ~us & 1;
    const ourKing = this.square(T.KING, us);
    const theirKing = this.square(T.KING, them);
    
    // Find checkers
    st.checkersBB = this.attackers_to(ourKing, them);
    
    // Set other check info (simplified)
    st.checkSquares[T.PAWN] = B.pawn_attacks_to_bb(them, ourKing);
  }
  
  // Check if in check
  in_check() {
    return this.st.checkersBB.toBool();
  }
  
  // Get checkers bitboard
  checkers() {
    return this.st.checkersBB;
  }
  
  // Count pieces of a type
  count(pt, c) {
    if (typeof c === 'undefined') {
      return this.count(pt, T.WHITE) + this.count(pt, T.BLACK);
    }
    return this.pieceCount[T.make_piece(c, pt)];
  }
  
  // Get side to move
  side_to_move() {
    return this.sideToMove;
  }
  
  // Clone position
  clone() {
    const pos = new Position();
    pos.board = [...this.board];
    for (let pt = 0; pt < T.PIECE_TYPE_NB; pt++) {
      pos.byTypeBB[pt] = this.byTypeBB[pt].clone();
    }
    for (let c = 0; c < T.COLOR_NB; c++) {
      pos.byColorBB[c] = this.byColorBB[c].clone();
    }
    pos.pieceCount = [...this.pieceCount];
    pos.sideToMove = this.sideToMove;
    pos.gamePly = this.gamePly;
    pos.st = this.st.clone();
    return pos;
  }
  
  // Pretty print board
  pretty() {
    let s = '';
    for (let r = T.RANK_9; r >= T.RANK_0; r--) {
      s += '  +---+---+---+---+---+---+---+---+---+\n';
      s += r + ' |';
      for (let f = T.FILE_A; f <= T.FILE_I; f++) {
        const sq = T.make_square(f, r);
        const pc = this.piece_on(sq);
        s += ' ' + this.piece_to_char(pc) + ' |';
      }
      s += '\n';
    }
    s += '  +---+---+---+---+---+---+---+---+---+\n';
    s += '    a   b   c   d   e   f   g   h   i\n';
    s += '  Side to move: ' + (this.sideToMove === T.WHITE ? 'white' : 'black') + '\n';
    s += '  FEN: ' + this.fen() + '\n';
    return s;
  }
}

// Initialize static data
function init() {
  init_zobrist();
}

module.exports = {
  Position,
  StateInfo,
  init
};
