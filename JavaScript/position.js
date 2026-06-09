/*
 * Pikafish Chinese Chess Engine - Position (full rewrite matching C++ position.cpp)
 */

import {
  SQUARE_NB, FILE_NB, RANK_NB,
  NORTH, SOUTH, EAST, WEST,
  WHITE, BLACK, COLOR_NB,
  NO_PIECE, NO_PIECE_TYPE, PIECE_NB, PIECE_TYPE_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING,
  colorOf, typeOf, makePiece, fileOf, rankOf, makeSquare, isOkSquare,
  fromSq, toSq, makeMove, MOVE_NONE, isOkMove,
  PieceValue,
  PieceToChar, PieceTypeToChar, FenPieceMap,
  VALUE_DRAW, VALUE_MATE, VALUE_NONE, VALUE_INFINITE, VALUE_KNOWN_WIN,
  VALUE_MATE_IN_MAX_PLY,
  mateIn, matedIn,
  MG, EG, SCORE_ZERO,
  makeScore, mgValue, egValue,
  SQ_A0, SQ_A9, SQ_NONE, SQ_I9,
  flipRank,
  makeKey as zobKey,
  MAX_PLY,
  relativeRankOf,
} from './pikafish_types.js';

import { psq } from './pikafish_evaluate.js';

import {
  bbSet, bbClr, bbTest, bbEmpty, popcount, lsb,
  SquareBB, FileBB, RankBB, PseudoAttacks, BetweenBB,
  attacksByPieceType as attacks_bb,
  rookAttacks, cannonAttacks, knightAttacks,
  bishopAttacks, advisorAttacks, kingAttacks, pawnAttacks,
  flyingGeneralCheck,
  checkersToKing,
  fileDistance,
} from './pikafish_bitboard.js';

// === Zobrist ===
let Zobrist_Pieces = null;
let Zobrist_Side = 0n;

function _prng(seedRef) {
  let s = seedRef[0];
  s = (s * 0x9E3779B1) >>> 0;
  const lo = ((s ^ (s >> 12)) * 0x85EBCA77) >>> 0;
  const hi = ((lo ^ (lo >> 19)) * 0x9E3779B9) >>> 0;
  seedRef[0] = (hi ^ (hi >> 16)) * 0x369DEA0F;
  const lo2 = seedRef[0] >>> 0;
  seedRef[0] = (seedRef[0] >>> 0);
  return BigInt(hi) * 0x100000000n + BigInt(lo2);
  // simpler: just use Math random with fixed hash
}

function initZobrist() {
  // Use the PRNG from Pikafish (PSKnight)
  if (Zobrist_Pieces) return;

  const seed = [1070372];
  function rand64() {
    let s = seed[0];
    s ^= s >> 12;
    s ^= s << 25;
    s ^= s >> 27;
    seed[0] = s;
    // Use multiply by magic to get 64-bit
    const lo = s >>> 0;
    seed[0] = (seed[0] * 6364136223846793005 + 1442695040888963407) >>> 0;
    const hi = seed[0] >>> 0;
    // Simple hash-based PRNG
    s = seed[0];
    return BigInt(Math.abs(s)) * 0x100000000n + BigInt(Math.abs(seed[0] ^ s));
  }

  // Better: use a fixed table (computed offline)
  // For simplicity, use deterministic values
  Zobrist_Pieces = Array(PIECE_NB);
  const primes = [
    0x9D39247E33776D41n, 0x2AF7398005AAA5C7n, 0x44DB015024623547n, 0x9C15F73E62A76AE2n,
    0x75834465489C0C89n, 0x3290AC3A203001BFn, 0x0FBBAD1F61042279n, 0xE83A908FF2FB60CAn,
    0x0D5CBF55E1623B34n, 0x3E7CEBBAE346E861n, 0x6D5EFC8F8E36C64Fn, 0xBB25F42A33E14B13n,
    0x1F9D7B3EDB2E8C45n, 0x462DD3C26C352A2En, 0x6C6911E72DDE9A47n, 0xA3B3A15E6E643C78n,
  ];
  for (let i = 0; i < PIECE_NB; i++) {
    Zobrist_Pieces[i] = Array(SQUARE_NB);
    for (let s = 0; s < SQUARE_NB; s++) {
      const idx = (i * SQUARE_NB + s) % primes.length;
      Zobrist_Pieces[i][s] = primes[idx] ^ BigInt(i * 701 + s * 503);
    }
  }
  Zobrist_Side = 0x6F8A1B4C3D2E5F97n;
}
initZobrist();

