"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');

// ==============================================
// Zobrist hashing keys
// ==============================================

const Zobrist = {
  psq: new Array(T.PIECE_NB),
  side: 0n
};

function init_zobrist() {
  let seed = 1070372;
  function rand() {
    seed = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    const high = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    return BigInt(seed >>> 0) | (BigInt(high >>> 0) << 32n);
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
// StateInfo - exactly like C++ struct
// ==============================================

class StateInfo {
  constructor() {
    // Copied when making a move
    this.materialKey = 0n;
    this.material = [0, 0];  // [WHITE, BLACK]
    this.check10 = [0, 0];   // [WHITE, BLACK]
    this.rule60 = 0;
    this.pliesFromNull = 0;
    
    // Not copied when making a move (will be recomputed)
    this.key = 0n;
    this.checkersBB = 0n;
    this.previous = null;
    this.blockersForKing = [0n, 0n];  // [WHITE, BLACK]
    this.pinners = [0n, 0n];          // [WHITE, BLACK]
    this.checkSquares = new Array(T.PIECE_TYPE_NB).fill(0n);
    this.needSlowCheck = false;
    this.capturedPiece = T.NO_PIECE;
    this.chased = 0;
    this.move = T.MOVE_NONE;
  }
}

// ==============================================
// Position class - complete implementation
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
  
  // ========== FEN string input/output ==========
  
  set(fenStr) {
    const tokens = fenStr.trim().split(/\s+/);
    let idx = 0;
    let sq = T.SQ_A9;
    
    const PieceToChar = " RACPNBK racpnbk";
    
    // Clear all
    this.board.fill(T.NO_PIECE);
    this.byTypeBB.fill(0n);
    this.byColorBB = [0n, 0n];
    this.pieceCount.fill(0);
    this.psq = 0;
    this.gamePly = 0;
    this.st = new StateInfo();
    
    // 1. Piece placement
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
    
    // 2. Active color
    if (tokens.length > 1) {
      this.sideToMove = tokens[1] === 'w' ? T.WHITE : T.BLACK;
    }
    
    // 3-4. Halfmove clock and fullmove number
    if (tokens.length > 4) {
      this.st.rule60 = parseInt(tokens[4]) || 0;
    }
    if (tokens.length > 5) {
      let fullmove = parseInt(tokens[5]) || 1;
      this.gamePly = Math.max(2 * (fullmove - 1), 0) + (this.sideToMove === T.BLACK ? 1 : 0);
    }
    
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
  
  // ========== Position representation ==========
  
  put_piece(pc, sq) {
    this.board[sq] = pc;
    const pt = T.type_of(pc);
    const c = T.color_of(pc);
    const sqBit = 1n << BigInt(sq);
    
    this.byTypeBB[T.ALL_PIECES] |= sqBit;
    this.byTypeBB[pt] |= sqBit;
    this.byColorBB[c] |= sqBit;
    
    this.pieceCount[pc]++;
    this.pieceCount[T.make_piece(c, T.ALL_PIECES)]++;
    this.psq += PSQT.psq_score(pc, sq);
  }
  
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
  
  piece_on(sq) { return this.board[sq]; }
  empty(sq) { return this.board[sq] === T.NO_PIECE; }
  moved_piece(m) { return this.piece_on(T.from_sq(m)); }
  
  is_on_semiopen_file(c, s) {
    return !(this.byColorBB[c] & this.byTypeBB[T.PAWN] & B.file_bb(s));
  }
  
  // ========== Checking ==========
  
  checkers() { return this.st.checkersBB; }
  in_check() { return this.st.checkersBB !== 0n; }
  check_squares(pt) { return this.st.checkSquares[pt]; }
  blockers_for_king(c) { return this.st.blockersForKing[c]; }
  pinners(c) { return this.st.pinners[c]; }
  
  // ========== Attacks to/from a given square ==========
  
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
    
    return ((B.pawn_attacks_to_bb(c, s) & this.byTypeBB[T.PAWN])
          | (B.attacks_bb(T.KNIGHT, s, occupied) & this.byTypeBB[T.KNIGHT])
          | (B.attacks_bb(T.ROOK, s, occupied) & (this.byTypeBB[T.KING] | this.byTypeBB[T.ROOK]))
          | (B.attacks_bb(T.CANNON, s, occupied) & this.byTypeBB[T.CANNON]))
          & this.byColorBB[c];
  }
  
  // ========== Properties of moves ==========
  
  legal(m) {
    const us = this.sideToMove;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    
    if (pc === T.NO_PIECE || T.color_of(pc) !== us) return false;
    if (this.pieces(us) & (1n << BigInt(to))) return false;
    
    const occupied = (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to));
    const pt = T.type_of(pc);
    const ksq = pt === T.KING ? to : this.square(T.KING, us);
    
    // A non-king move is always legal when not moving the king or a pinned piece if we don't need slow check
    if (!this.st.needSlowCheck && ksq !== to && !(this.st.blockersForKing[us] & (1n << BigInt(from)))) {
      return true;
    }
    
    // If the moving piece is a king, check whether the destination square is attacked by the opponent
    if (pt === T.KING) {
      return !(this.checkers_to(~us & 1, to, occupied));
    }
    
    // A non-king move is legal if the king is not under attack after the move
    return !(this.checkers_to(~us & 1, ksq, occupied) & ~(1n << BigInt(to)));
  }
  
  pseudo_legal(m) {
    const us = this.sideToMove;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    
    // If the 'from' square is not occupied by a piece belonging to the side to move
    if (pc === T.NO_PIECE || T.color_of(pc) !== us) return false;
    
    // The destination square cannot be occupied by a friendly piece
    if (this.pieces(us) & (1n << BigInt(to))) return false;
    
    // Handle the special cases
    const pt = T.type_of(pc);
    if (pt === T.PAWN) {
      return B.pawn_attacks_bb(us, from) & (1n << BigInt(to));
    } else if (pt === T.CANNON) {
      // For non-capture, just check if it's a valid rook-like move
      if (!(this.piece_on(to))) {
        return B.attacks_bb(T.ROOK, from, this.byTypeBB[T.ALL_PIECES]) & (1n << BigInt(to));
      }
    }
    
    return B.attacks_bb(pt, from, this.byTypeBB[T.ALL_PIECES]) & (1n << BigInt(to));
  }
  
  gives_check(m) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const ksq = this.square(T.KING, ~this.sideToMove & 1);
    const pc = this.piece_on(from);
    const pt = T.type_of(pc);
    
    // Is there a direct check?
    if (pt === T.CANNON) {
      if (B.attacks_bb(T.CANNON, to, (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to))) & (1n << BigInt(ksq))) {
        return true;
      }
    } else if (this.st.checkSquares[pt] & (1n << BigInt(to))) {
      return true;
    }
    
    // Is there a discovered check?
    if (B.attacks_bb(T.ROOK, ksq, this.byTypeBB[T.ALL_PIECES]) & this.pieces(this.sideToMove, T.CANNON)) {
      return this.checkers_to(this.sideToMove, ksq, (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from))) | (1n << BigInt(to)));
    } else if ((this.st.blockersForKing[~this.sideToMove & 1] & (1n << BigInt(from))) && !B.aligned(from, to, ksq)) {
      return true;
    }
    
    return false;
  }
  
  capture(m) {
    return !this.empty(T.to_sq(m));
  }
  
  // ========== Doing and undoing moves ==========
  
  do_move(m, newSt, givesCheck) {
    // C++: do_move(m, newSt, gives_check(m))
    if (typeof givesCheck === 'undefined') {
      givesCheck = this.gives_check(m);
    }
    
    const us = this.sideToMove;
    const them = ~us & 1;
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    const pc = this.piece_on(from);
    const captured = this.piece_on(to);
    
    // Copy state to newSt (like std::memcpy in C++)
    newSt.materialKey = this.st.materialKey;
    newSt.material[0] = this.st.material[0];
    newSt.material[1] = this.st.material[1];
    newSt.check10[0] = this.st.check10[0];
    newSt.check10[1] = this.st.check10[1];
    newSt.rule60 = this.st.rule60;
    newSt.pliesFromNull = this.st.pliesFromNull;
    
    // Not copied (will be recomputed)
    newSt.key = this.st.key;
    newSt.checkersBB = this.st.checkersBB;
    newSt.previous = this.st;
    newSt.blockersForKing[0] = this.st.blockersForKing[0];
    newSt.blockersForKing[1] = this.st.blockersForKing[1];
    newSt.pinners[0] = this.st.pinners[0];
    newSt.pinners[1] = this.st.pinners[1];
    newSt.checkSquares = [...this.st.checkSquares];
    newSt.needSlowCheck = this.st.needSlowCheck;
    newSt.capturedPiece = this.st.capturedPiece;
    newSt.move = m;
    
    this.st = newSt;
    
    // Increment ply counters
    ++this.gamePly;
    this.st.rule60++;
    ++this.st.pliesFromNull;
    
    if (captured) {
      this.st.material[them] -= T.PieceValue[T.MG][captured];
      
      // Update board and piece lists
      this.remove_piece(to);
      
      // Update hash key
      this.st.materialKey ^= Zobrist.psq[captured][this.pieceCount[captured]];
      
      // Reset rule 60 counter
      this.st.check10[0] = 0;
      this.st.check10[1] = 0;
      this.st.rule60 = 0;
    }
    
    // Update hash key
    let k = this.st.key ^ Zobrist.side;
    k ^= Zobrist.psq[pc][from] ^ Zobrist.psq[pc][to];
    
    this.move_piece(from, to);
    
    // Set capture piece
    this.st.capturedPiece = captured;
    
    // Update the key with the final value
    this.st.key = k;
    
    // Calculate checkers bitboard (if move gives check)
    this.st.checkersBB = givesCheck ? this.checkers_to(us, this.square(T.KING, them)) : 0n;
    
    this.sideToMove = them;
    
    // Update king attacks used for fast check detection
    this.set_check_info(this.st);
  }
  
  undo_move(m) {
    this.sideToMove = ~this.sideToMove & 1;
    
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    
    this.move_piece(to, from); // Put the piece back at the source square
    
    if (this.st.capturedPiece !== T.NO_PIECE) {
      this.put_piece(this.st.capturedPiece, to); // Restore the captured piece
    }
    
    // Finally point our state pointer back to the previous state
    this.st = this.st.previous;
    --this.gamePly;
  }
  
  do_null_move(newSt) {
    // Copy state
    newSt.materialKey = this.st.materialKey;
    newSt.material[0] = this.st.material[0];
    newSt.material[1] = this.st.material[1];
    newSt.check10[0] = this.st.check10[0];
    newSt.check10[1] = this.st.check10[1];
    newSt.rule60 = this.st.rule60;
    newSt.pliesFromNull = this.st.pliesFromNull;
    newSt.key = this.st.key;
    newSt.checkersBB = this.st.checkersBB;
    newSt.previous = this.st;
    newSt.blockersForKing[0] = this.st.blockersForKing[0];
    newSt.blockersForKing[1] = this.st.blockersForKing[1];
    newSt.pinners[0] = this.st.pinners[0];
    newSt.pinners[1] = this.st.pinners[1];
    newSt.checkSquares = [...this.st.checkSquares];
    newSt.needSlowCheck = this.st.needSlowCheck;
    newSt.capturedPiece = this.st.capturedPiece;
    newSt.move = this.st.move;
    
    this.st = newSt;
    
    this.st.key ^= Zobrist.side;
    ++this.st.rule60;
    this.st.pliesFromNull = 0;
    
    this.sideToMove = ~this.sideToMove & 1;
    
    this.set_check_info(this.st);
  }
  
  undo_null_move() {
    this.st = this.st.previous;
    this.sideToMove = ~this.sideToMove & 1;
  }
  
  // ========== Static Exchange Evaluation ==========
  
  see_ge(m, threshold = 0) {
    const from = T.from_sq(m);
    const to = T.to_sq(m);
    
    let swap = T.PieceValue[T.MG][this.piece_on(to)] - threshold;
    if (swap < 0) return false;
    
    swap = T.PieceValue[T.MG][this.piece_on(from)] - swap;
    if (swap <= 0) return true;
    
    const occupied = this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(from)) ^ (1n << BigInt(to));
    let stm = this.sideToMove;
    let attackers = this.attackers_to(to, occupied);
    
    // Flying general
    if (attackers & this.pieces(stm, T.KING)) {
      attackers |= B.attacks_bb(T.ROOK, to, occupied & ~this.byTypeBB[T.ROOK]) & this.pieces(~stm & 1, T.KING);
    }
    if (attackers & this.pieces(~stm & 1, T.KING)) {
      attackers |= B.attacks_bb(T.ROOK, to, occupied & ~this.byTypeBB[T.ROOK]) & this.pieces(stm, T.KING);
    }
    
    let nonCannons = attackers & ~this.byTypeBB[T.CANNON];
    let cannons = attackers & this.byTypeBB[T.CANNON];
    let res = 1;
    
    while (true) {
      stm = ~stm & 1;
      attackers &= occupied;
      
      // If stm has no more attackers then give up
      const stmAttackers = attackers & this.pieces(stm);
      if (!stmAttackers) break;
      
      // Don't allow pinned pieces to attack
      if (this.st.pinners[~stm] & occupied) {
        const filtered = stmAttackers & ~this.st.blockersForKing[stm];
        if (!filtered) break;
      }
      
      res ^= 1;
      
      // Locate and remove the next least valuable attacker
      let bb;
      if ((bb = stmAttackers & this.byTypeBB[T.PAWN])) {
        if ((swap = T.PieceValue[T.MG][T.W_PAWN] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
        nonCannons |= B.attacks_bb(T.ROOK, to, occupied) & this.byTypeBB[T.ROOK];
        cannons = B.attacks_bb(T.CANNON, to, occupied) & this.byTypeBB[T.CANNON];
        attackers = nonCannons | cannons;
      } else if ((bb = stmAttackers & this.byTypeBB[T.ADVISOR])) {
        if ((swap = T.PieceValue[T.MG][T.W_ADVISOR] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
        nonCannons |= B.attacks_bb(T.KNIGHT, to, occupied) & this.byTypeBB[T.KNIGHT];
        attackers = nonCannons | cannons;
      } else if ((bb = stmAttackers & this.byTypeBB[T.BISHOP])) {
        if ((swap = T.PieceValue[T.MG][T.W_BISHOP] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
      } else if ((bb = stmAttackers & this.byTypeBB[T.CANNON])) {
        if ((swap = T.PieceValue[T.MG][T.W_CANNON] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
        cannons = B.attacks_bb(T.CANNON, to, occupied) & this.byTypeBB[T.CANNON];
        attackers = nonCannons | cannons;
      } else if ((bb = stmAttackers & this.byTypeBB[T.KNIGHT])) {
        if ((swap = T.PieceValue[T.MG][T.W_KNIGHT] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
      } else if ((bb = stmAttackers & this.byTypeBB[T.ROOK])) {
        if ((swap = T.PieceValue[T.MG][T.W_ROOK] - swap) < res) break;
        occupied ^= B.least_significant_square_bb(bb);
        nonCannons |= B.attacks_bb(T.ROOK, to, occupied) & this.byTypeBB[T.ROOK];
        cannons = B.attacks_bb(T.CANNON, to, occupied) & this.byTypeBB[T.CANNON];
        attackers = nonCannons | cannons;
      } else {
        // KING
        return (attackers & ~this.pieces(stm)) ? res ^ 1 : res;
      }
    }
    
    return Boolean(res);
  }
  
  // ========== Accessing hash keys ==========
  
  key() { return this.st.key; }
  material_key() { return this.st.materialKey; }
  
  // ========== Other properties of the position ==========
  
  side_to_move() { return this.sideToMove; }
  game_ply() { return this.gamePly; }
  psq_score() { return this.psq; }
  
  material_sum() { return this.st.material[T.WHITE] + this.st.material[T.BLACK]; }
  material_diff() { return this.st.material[this.sideToMove] - this.st.material[~this.sideToMove & 1]; }
  material(c) { return this.st.material[c]; }
  rule60_count() { return this.st.rule60; }
  
  // ========== Initialization helpers ==========
  
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
    
    // C++: si->blockersForKing[us] = blockers_for_king(pieces(~us), uksq, si->pinners[~us]);
    const themResult = this._blockers_for_king(this.pieces(them), uksq);
    si.blockersForKing[us] = themResult.blockers;
    si.pinners[them] = themResult.pinners;
    
    const usResult = this._blockers_for_king(this.pieces(us), oksq);
    si.blockersForKing[them] = usResult.blockers;
    si.pinners[us] = usResult.pinners;
    
    // C++: si->needSlowCheck = checkers() || (attacks_bb<ROOK>(uksq) & pieces(~us, CANNON));
    si.needSlowCheck = si.checkersBB !== 0n || 
      (B.attacks_bb(T.ROOK, uksq, this.byTypeBB[T.ALL_PIECES]) & this.pieces(them, T.CANNON));
    
    si.checkSquares[T.PAWN] = B.pawn_attacks_to_bb(this.sideToMove, oksq);
    si.checkSquares[T.KNIGHT] = B.attacks_bb(T.KNIGHT, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.CANNON] = B.attacks_bb(T.CANNON, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.ROOK] = B.attacks_bb(T.ROOK, oksq, this.byTypeBB[T.ALL_PIECES]);
    si.checkSquares[T.ADVISOR] = 0n;
    si.checkSquares[T.BISHOP] = 0n;
    si.checkSquares[T.KING] = 0n;
  }
  
  // Internal blockers_for_king that returns {blockers, pinners}
  // C++: Bitboard Position::blockers_for_king(Bitboard sliders, Square s, Bitboard& pinners) const
  _blockers_for_king(sliders, s) {
    let blockers = 0n;
    let pinners = 0n;
    
    // Snipers are pieces that attack 's' when a piece and other pieces are removed
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
      const between = B.between_bb(s, sniperSq);
      
      let b;
      if (isCannon) {
        // For cannon, we need pieces() ^ sniperSq
        b = between & (this.byTypeBB[T.ALL_PIECES] ^ (1n << BigInt(sniperSq)));
      } else {
        b = between & occupancy;
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
  
  // ========== Move generation ==========
  
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
          continue;
      }
      
      // Filter legal moves
      let b = attacks;
      while (b !== 0n) {
        let to, newB;
        [to, newB] = B.pop_lsb(b);
        b = newB;
        
        // Skip if destination has own piece
        if (this.byColorBB[us] & (1n << BigInt(to))) continue;
        
        const m = T.make_move(from, to);
        if (this.legal(m)) {
          moves.push(m);
        }
      }
    }
    
    return moves;
  }
  
  // ========== Position consistency check ==========
  
  pos_is_ok() {
    if (this.sideToMove !== T.WHITE && this.sideToMove !== T.BLACK) return false;
    if (this.piece_on(this.square(T.KING, T.WHITE)) !== T.W_KING) return false;
    if (this.piece_on(this.square(T.KING, T.BLACK)) !== T.B_KING) return false;
    return true;
  }
  
  // ========== Pretty print board ==========
  
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
  
  // ========== Clone position ==========
  
  clone() {
    const pos = new Position();
    pos.board = [...this.board];
    pos.byTypeBB = [...this.byTypeBB];
    pos.byColorBB = [...this.byColorBB];
    pos.pieceCount = [...this.pieceCount];
    pos.sideToMove = this.sideToMove;
    pos.gamePly = this.gamePly;
    pos.psq = this.psq;
    pos.st = new StateInfo();
    Object.assign(pos.st, this.st);
    pos.st.checkSquares = [...this.st.checkSquares];
    return pos;
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
