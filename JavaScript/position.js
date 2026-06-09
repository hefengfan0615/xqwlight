/*
 * Pikafish Chinese Chess Engine - Position
 * Converted from Stockfish/Pikafish C++ position.h/cpp
 */

import {
  SQUARE_NB, FILE_NB, RANK_NB,
  NORTH, SOUTH, EAST, WEST,
  WHITE, BLACK, COLOR_NB,
  NO_PIECE, PIECE_NB, PIECE_TYPE_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING,
  colorOf, typeOf, makePiece, fileOf, rankOf, makeSquare, isOkSquare,
  fromSq, toSq, makeMove, MOVE_NONE, MOVE_NULL, isOkMove,
  PieceValue, PieceToChar, FenPieceMap,
  VALUE_DRAW, VALUE_MATE, VALUE_NONE,
  SQ_A0, SQ_A9, SQ_NONE, SQ_I9,
  FILE_A, FILE_I,
  EG, MG,
} from './pikafish_types.js';

import {
  bbSet, bbClr, bbTest, bbEmpty, popcount, lsb, bbRef,
  SquareBB, FileBB, RankBB,
  BetweenBB, LineBB,
  attacksByPieceType,
  rookAttacks, cannonAttacks, knightAttacks,
  bishopAttacks, advisorAttacks, kingAttacks, pawnAttacks,
  flyingGeneralCheck,
  inPalace, ownHalf,
  fileDistance, squareDistance, rankDistance,
} from './pikafish_bitboard.js';

// === Zobrist keys ===
let Zobrist = null;
let ZobSide = 0n;

function initZobrist() {
  // PRNG
  let seed = 1070372;
  const rand64 = () => {
    seed = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    const lo = seed >>> 0;
    seed = (seed * 6364136223846793005 + 1442695040888963407) >>> 0;
    const hi = seed >>> 0;
    return BigInt(hi) * 0x100000000n + BigInt(lo);
  };

  Zobrist = [];
  for (let i = 0; i < PIECE_NB; i++) {
    Zobrist[i] = [];
    for (let s = 0; s < SQUARE_NB; s++) {
      Zobrist[i][s] = rand64();
    }
  }
  ZobSide = rand64();
}

initZobrist();

// === Piece lists ===
// pieceList[w/b][pieceType][index]
// index[pieceType][sq] -> index in pieceList

// === StateInfo ===
export class StateInfo {
  constructor() {
    this.key = 0n;
    this.checkersBB = 0n;
    this.captured = NO_PIECE;
    this.lastMove = MOVE_NONE;
    this.repetition = 0;
    this.previous = null;
    // For chase detection
    this.chaseMap = 0;
  }
}

// === Position ===
export class Position {
  constructor() {
    this.board = new Uint8Array(SQUARE_NB);      // Piece on each square
    this.byColorBB = [0n, 0n];                     // All pieces by color
    this.byTypeBB = Array(PIECE_TYPE_NB).fill(0n); // All pieces by type
    this.pieceCount = [[], []];                     // [color][pieceType] count
    this.pieceList = [];                            // [color][pieceType][idx] = square
    this.index = [];                                // [color][sq] = index in pieceList

    for (let c = 0; c < COLOR_NB; c++) {
      this.pieceCount[c] = Array(PIECE_TYPE_NB).fill(0);
      this.pieceList[c] = [];
      this.index[c] = new Int8Array(SQUARE_NB);
      for (let pt = 0; pt < PIECE_TYPE_NB; pt++) {
        this.pieceList[c][pt] = new Int8Array(8);
      }
    }

    this.sideToMove = WHITE;
    this.st = new StateInfo();
    this.gamePly = 0;
    this.occupied = 0n;
    this.empty = 0n;
  }

  clear() {
    this.board.fill(NO_PIECE);
    this.byColorBB = [0n, 0n];
    this.byTypeBB = Array(PIECE_TYPE_NB).fill(0n);
    for (let c = 0; c < COLOR_NB; c++) {
      this.pieceCount[c].fill(0);
      this.index[c].fill(-1);
    }
    this.sideToMove = WHITE;
    this.st = new StateInfo();
    this.gamePly = 0;
    this.occupied = 0n;
  }

  // Reset state stack for search entrance
  initState() {
    this.st.previous = null;
    this.st.key = this.computeKey();
  }