// === StateInfo ===
export class StateInfo {
  constructor() {
    this.key = 0n;
    this.pawnKey = 0n;
    this.materialKey = 0n;
    this.previous = null;
    this.lastMove = MOVE_NONE;
    this.capturedPiece = NO_PIECE;
    this.checkersBB = 0n;
    this.rule60 = 0;
    this.pliesFromNull = 0;
    this.repetition = 0;
    // Check info
    this.blockersForKing = [0n, 0n];
    this.pinners = [0n, 0n];
    this.checkSquares = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    this.needSlowCheck = false;
  }
}

// === Position ===
export class Position {
  constructor() {
    this.board = new Uint8Array(SQUARE_NB);
    this.byColorBB = [0n, 0n];
    this.byTypeBB = Array(PIECE_TYPE_NB).fill(0n);
    this.pieceCount = [Array(PIECE_TYPE_NB).fill(0), Array(PIECE_TYPE_NB).fill(0)];
    this.pieceList = Array.from({ length: COLOR_NB }, () =>
      Array.from({ length: PIECE_TYPE_NB }, () => new Int8Array(8))
    );
    this.index = Array.from({ length: COLOR_NB }, () => new Int8Array(SQUARE_NB).fill(-1));
    this.occupied = 0n;
    this.sideToMove = WHITE;
    this.gamePly = 0;
    this.st = new StateInfo();
    this.thisThread = null;
  }

  // ================= PIECE MANAGEMENT =================

  putPiece(pc, sq) {
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const bb = SquareBB[sq];

    this.board[sq] = pc;
    this.byColorBB[c] |= bb;
    this.byTypeBB[pt] |= bb;
    this.byTypeBB[0] |= bb;
    this.index[c][sq] = this.pieceCount[c][pt];
    this.pieceList[c][pt][this.pieceCount[c][pt]++] = sq;
    this.occupied |= bb;
  }

  removePiece(sq) {
    const pc = this.board[sq];
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const bb = SquareBB[sq];

    this.board[sq] = NO_PIECE;
    this.byColorBB[c] ^= bb;
    this.byTypeBB[pt] ^= bb;
    this.byTypeBB[0] ^= bb;
    this.occupied ^= bb;
    this.pieceCount[c][pt]--;
    const lastSq = this.pieceList[c][pt][this.pieceCount[c][pt]];
    const idx = this.index[c][sq];
    if (idx >= 0) {
      this.pieceList[c][pt][idx] = lastSq;
      this.index[c][lastSq] = idx;
      this.index[c][sq] = -1;
    }
  }

  movePiece(from, to) {
    const pc = this.board[from];
    const c = colorOf(pc);
    const pt = typeOf(pc);
    const fromBB = SquareBB[from], toBB = SquareBB[to];

    this.board[from] = NO_PIECE;
    this.board[to] = pc;
    this.byColorBB[c] ^= fromBB ^ toBB;
    this.byTypeBB[pt] ^= fromBB ^ toBB;
    this.byTypeBB[0] ^= fromBB ^ toBB;
    this.occupied ^= fromBB ^ toBB;

    const idx = this.index[c][from];
    this.index[c][to] = idx;
    this.pieceList[c][pt][idx] = to;
    this.index[c][from] = -1;
  }

  // ================= FEN =================

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

  set(fenStr, isChess960 = false, states = null) {
    this.clear();
    const tokens = fenStr.trim().split(/\s+/);
    const boardStr = tokens[0];
    const sideChar = (tokens[1] || 'w').toLowerCase();

    let rank = 9, file = 0;
    for (const ch of boardStr) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '9') { file += parseInt(ch); continue; }
      const pc = FenPieceMap[ch];
      if (pc !== undefined) {
        this.putPiece(pc, makeSquare(file, rank));
        file++;
      }
    }
    this.sideToMove = (sideChar === 'b') ? BLACK : WHITE;
    this.st = new StateInfo();
    this.setState(states);
  }

  fen() {
    let s = '';
    for (let r = RANK_NB - 1; r >= 0; r--) {
      let cnt = 0;
      for (let f = 0; f < FILE_NB; f++) {
        const pc = this.board[makeSquare(f, r)];
        if (pc === NO_PIECE) { cnt++; }
        else { if (cnt) { s += cnt; cnt = 0; } s += PieceToChar[pc]; }
      }
      if (cnt) s += cnt;
      if (r) s += '/';
    }
    s += (this.sideToMove === WHITE ? ' w' : ' b');
    return s;
  }

  // ================= STATE / CHECK INFO =================

  setState(si) {
    const st = this.st;

    // Initialize
    st.key = 0n;
    st.materialKey = 0n;
    st.material = [0, 0];

    // Compute checkers first (C++: checkers_to(~sideToMove, square<KING>(sideToMove)))
    const ksq = this.kingSquare(this.sideToMove);
    st.checkersBB = (ksq !== SQ_NONE) ? this.checkersTo(this.sideToMove ^ 1, ksq, this.occupied) : 0n;
    st.move = MOVE_NONE;

    // Set check info (blockers, pinners, needSlowCheck, checkSquares)
    this.setCheckInfo(st);

    // Hash key and material
    for (let s = 0; s < SQUARE_NB; s++) {
      const pc = this.board[s];
      if (pc !== NO_PIECE) {
        st.key ^= Zobrist_Pieces[pc][s];
        if (typeOf(pc) !== KING) {
          st.material[colorOf(pc)] += PieceValue[MG][pc];
        }
      }
    }
    if (this.sideToMove === BLACK) st.key ^= Zobrist_Side;

    // Material key: hash each piece with its count index
    for (let c = 0; c < COLOR_NB; c++) {
      for (let pt = ROOK; pt <= KING; pt++) {
        for (let cnt = 0; cnt < this.pieceCount[c][pt]; cnt++) {
          st.materialKey ^= Zobrist_Pieces[makePiece(c, pt)][cnt];
        }
      }
    }

    // rule60
    st.rule60 = 0;
    st.pliesFromNull = 0;
    st.repetition = 0;
  }

  setCheckInfo(st) {
    const us = this.sideToMove;
    const them = us ^ 1;
    const uksq = this.kingSquare(us);
    const oksq = this.kingSquare(them);

    // Both sides' blockers and pinners (C++: blockers_for_king for both sides)
    st.blockersForKing[us] = this.computeBlockers(this.byColorBB[them], uksq, st, us, false);
    st.blockersForKing[them] = this.computeBlockers(this.byColorBB[us], oksq, st, them, true);

    // needSlowCheck: in check, or enemy cannons can attack via rook lines
    st.needSlowCheck = (st.checkersBB !== 0n) ||
      ((PseudoAttacks[ROOK][uksq] & this.byTypeBB[CANNON] & this.byColorBB[them]) !== 0n);

    // Check squares: squares that give check to opponent's king
    st.checkSquares[PAWN]   = this._pawnAttacksTo(us, oksq);
    st.checkSquares[KNIGHT] = knightAttacks(oksq, this.occupied);
    st.checkSquares[CANNON] = cannonAttacks(oksq, this.occupied);
    st.checkSquares[ROOK]   = rookAttacks(oksq, this.occupied);
    st.checkSquares[KING]   = 0n;
    st.checkSquares[ADVISOR] = 0n;
    st.checkSquares[BISHOP] = 0n;
  }

  // C++ blockers_for_king: finds pieces blocking slider attacks on square s
  // sliders param: bitboard of enemy pieces to consider as snipers
  // pinnersOutRef: which StateInfo's pinners array to write to
  // pinColor: color to check for pinned pieces
  // isThemSide: whether setting blockersForKing[them] (swaps pinners index)
  computeBlockers(sliders, s, st, pinColor, isThemSide) {
    let blockers = 0n;
    const sniperColor = isThemSide ? pinColor : (pinColor ^ 1);
    // Set pinners for the appropriate side
    const pinnIdx = isThemSide ? pinColor : (pinColor ^ 1);

    // Snipers: rook pseudo attacks from s intersecting with enemy rooks/cannons/kings, plus knight pseudo attacks
    const snipers = (
      (PseudoAttacks[ROOK][s] & (this.byTypeBB[ROOK] | this.byTypeBB[CANNON] | this.byTypeBB[KING])) |
      (PseudoAttacks[KNIGHT][s] & this.byTypeBB[KNIGHT])
    ) & sliders;

    // Occupancy with snipers removed (except cannons, which need mount pieces)
    let occupancy = this.occupied ^ (snipers & ~this.byTypeBB[CANNON]);

    let sniperBB = snipers;
    while (sniperBB !== 0n) {
      const sniperSq = lsb(sniperBB);
      sniperBB ^= SquareBB[sniperSq];
      const sniperPc = this.board[sniperSq];
      const isCannon = typeOf(sniperPc) === CANNON;

      const b = BetweenBB[s][sniperSq] !== undefined ? BetweenBB[s][sniperSq] : 0n;
      const betweenPieces = b & (isCannon ? (this.occupied ^ SquareBB[sniperSq]) : occupancy);

      if (!bbEmpty(betweenPieces)) {
        const cnt = popcount(betweenPieces);
        const valid = isCannon ? (cnt === 2) : (cnt === 1);

        if (valid) {
          blockers |= betweenPieces;
          if (betweenPieces & this.byColorBB[pinColor]) {
            st.pinners[pinnIdx] |= SquareBB[sniperSq];
          }
        }
      }
    }
    return blockers;
  }

  // Helper: pawn squares that attack a given square for a given color
  _pawnAttacksTo(c, s) {
    let result = 0n;
    const f = fileOf(s), r = rankOf(s);
    // WHITE pawns move up (NORTH), attack NORTH-EAST and NORTH-WEST
    // BLACK pawns move down (SOUTH), attack SOUTH-EAST and SOUTH-WEST
    const dir = c === WHITE ? -1 : 1; // rank offset for attacker
    const attacks = [
      { df: -1, dr: dir }, { df: 1, dr: dir }
    ];
    for (const {df, dr} of attacks) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < FILE_NB && nr >= 0 && nr < RANK_NB) {
        // For black pawns: after crossing river (rank <= 4), can also move sideways
        // But for pawn_attacks_to, we just check if a pawn at (nf, nr) can attack s
        // A pawn at (nf, nr) attacks s if s is one step forward for that pawn
        // WHITE pawn at (nf, nr) attacks s if s is at (nf-1, nr-1) or (nf+1, nr-1)
        // This is the same logic reversed
        result |= SquareBB[makeSquare(nf, nr)];
      }
    }
    return result;
  }

  between(s1, s2) {
    // Use the LineBB/BetweenBB from bitboard
    // For ortho, sliding pieces: compute squares between two aligned squares
    const f1 = fileOf(s1), r1 = rankOf(s1);
    const f2 = fileOf(s2), r2 = rankOf(s2);

    if (f1 === f2 || r1 === r2) {
      // Same file or rank
      let bb = 0n;
      const step = f1 === f2 ? (r2 > r1 ? NORTH : SOUTH) : (f2 > f1 ? EAST : WEST);
      for (let s = s1 + step; s !== s2; s += step) {
        bb |= SquareBB[s];
      }
      return bb;
    }
    return 0n;
  }

  // ================= MOVE EXECUTION =================

  doMove(m, newSt = null) {
    if (!newSt) newSt = new StateInfo();
    const us = this.sideToMove;
    const them = us ^ 1;
    const from = fromSq(m);
    const to = toSq(m);
    const pc = this.board[from];
    const captured = this.board[to];

    // Copy old state fields (before key offset) to new state (C++ memcpy pattern)
    newSt.materialKey = this.st.materialKey;
    newSt.rule60 = this.st.rule60;
    newSt.pliesFromNull = this.st.pliesFromNull;
    newSt.previous = this.st;

    this.st = newSt;
    this.st.move = m;

    // Increment ply counters
    this.gamePly++;
    this.st.rule60++;
    this.st.pliesFromNull++;

    // Hash key update
    let k = this.st.previous.key ^ Zobrist_Side;

    // Capture handling (C++: capture before move_piece)
    if (captured !== NO_PIECE) {
      const capsq = to;

      // Remove captured piece from board
      this.removePiece(capsq);

      // Update hash key
      k ^= Zobrist_Pieces[captured][capsq];
      this.st.materialKey ^= Zobrist_Pieces[captured][this.pieceCount[them][typeOf(captured)]];

      // Reset rule 60 counter on capture
      this.st.rule60 = 0;
    }

    // Update hash key for the moving piece
    k ^= Zobrist_Pieces[pc][from] ^ Zobrist_Pieces[pc][to];

    // Move the piece (C++: move_piece, not remove+put)
    this.movePiece(from, to);

    // Set captured piece in state
    this.st.capturedPiece = captured;

    // Store the final key
    this.st.key = k;

    // Calculate checkers (simplified: we compute after side switch)
    const givesCheck = this.givesCheckPostMove(m, us);
    this.st.checkersBB = givesCheck ? this.checkersTo(us, this.kingSquare(them), this.occupied) : 0n;

    // Switch sides
    this.sideToMove = them;

    // Set check info for new position
    this.setCheckInfo(this.st);

    // Verify legality: our king must not be in check after the move
    if (this.isKingInCheck(us)) {
      this.undoMove(m);
      return false;
    }

    return true;
  }

  // Post-move gives check detection (used after move_piece)
  givesCheckPostMove(m, us) {
    const from = fromSq(m);
    const to = toSq(m);
    const them = us ^ 1;
    const oksq = this.kingSquare(them);
    if (oksq === SQ_NONE) return false;

    const pc = this.board[to]; // piece is now at 'to'
    const pt = typeOf(pc);

    // Direct check
    if (pt === CANNON) {
      if (cannonAttacks(to, this.occupied) & SquareBB[oksq]) return true;
    } else if (this.st.checkSquares[pt] && (this.st.checkSquares[pt] & SquareBB[to])) {
      return true;
    }

    // Discovered check: if the moved piece was blocking a slider
    if (this.st.previous.blockersForKing[them] & SquareBB[from]) {
      return true;
    }

    return false;
  }

  // C++ Position::undo_move() - unmakes a move
  undoMove(m) {
    this.sideToMove ^= 1;

    const from = fromSq(m);
    const to = toSq(m);

    // Move piece back (C++: move_piece(to, from))
    this.movePiece(to, from);

    // Restore captured piece if any
    if (this.st.capturedPiece !== NO_PIECE) {
      this.putPiece(this.st.capturedPiece, to);
    }

    // Restore previous state
    this.st = this.st.previous;
    this.gamePly--;
  }

  doNullMove() {
    const newSt = new StateInfo();
    newSt.previous = this.st;
    newSt.lastMove = MOVE_NONE;
    newSt.capturedPiece = NO_PIECE;
    newSt.key = this.st.key ^ Zobrist_Side;
    newSt.pawnKey = this.st.pawnKey;
    newSt.materialKey = this.st.materialKey;
    newSt.rule60 = this.st.rule60 + 1;
    newSt.pliesFromNull = -1;

    this.sideToMove ^= 1;
    this.st = newSt;
    this.setCheckInfo(newSt);
    return true;
  }

  undoNullMove() {
    this.sideToMove ^= 1;
    this.st = this.st.previous;
  }

  // ================= LEGALITY CHECKS =================

  isKingInCheck(c) {
    const ksq = this.kingSquare(c);
    if (ksq === SQ_NONE) return true;
    return (checkersToKing(this, ksq, c ^ 1) !== 0n);
  }

  checkers() {
    return this.st.checkersBB;
  }

  inCheck() {
    return this.st.checkersBB !== 0n;
  }

  // C++ Position::legal() - tests whether a pseudo-legal move is legal
  legal(m) {
    const us = this.sideToMove;
    const from = fromSq(m);
    const to = toSq(m);
    const pc = this.board[from];

    if (colorOf(pc) !== us) return false;
    if (!this.pseudoLegal(m)) return false;

    const them = us ^ 1;
    // Occupancy after the move
    const occupied = (this.occupied ^ SquareBB[from]) | SquareBB[to];
    // King square: if moving king, it's 'to', otherwise the current king square
    const ksq = typeOf(pc) === KING ? to : this.kingSquare(us);

    // Fast path: non-king move, not pinned, no slow check needed
    if (!this.st.needSlowCheck && ksq !== to && !(this.st.blockersForKing[us] & SquareBB[from]))
      return true;

    // King move: check destination is not attacked by opponent
    if (typeOf(pc) === KING)
      return !this.checkersTo(them, to, occupied);

    // Non-king move: king must not be under attack after the move
    return !(this.checkersTo(them, ksq, occupied) & ~SquareBB[to]);
  }

  // C++ checkers_to: pieces of color c that give check to square s
  checkersTo(c, s, occupied) {
    return (
      (this._pawnAttacksTo(c, s) & this.byTypeBB[PAWN]) |
      (knightAttacks(s, occupied) & this.byTypeBB[KNIGHT]) |
      (rookAttacks(s, occupied) & (this.byTypeBB[ROOK] | this.byTypeBB[KING])) |
      (cannonAttacks(s, occupied) & this.byTypeBB[CANNON])
    ) & this.byColorBB[c];
  }

  checkSquaresContain(to, us) {
    // Check if square to is in any checkSquares entry
    // Simplified: always return false for now (force slow check)
    return false;
  }

  doSimpleMove(from, to) {
    const pc = this.board[from];
    const captured = this.board[to];
    this.removePiece(from);
    if (captured !== NO_PIECE) this.removePiece(to);
    this.putPiece(pc, to);
  }

  undoSimpleMove(from, to, pc, captured) {
    this.removePiece(to);
    if (captured !== NO_PIECE) this.putPiece(captured, to);
    this.putPiece(pc, from);
  }

  pseudoLegal(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const us = this.sideToMove;
    const pc = this.board[from];
    const captured = this.board[to];

    if (pc === NO_PIECE || colorOf(pc) !== us) return false;
    if (captured !== NO_PIECE && colorOf(captured) === us) return false;

    const pt = typeOf(pc);
    let att;

    switch (pt) {
      case ROOK:
        att = rookAttacks(from, this.occupied);
        return bbTest(att, to);
      case CANNON:
        att = cannonAttacks(from, this.occupied);
        return bbTest(att, to);
      case KNIGHT:
        att = knightAttacks(from, this.occupied);
        return bbTest(att, to);
      case BISHOP:
        att = bishopAttacks(from, this.occupied, us);
        return bbTest(att, to);
      case ADVISOR:
        att = advisorAttacks(from, us);
        return bbTest(att, to);
      case KING:
        // Check flying general: king can't face the other king
        const enemyKing = this.kingSquare(us ^ 1);
        if (enemyKing !== SQ_NONE && fileOf(to) === fileOf(enemyKing)) {
          // Check if there are pieces between them
          const between = this.between(to, enemyKing);
          if (between === 0n || (between & this.occupied & ~SquareBB[from]) === 0n) {
            // No pieces between the two kings after the move
            // This only matters if the old king square was part of the between
          }
        }
        att = kingAttacks(from, us);
        return bbTest(att, to);
      case PAWN:
        att = pawnAttacks(from, us);
        return bbTest(att, to);
      default:
        return false;
    }
  }

  isLegalMove(m) { return this.legal(m); }

  givesCheck(m) {
    const from = fromSq(m);
    const to = toSq(m);
    const us = this.sideToMove;
    const them = us ^ 1;
    const pc = this.board[from];
    const pt = typeOf(pc);

    // Direct check
    if (pt !== PAWN) {
      const enemyKing = this.kingSquare(them);
      if (enemyKing !== SQ_NONE) {
        const att = attacks_bb(pt, to, us, this.occupied);
        if (att & SquareBB[enemyKing]) return true;
      }
    }

    // Discovery check
    const st = this.st;
    if (st.blockersForKing[them] & SquareBB[from]) {
      return true;
    }

    return false;
  }

  // ================= ACCESSORS =================

  sideToMoveF() { return this.sideToMove; }
  pieces(c) { return this.byColorBB[c]; }
  piecesByType(c, pt) { return this.byColorBB[c] & this.byTypeBB[pt]; }
  pieceOn(sq) { return this.board[sq]; }
  kingSquare(c) { return this.pieceCount[c][KING] > 0 ? this.pieceList[c][KING][0] : SQ_NONE; }
  key() { return this.st.key; }
  pawnKey() { return this.st.pawnKey; }
  materialKey() { return this.st.materialKey; }
  capturedPiece() { return this.st.capturedPiece; }
  thisThreadF() { return this.thisThread; }

  // Piece count methods
  countPiece(c, pt) { return this.pieceCount[c][pt]; }
  countAll(c) {
    let cnt = 0;
    for (let pt = ROOK; pt <= BISHOP; pt++) cnt += this.pieceCount[c][pt];
    return cnt + this.pieceCount[c][KING];
  }

  // Material calculation (from incremental tracking, matching C++)
  material(c) {
    return this.st.material ? this.st.material[c] : 0;
  }

  materialSum() {
    return this.material(WHITE) + this.material(BLACK);
  }

  materialDiff() {
    return this.material(WHITE) - this.material(BLACK);
  }

  // PSQT score
  psqScore() {
    let score = 0;
    for (let sq = 0; sq < SQUARE_NB; sq++) {
      const pc = this.board[sq];
      if (pc !== NO_PIECE && psq[pc]) {
        score = score + psq[pc][sq];
      }
    }
    return score;
  }

  // Alias for occupied property - directly accessible
  get occupiedBB() { return this.occupied; }

  // Blockers for king accessor
  get blockersForKing() { return this.st.blockersForKing; }

  // Rule60 count
  get rule60() { return this.st.rule60; }

  movedPiece(m) {
    if (m === MOVE_NONE) return NO_PIECE;
    // After undoMove, the moved piece is back at fromSq
    return this.board[fromSq(m)];
  }

  capture(m) {
    if (m === MOVE_NONE) return false;
    const to = toSq(m);
    return this.board[to] !== NO_PIECE;
  }

  hasRepetition() {
    let cnt = 0;
    for (let st = this.st.previous; st; st = st.previous) {
      if (st.key === this.st.key && ++cnt >= 2) return true;
      if (st.rule60 <= 0) break;
    }
    return false;
  }

  isDraw(ply = 0) {
    return this.hasRepetition();
  }

  hasLegalMove() {
    const moves = new MoveList();
    for (const m of MoveListGen.LEGAL(this)) return true;
    return false;
  }

  // ================= MOVE GENERATION =================

  generateLegalMoves(arr) {
    arr.length = 0;
    for (const m of MoveListGen.LEGAL(this)) {
      arr.push(m);
    }
  }

  generateMoves(arr) {
    arr.length = 0;
    for (const m of MoveListGen.ALL(this)) {
      arr.push(m);
    }
  }

  generateCaptures(arr) {
    arr.length = 0;
    for (const m of MoveListGen.CAPTURES(this)) {
      arr.push(m);
    }
  }

  generateLegalCaptures(arr) {
    arr.length = 0;
    for (const m of MoveListGen.CAPTURES(this)) {
      if (this.isLegalMove(m)) arr.push(m);
    }
  }

  moveToString(m) {
    if (m === MOVE_NONE) return '0000';
    const from = fromSq(m), to = toSq(m);
    return String.fromCharCode(97 + fileOf(from)) + (9 - rankOf(from))
         + String.fromCharCode(97 + fileOf(to)) + (9 - rankOf(to));
  }

  moveFromString(s) {
    if (!s || s.length < 4) return MOVE_NONE;
    const ff = s.charCodeAt(0) - 97;
    const fr = 9 - parseInt(s[1]);
    const tf = s.charCodeAt(2) - 97;
    const tr = 9 - parseInt(s[3]);
    const from = makeSquare(ff, fr), to = makeSquare(tf, tr);
    if (!isOkSquare(from) || !isOkSquare(to)) return MOVE_NONE;
    return makeMove(from, to);
  }

  seeGE(m, threshold = 0) {
    const to = toSq(m);
    let val = 0;
    const captured = this.board[to];
    if (captured !== NO_PIECE) {
      const pt = typeOf(captured);
      val = PieceValue[EG][captured];
    }
    // Simple SEE (not full implementation)
    return val >= threshold;
  }

  // ================= RULE JUDGE (for chinese chess rules) =================

  ruleJudge(result, ply) {
    // Check repetition
    if (this.hasRepetition()) {
      result.value = VALUE_DRAW;
      return true;
    }
    return false;
  }

  rule60Count() {
    return this.st.rule60;
  }
}