  computeKey() {
    let k = 0n;
    for (let s = 0; s < SQUARE_NB; s++) {
      const pc = this.board[s];
      if (pc !== NO_PIECE) {
        k ^= Zobrist[pc][s];
      }
    }
    if (this.sideToMove === BLACK) k ^= ZobSide;
    return k;
  }

  // Put/remove piece on board (internal)
  putPiece(pc, sq) {
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const bb = SquareBB[sq];

    this.board[sq] = pc;
    this.byColorBB[c] |= bb;
    this.byTypeBB[pt] |= bb;
    this.byTypeBB[0] |= bb; // ALL_PIECES
    this.index[c][sq] = this.pieceCount[c][pt];
    this.pieceList[c][pt][this.pieceCount[c][pt]++] = sq;
    this.occupied |= bb;
  }

  removePiece(sq) {
    const pc = this.board[sq];
    if (pc === NO_PIECE) return;
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const bb = SquareBB[sq];

    this.board[sq] = NO_PIECE;
    this.byColorBB[c] ^= bb;
    this.byTypeBB[pt] ^= bb;
    this.byTypeBB[0] ^= bb;

    // Remove from piece list
    const lastSq = this.pieceList[c][pt][--this.pieceCount[c][pt]];
    const idx = this.index[c][sq];
    this.pieceList[c][pt][idx] = lastSq;
    this.index[c][lastSq] = idx;
    this.index[c][sq] = -1;
    this.occupied ^= bb;
  }

  movePiece(from, to) {
    const pc = this.board[from];
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const fromBB = SquareBB[from];
    const toBB = SquareBB[to];

    this.board[from] = NO_PIECE;
    this.board[to] = pc;
    this.byColorBB[c] ^= fromBB ^ toBB;
    this.byTypeBB[pt] ^= fromBB ^ toBB;
    this.byTypeBB[0] ^= fromBB ^ toBB;
    this.occupied ^= fromBB ^ toBB;

    // Update piece list
    this.index[c][to] = this.index[c][from];
    this.pieceList[c][pt][this.index[c][to]] = to;
    this.index[c][from] = -1;
  }

  /**
   * Parse FEN string
   */
  set(fenStr) {
    this.clear();
    const tokens = fenStr.trim().split(/\s+/);
    const boardStr = tokens[0];
    const sideChar = (tokens[1] || 'w').toLowerCase();

    let rank = 9; // Start from top rank
    let file = 0;

    for (const ch of boardStr) {
      if (ch === '/') {
        rank--;
        file = 0;
        continue;
      }
      if (ch >= '1' && ch <= '9') {
        file += parseInt(ch);
        continue;
      }
      const pc = FenPieceMap[ch];
      if (pc !== undefined) {
        const sq = makeSquare(file, rank);
        this.putPiece(pc, sq);
        file++;
      }
    }

    this.sideToMove = sideChar === 'b' ? BLACK : WHITE;
    this.st.key = this.computeKey();
    this.initState();
    this.computeCheckers();
  }