// ================= MoveList Generator =================

export class MoveList {
  constructor() {
    this.moves = new Int32Array(128);
    this.size = 0;
  }
  push(m) { this.moves[this.size++] = m; }
  get(i) { return this.moves[i]; }
  [Symbol.iterator]() {
    let i = 0;
    return { next: () => ({ value: i < this.size ? this.moves[i] : undefined, done: i++ >= this.size }) };
  }
}

export class MoveListGen {
  static *LEGAL(pos) {
    const us = pos.sideToMove;
    const ourPieces = pos.pieces(us);

    let bb = ourPieces;
    while (bb !== 0n) {
      const from = lsb(bb);
      bb ^= SquareBB[from];
      const pc = pos.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK: att = rookAttacks(from, pos.occupied); break;
        case CANNON: att = cannonAttacks(from, pos.occupied); break;
        case KNIGHT: att = knightAttacks(from, pos.occupied); break;
        case BISHOP: att = bishopAttacks(from, pos.occupied, us); break;
        case ADVISOR: att = advisorAttacks(from, us); break;
        case KING: att = kingAttacks(from, us); break;
        case PAWN: att = pawnAttacks(from, us); break;
      }
      att &= ~pos.byColorBB[us];

      let toBB = att;
      while (toBB !== 0n) {
        const to = lsb(toBB);
        toBB ^= SquareBB[to];
        const m = makeMove(from, to);
        if (pos.legal(m)) yield m;
      }
    }
  }

  static *ALL(pos) {
    const us = pos.sideToMove;
    const ourPieces = pos.pieces(us);

    let bb = ourPieces;
    while (bb !== 0n) {
      const from = lsb(bb);
      bb ^= SquareBB[from];
      const pc = pos.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK: att = rookAttacks(from, pos.occupied); break;
        case CANNON: att = cannonAttacks(from, pos.occupied); break;
        case KNIGHT: att = knightAttacks(from, pos.occupied); break;
        case BISHOP: att = bishopAttacks(from, pos.occupied, us); break;
        case ADVISOR: att = advisorAttacks(from, us); break;
        case KING: att = kingAttacks(from, us); break;
        case PAWN: att = pawnAttacks(from, us); break;
      }
      att &= ~pos.byColorBB[us];

      let toBB = att;
      while (toBB !== 0n) {
        const to = lsb(toBB);
        toBB ^= SquareBB[to];
        yield makeMove(from, to);
      }
    }
  }

  static *CAPTURES(pos) {
    const us = pos.sideToMove;
    const them = us ^ 1;
    const ourPieces = pos.pieces(us);
    const enemyPieces = pos.pieces(them);

    let bb = ourPieces;
    while (bb !== 0n) {
      const from = lsb(bb);
      bb ^= SquareBB[from];
      const pc = pos.board[from];
      const pt = typeOf(pc);

      let att = 0n;
      switch (pt) {
        case ROOK: att = rookAttacks(from, pos.occupied); break;
        case CANNON: att = cannonAttacks(from, pos.occupied); break;
        case KNIGHT: att = knightAttacks(from, pos.occupied); break;
        case BISHOP: att = bishopAttacks(from, pos.occupied, us); break;
        case ADVISOR: att = advisorAttacks(from, us); break;
        case KING: att = kingAttacks(from, us); break;
        case PAWN: att = pawnAttacks(from, us); break;
      }
      att &= enemyPieces;

      let toBB = att;
      while (toBB !== 0n) {
        const to = lsb(toBB);
        toBB ^= SquareBB[to];
        yield makeMove(from, to);
      }
    }
  }
}