  /**
   * Generate FEN string
   */
  fen() {
    let fen = '';
    for (let r = RANK_NB - 1; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < FILE_NB; f++) {
        const sq = makeSquare(f, r);
        const pc = this.board[sq];
        if (pc === NO_PIECE) {
          empty++;
        } else {
          if (empty > 0) { fen += empty; empty = 0; }
          fen += PieceToChar[pc];
        }
      }
      if (empty > 0) fen += empty;
      if (r > 0) fen += '/';
    }
    fen += ' ' + (this.sideToMove === WHITE ? 'w' : 'b');
    return fen;
  }

  /**
   * Check if side to move is in check
   */
  checkers() {
    return this.st.checkersBB;
  }

  inCheck() {
    return this.st.checkersBB !== 0n;
  }

  /**
   * Compute checkers bitboard for side to move
   */
  computeCheckers() {
    const us = this.sideToMove;
    const them = us ^ 1;
    const kingSq = this.kingSquare(us);

    let checkers = 0n;

    if (kingSq === SQ_NONE) {
      this.st.checkersBB = 0n;
      return;
    }

    // Attacks from each enemy piece type on the king square
    checkers |= this.attacksByPiece(kingSq, them, ROOK);
    checkers |= this.attacksByPieceOnSquare(kingSq, them, CANNON);
    checkers |= this.attacksByPiece(kingSq, them, KNIGHT);
    checkers |= this.attacksByPiece(kingSq, them, PAWN);

    this.st.checkersBB = checkers;
  }

  /**
   * Get attacks on square 'sq' by enemy pieces of pieceType
   * Returns bitboard of attackers
   */
  attacksByPiece(sq, byColor, pt) {
    const them = byColor;
    const enemies = this.byColorBB[them] & this.byTypeBB[pt];
    let att = 0n;

    let bbRef = { bb: enemies };
    let attacker;
    while ((attacker = this.popLsbBB(bbRef)) !== SQ_NONE) {
      const attBB = attacksByPieceType(pt, attacker, them, this.occupied);
      if (bbTest(attBB, sq)) {
        att = bbSet(att, attacker);
      }
    }
    return att;
  }

  attacksByPieceOnSquare(sq, byColor, pt) {
    const them = byColor;
    const enemyBB = this.byColorBB[them] & this.byTypeBB[pt];
    let att = 0n;

    let bbRef = { bb: enemyBB };
    let attacker;
    while ((attacker = this.popLsbBB(bbRef)) !== SQ_NONE) {
      // Cannon attacks
      let cannonAtt = 0n;
      for (const d of [NORTH, SOUTH, EAST, WEST]) {
        let mount = false;
        for (let s = attacker + d; isOkSquare(s); s += d) {
          if ((d === EAST || d === WEST) && rankOf(s) !== rankOf(s - d)) break;
          if ((this.occupied >> BigInt(s)) & 1n) {
            if (!mount) { mount = true; }
            else { cannonAtt = bbSet(cannonAtt, s); break; }
          }
        }
      }
      if (bbTest(cannonAtt, sq)) {
        att = bbSet(att, attacker);
      }
    }
    return att;
  }

  popLsbBB(bbRef) {
    const bit = bbRef.bb & -bbRef.bb;
    if (bit === 0n) return SQ_NONE;
    const sq = lsb(bit);
    bbRef.bb ^= bit;
    return sq;
  }

  /**
   * Check if a move is legal (doesn't leave king in check)
   */
  isLegalMove(m) {
    const us = this.sideToMove;
    const from = fromSq(m);
    const to = toSq(m);

    // Get the moving piece
    const pc = this.board[from];
    if (pc === NO_PIECE || colorOf(pc) !== us) return false;

    const pt = typeOf(pc);
    const captured = this.board[to];

    // Can't capture own piece
    if (captured !== NO_PIECE && colorOf(captured) === us) return false;

    // Check piece-specific movement rules
    if (!this.isPseudoLegal(m, pc, pt)) return false;

    // Make move and check if king is in check
    this.doSimpleMove(from, to);
    const kingInCheck = this.isKingInCheck(us);
    this.undoSimpleMove(from, to, pc, captured);

    return !kingInCheck;
  }

  /**
   * Make a simple move (for legality testing)
   */
  doSimpleMove(from, to) {
    const pc = this.board[from];
    this.removePiece(from);
    if (this.board[to] !== NO_PIECE) this.removePiece(to);
    this.putPiece(pc, to);
  }

  undoSimpleMove(from, to, pc, captured) {
    this.removePiece(to);
    if (captured !== NO_PIECE) this.putPiece(captured, to);
    this.putPiece(pc, from);
  }

  /**
   * Check if a move is pseudo-legal (ignoring check)
   */
  isPseudoLegal(m, pc, pt) {
    const from = fromSq(m);
    const to = toSq(m);
    const us = colorOf(pc);
    const them = us ^ 1;
    const captured = this.board[to];

    if (captured !== NO_PIECE && colorOf(captured) === us) return false;

    // Check if target square is reachable
    switch (pt) {
      case ROOK: {
        const att = rookAttacks(from, this.occupied);
        return bbTest(att, to);
      }
      case CANNON: {
        const att = cannonAttacks(from, this.occupied);
        return bbTest(att, to);
      }
      case KNIGHT: {
        const att = knightAttacks(from, this.occupied);
        return bbTest(att, to);
      }
      case BISHOP: {
        const att = bishopAttacks(from, this.occupied, us);
        return bbTest(att, to);
      }
      case ADVISOR: {
        const att = advisorAttacks(from, us);
        return bbTest(att, to);
      }
      case KING: {
        const att = kingAttacks(from, us);
        return bbTest(att, to);
      }
      case PAWN: {
        const att = pawnAttacks(from, us);
        return bbTest(att, to);
      }
    }
    return false;
  }

  /**
   * Check if the given color's king is in check
   */
  isKingInCheck(c) {
    const kingSq = this.kingSquare(c);
    if (kingSq === SQ_NONE) return true; // No king = check

    const them = c ^ 1;
    const occupied = this.occupied;

    // Check from rooks
    if ((rookAttacks(kingSq, occupied) & this.byColorBB[them] & this.byTypeBB[ROOK]) !== 0n)
      return true;

    // Check from cannons (capture)
    if ((this.cannonAttacksOnSquare(kingSq) & this.byColorBB[them] & this.byTypeBB[CANNON]) !== 0n)
      return true;

    // Check from knights
    if ((knightAttacks(kingSq, occupied) & this.byColorBB[them] & this.byTypeBB[KNIGHT]) !== 0n)
      return true;

    // Check from pawns
    if ((this.pawnAttacksOnSquare(kingSq, c) & this.byColorBB[them] & this.byTypeBB[PAWN]) !== 0n)
      return true;

    // Check from king (flying general)
    const enemyKingSq = this.kingSquare(them);
    if (enemyKingSq !== SQ_NONE) {
      if (flyingGeneralCheck(kingSq, enemyKingSq, occupied))
        return true;
    }

    return false;
  }

  cannonAttacksOnSquare(sq) {
    let att = 0n;
    for (const d of [NORTH, SOUTH, EAST, WEST]) {
      let mount = false;
      for (let s = sq + d; isOkSquare(s); s += d) {
        if ((d === EAST || d === WEST) && rankOf(s) !== rankOf(s - d)) break;
        if ((this.occupied >> BigInt(s)) & 1n) {
          if (!mount) { mount = true; }
          else { att = bbSet(att, s); break; }
        }
      }
    }
    return att;
  }

  pawnAttacksOnSquare(sq, kingColor) {
    // Pawn attacks on sq: if sq's side is WHITE, black pawns at SOUTH
    // Pawns move forward
    let att = 0n;
    const them = kingColor ^ 1;
    // Enemy pawns attack kingColor: they push toward kingColor
    const enemyPush = them === WHITE ? NORTH : SOUTH;
    const fwd = sq - enemyPush; // Square pawn would be on to attack
    if (isOkSquare(fwd) && rankOf(fwd) !== rankOf(sq)) {
      att = bbSet(att, fwd);
    }
    // Sideways attacks for crossed-river pawns
    for (const side of [EAST, WEST]) {
      const sideSq = sq + side;
      if (isOkSquare(sideSq) && fileDistance(sq, sideSq) === 1) {
        const pc = this.board[sideSq];
        if (pc !== NO_PIECE && colorOf(pc) === them && typeOf(pc) === PAWN) {
          // Check if this pawn has crossed the river
          const r = rankOf(sideSq);
          const crossed = them === WHITE ? r >= 5 : r <= 4;
          if (crossed) {
            att = bbSet(att, sideSq);
          }
        }
      }
    }
    // Direct attack from forward pawn
    if (isOkSquare(fwd)) {
      const pc = this.board[fwd];
      if (pc !== NO_PIECE && colorOf(pc) === them && typeOf(pc) === PAWN) {
        att = bbSet(att, fwd);
      }
    }
    return att;
  }

  /**
   * Check if a move gives check
   */
  givesCheck(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const pc = this.board[from];
    const captured = this.board[to];

    // Direct check: piece attacks enemy king
    const them = this.sideToMove ^ 1;
    const enemyKing = this.kingSquare(them);

    if (enemyKing === SQ_NONE) return true;

    // Make move temporarily
    this.doSimpleMove(from, to);

    let check = false;

    // Direct check
    const pt = typeOf(pc);
    const attBB = attacksByPieceType(pt, to, this.sideToMove, this.occupied);
    if (bbTest(attBB, enemyKing)) {
      check = true;
    }

    // Discovery check: moving piece opens a line
    if (!check) {
      check = this.isKingInCheck(them);
    }

    this.undoSimpleMove(from, to, pc, captured);
    return check;
  }

  /**
   * Make a move on the board. Returns true if the move was legal.
   */
  doMove(m) {
    const us = this.sideToMove;
    const them = us ^ 1;
    const from = fromSq(m);
    const to = toSq(m);
    const pc = this.board[from];
    const captured = this.board[to];

    // Create new state info
    const newSt = new StateInfo();
    newSt.previous = this.st;
    newSt.captured = captured;
    newSt.lastMove = m;

    // Update key
    let k = this.st.key;
    if (captured !== NO_PIECE)
      k ^= Zobrist[captured][to];
    k ^= Zobrist[pc][from] ^ Zobrist[pc][to];
    k ^= ZobSide; // Side to move changes
    newSt.key = k;

    // Move piece
    this.removePiece(from);
    if (captured !== NO_PIECE) this.removePiece(to);
    this.putPiece(pc, to);

    // Switch sides
    this.sideToMove = them;
    this.st = newSt;
    this.gamePly++;

    // Compute checkers
    this.computeCheckers();

    // Check if move was legal (our king not in check)
    if (this.isKingInCheck(us)) {
      this.undoMove(m);
      return false;
    }

    // Check for chase/重复
    this.st.repetition = 0;

    return true;
  }

  /**
   * Undo last move
   */
  undoMove(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const pc = this.board[to];
    const captured = this.st.captured;

    this.sideToMove = this.sideToMove ^ 1;
    this.removePiece(to);
    if (captured !== NO_PIECE) this.putPiece(captured, to);
    this.putPiece(pc, from);

    this.st = this.st.previous;
    this.gamePly--;
  }

  /**
   * Make a null move (pass turn)
   */
  doNullMove() {
    const newSt = new StateInfo();
    newSt.previous = this.st;
    newSt.key = this.st.key ^ ZobSide;
    newSt.lastMove = MOVE_NULL;

    this.sideToMove = this.sideToMove ^ 1;
    this.st = newSt;
    this.computeCheckers();
  }

  undoNullMove() {
    this.sideToMove = this.sideToMove ^ 1;
    this.st = this.st.previous;
  }

  /**
   * Get king square for a color
   */
  kingSquare(c) {
    return this.pieceCount[c][KING] > 0 ? this.pieceList[c][KING][0] : SQ_NONE;
  }

  /**
   * Check for draw by repetition
   */
  hasRepetition() {
    let cnt = 0;
    // Check back through state history
    for (let st = this.st.previous; st !== null; st = st.previous) {
      if (st.key === this.st.key) cnt++;
      if (cnt >= 2) return true;
      if (st.lastMove === MOVE_NULL) break;
    }
    return false;
  }

  /**
   * Get all pieces of a color as bitboard
   */
  pieces(c) {
    return this.byColorBB[c];
  }

  piecesByType(c, pt) {
    return this.byColorBB[c] & this.byTypeBB[pt];
  }

  nonPinnedPieces(c) {
    return this.byColorBB[c]; // Simplified
  }

  /**
   * Get piece on square
   */
  pieceOn(sq) {
    return this.board[sq];
  }

  /**
   * Get the piece that moved in the last move
   */
  movedPiece() {
    return this.board[toSq(this.st.lastMove)];
  }

  /**
   * Full position key
   */
  key() {
    return this.st.key;
  }

  /**
   * Check if current position is a draw
   */
  isDraw() {
    // Repetition
    if (this.hasRepetition()) return true;

    // Insufficient material check (simplified)
    // Each side needs at least attacking potential
    const wPieces = this.pieces(WHITE);
    const bPieces = this.pieces(BLACK);

    return false;
  }

  /**
   * Check if side to move has at least one legal move
   */
  hasLegalMove() {
    const moves = [];
    this.generateMoves(moves);
    for (const m of moves) {
      if (this.isLegalMove(m)) return true;
    }
    return false;
  }

  /**
   * Generate all pseudo-legal moves
   */
  generateMoves(moves) {
    const us = this.sideToMove;
    const them = us ^ 1;
    const ourPieces = this.pieces(us);

    let bbRef = { bb: ourPieces };
    let from;
    while ((from = this.popLsbBB(bbRef)) !== SQ_NONE) {
      const pc = this.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK:
          att = rookAttacks(from, this.occupied);
          break;
        case CANNON:
          att = cannonAttacks(from, this.occupied);
          break;
        case KNIGHT:
          att = knightAttacks(from, this.occupied);
          break;
        case BISHOP:
          att = bishopAttacks(from, this.occupied, us);
          break;
        case ADVISOR:
          att = advisorAttacks(from, us);
          break;
        case KING:
          att = kingAttacks(from, us);
          break;
        case PAWN:
          att = pawnAttacks(from, us);
          break;
      }

      // Filter out own pieces
      att &= ~this.byColorBB[us];

      let toRef = { bb: att };
      let to;
      while ((to = this.popLsbBB(toRef)) !== SQ_NONE) {
        moves.push(makeMove(from, to));
      }
    }
  }

  /**
   * Generate only captures
   */
  generateCaptures(moves) {
    const us = this.sideToMove;
    const them = us ^ 1;
    const ourPieces = this.pieces(us);
    const enemyPieces = this.pieces(them);

    let bbRef = { bb: ourPieces };
    let from;
    while ((from = this.popLsbBB(bbRef)) !== SQ_NONE) {
      const pc = this.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK:
          att = rookAttacks(from, this.occupied);
          break;
        case CANNON:
          att = cannonAttacks(from, this.occupied);
          break;
        case KNIGHT:
          att = knightAttacks(from, this.occupied);
          break;
        case BISHOP:
          att = bishopAttacks(from, this.occupied, us);
          break;
        case ADVISOR:
          att = advisorAttacks(from, us);
          break;
        case KING:
          att = kingAttacks(from, us);
          break;
        case PAWN:
          att = pawnAttacks(from, us);
          break;
      }

      // Only captures
      att &= enemyPieces;

      let toRef = { bb: att };
      let to;
      while ((to = this.popLsbBB(toRef)) !== SQ_NONE) {
        moves.push(makeMove(from, to));
      }
    }
  }

  /**
   * Generate all legal moves
   */
  generateLegalMoves(moves) {
    moves.length = 0;
    const us = this.sideToMove;
    const ourPiecesBB = this.pieces(us);

    let bbRef = { bb: ourPiecesBB };
    let from;
    while ((from = this.popLsbBB(bbRef)) !== SQ_NONE) {
      const pc = this.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK:    att = rookAttacks(from, this.occupied); break;
        case CANNON:  att = cannonAttacks(from, this.occupied); break;
        case KNIGHT:  att = knightAttacks(from, this.occupied); break;
        case BISHOP:  att = bishopAttacks(from, this.occupied, us); break;
        case ADVISOR: att = advisorAttacks(from, us); break;
        case KING:    att = kingAttacks(from, us); break;
        case PAWN:    att = pawnAttacks(from, us); break;
      }

      att &= ~this.byColorBB[us];

      let toRef = { bb: att };
      let to;
      while ((to = this.popLsbBB(toRef)) !== SQ_NONE) {
        const m = makeMove(from, to);
        if (this.isLegalMove(m)) {
          moves.push(m);
        }
      }
    }
  }

  /**
   * Evaluate SEE (Static Exchange Evaluation)
   */
  seeGE(m, threshold = 0) {
    const from = fromSq(m);
    const to = toSq(m);

    let balance = 0;
    const captured = this.board[to];
    if (captured !== NO_PIECE) {
      balance = PieceValue[EG][captured];
    }

    // If we capture a piece and our piece value - captured value is positive, it's good
    if (balance >= threshold) return true;

    const us = this.sideToMove;
    const pc = this.board[from];
    balance -= PieceValue[EG][pc];

    // Simple SEE: just check if immediate recapture loses material
    if (balance >= threshold) return true;

    return false; // Simplified SEE
  }

  /**
   * Get move string in UCI format
   */
  moveToString(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const f = fileOf(from), r = 9 - rankOf(from);
    const tf = fileOf(to), tr = 9 - rankOf(to);
    return String.fromCharCode(97 + f) + r + String.fromCharCode(97 + tf) + tr;
  }

  /**
   * Parse move from UCI string
   */
  moveFromString(str) {
    if (str.length < 4) return MOVE_NONE;
    const ff = str.charCodeAt(0) - 97;
    const fr = 9 - parseInt(str[1]);
    const tf = str.charCodeAt(2) - 97;
    const tr = 9 - parseInt(str[3]);
    const from = makeSquare(ff, fr);
    const to = makeSquare(tf, tr);
    if (!isOkSquare(from) || !isOkSquare(to)) return MOVE_NONE;
    return makeMove(from, to);
  }
}