/*
 * position.js - Position representation and move generation.
 * Ported from Pikafish (https://github.com/official-pikafish/Pikafish)
 *
 * Each Position stores:
 *   - byColorBB[2]: bitboard of all red/black pieces
 *   - byTypeBB[7]:  bitboard of each piece type (both colors)
 *   - pieceOn[90]:  piece code (0 empty, 8..14 = red pieces, 16..22 = black)
 *   - kingSq[2]:    square index of red/black king
 *   - sideToMove:   0 = red, 1 = black
 *   - st:           state stack for undo info (captured piece, hash, etc.)
 */
"use strict";

// Internal piece codes: see type_of()/color_of() in cchess.js
// We use piece = SIDE_TAG(color) + type  ->  red king=8 ... red pawn=14
//                                          black king=16 ... black pawn=22

function empty_state() {
  return {
    captured: 0,         // 0 if no capture
    move: 0,
    hash: 0n,
    rule50: 0,
    lastIrrev: 0
  };
}

function Position() {
  this.byColorBB = [0n, 0n];
  this.byTypeBB  = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
  this.pieceOn   = new Array(90);
  for (var i = 0; i < 90; i++) this.pieceOn[i] = 0;
  this.kingSq    = [-1, -1];
  this.sideToMove = RED;
  this.st         = [empty_state()];
  this.nodes      = 0;
  this.history    = [];     // for repetition detection
}

Position.prototype.clear = function() {
  this.byColorBB = [0n, 0n];
  this.byTypeBB  = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
  for (var i = 0; i < 90; i++) this.pieceOn[i] = 0;
  this.kingSq    = [-1, -1];
  this.sideToMove = RED;
  this.st         = [empty_state()];
  this.history    = [];
  this.nodes      = 0;
};

Position.prototype.put_piece = function(pc, sq) {
  this.pieceOn[sq] = pc;
  var c = color_of(pc);
  var t = type_of(pc);
  this.byColorBB[c] |= (ONE << BigInt(sq));
  this.byTypeBB[t]  |= (ONE << BigInt(sq));
  if (t === KING) this.kingSq[c] = sq;
};

Position.prototype.remove_piece = function(sq) {
  var pc = this.pieceOn[sq];
  if (pc === 0) return 0;
  var c = color_of(pc);
  var t = type_of(pc);
  this.byColorBB[c] &= ~(ONE << BigInt(sq));
  this.byTypeBB[t]  &= ~(ONE << BigInt(sq));
  this.pieceOn[sq] = 0;
  return pc;
};

Position.prototype.move_piece = function(from, to) {
  var pc = this.pieceOn[from];
  var c = color_of(pc);
  var t = type_of(pc);
  var bit = (ONE << BigInt(from)) | (ONE << BigInt(to));
  this.byColorBB[c] ^= bit;
  this.byTypeBB[t]  ^= bit;
  this.pieceOn[from] = 0;
  this.pieceOn[to]   = pc;
  if (t === KING) this.kingSq[c] = to;
};

// FEN parsing. Supports the standard FEN used by Pikafish / UCCI.
Position.prototype.set_fen = function(fen) {
  this.clear();
  var parts = fen.split(/\s+/);
  var boardStr = parts[0];
  var idx = 0;
  var f = 0, r = 0;
  for (var i = 0; i < boardStr.length; i++) {
    var c = boardStr.charAt(i);
    if (c === '/') { f = 0; r++; continue; }
    if (c >= '0' && c <= '9') { f += parseInt(c, 10); continue; }
    var lo = FEN_PIECE_LO.indexOf(c);
    var up = FEN_PIECE_UP.indexOf(c);
    var t = lo >= 0 ? lo : up;
    if (t < 0) { f++; continue; }
    var pc = t + (up >= 0 ? 16 : 8);
    this.put_piece(pc, f + r * 9);
    f++;
  }
  this.sideToMove = (parts[1] === 'b' || parts[1] === 'B') ? BLACK : RED;
  this.history = [];
  this.st = [empty_state()];
  this.st[0].hash = compute_hash(this);
  this.st[0].rule50 = 0;
};

Position.prototype.to_fen = function() {
  var s = "";
  for (var r = 0; r < 10; r++) {
    var empty = 0;
    for (var f = 0; f < 9; f++) {
      var pc = this.pieceOn[f + r * 9];
      if (pc === 0) { empty++; continue; }
      if (empty > 0) { s += empty.toString(); empty = 0; }
      var t = type_of(pc);
      var c = color_of(pc);
      s += c === RED ? FEN_PIECE_LO.charAt(t) : FEN_PIECE_UP.charAt(t);
    }
    if (empty > 0) s += empty.toString();
    if (r < 9) s += "/";
  }
  s += (this.sideToMove === RED ? " w" : " b");
  return s;
};

// Occupied bitboard (all pieces)
Position.prototype.occupied_bb = function() {
  return this.byColorBB[0] | this.byColorBB[1];
};

// True if the side-to-move's king is in check
Position.prototype.in_check = function() {
  return this.attackers_to(this.kingSq[this.sideToMove], 1 - this.sideToMove) !== 0n;
};

// Bitboard of opponent pieces that attack the given square.
Position.prototype.attackers_to = function(sq, byColor) {
  var occ = this.occupied_bb();
  var att = 0n;
  // Pawn attacks: use the pre-computed inverse attack pattern, then mask by
  // the actual pawn pieces of `byColor` so we don't pick up unrelated pieces
  // that happen to sit on the candidate squares.
  if (byColor === RED) {
    att |= PAWN_ATT_RED[sq] & this.byTypeBB[PAWN] & this.byColorBB[byColor];
  } else {
    att |= PAWN_ATT_BLACK[sq] & this.byTypeBB[PAWN] & this.byColorBB[byColor];
  }
  // Knight
  att |= KNIGHT_ATT[sq] & this.byTypeBB[KNIGHT] & this.byColorBB[byColor];
  // Bishop
  att |= BISHOP_ATT[sq] & this.byTypeBB[BISHOP] & this.byColorBB[byColor];
  // Advisor
  att |= ADVISOR_ATT[sq] & this.byTypeBB[ADVISOR] & this.byColorBB[byColor];
  // King (relevant for face-to-face kings)
  att |= KING_ATT[sq] & this.byTypeBB[KING] & this.byColorBB[byColor];
  // Rook
  att |= rook_attacks(sq, occ) & this.byTypeBB[ROOK] & this.byColorBB[byColor];
  // Cannon
  att |= cannon_attacks(sq, occ) & this.byTypeBB[CANNON] & this.byColorBB[byColor];
  return att;
};

// Apply a move to the position. Returns true if legal (not leaving king in check).
Position.prototype.do_move = function(mv) {
  var from = SRC(mv), to = DST(mv);
  var me   = this.sideToMove;
  var pc   = this.pieceOn[from];
  if (pc === 0 || color_of(pc) !== me) return false;
  var captured = this.remove_piece(to);
  this.move_piece(from, to);

  // Save state for undo
  var st = {
    captured: captured,
    move: mv,
    hash: this.st[this.st.length - 1].hash,
    rule50: this.st[this.st.length - 1].rule50 + 1,
    lastIrrev: this.st[this.st.length - 1].lastIrrev + (captured ? 1 : 0)
  };
  this.st.push(st);
  this.sideToMove = 1 - this.sideToMove;
  this.history.push(this.st[this.st.length - 1].hash);
  // Re-compute hash for the new state (simple approach: compute full zobrist)
  this.st[this.st.length - 1].hash = compute_hash(this);

  if (this.attackers_to(this.kingSq[me], 1 - me) !== 0n) {
    this.undo_move();
    return false;
  }
  return true;
};

Position.prototype.undo_move = function() {
  if (this.st.length <= 1) return;
  var st  = this.st.pop();
  this.history.pop();
  this.sideToMove = 1 - this.sideToMove;
  var mv = st.move;
  var from = SRC(mv), to = DST(mv);
  this.move_piece(to, from);
  if (st.captured) this.put_piece(st.captured, to);
};

Position.prototype.do_null_move = function() {
  var st = {
    captured: 0,
    move: 0,
    hash: this.st[this.st.length - 1].hash,
    rule50: this.st[this.st.length - 1].rule50 + 1,
    lastIrrev: this.st[this.st.length - 1].lastIrrev + 1
  };
  this.st.push(st);
  this.sideToMove = 1 - this.sideToMove;
  this.history.push(st.hash);
};

Position.prototype.undo_null_move = function() {
  if (this.st.length <= 1) return;
  this.st.pop();
  this.history.pop();
  this.sideToMove = 1 - this.sideToMove;
};

// Generate pseudo-legal moves into a passed-in array. Returns the array.
Position.prototype.generate_pseudo = function(mvs) {
  var me  = this.sideToMove;
  var occ = this.occupied_bb();
  var myB = this.byColorBB[me];
  var opp = 1 - me;

  // Iterate over our pieces
  var ours = myB;
  while (ours !== 0n) {
    var from = bb_lsb(ours);
    ours &= ours - 1n;
    var pc = this.pieceOn[from];
    var t  = type_of(pc);
    var att = 0n;
    switch (t) {
      case KING:
        att = KING_ATT[from] & ~myB;
        // Restrict to palace
        att &= palace_of(me);
        break;
      case ADVISOR:
        att = ADVISOR_ATT[from] & ~myB;
        att &= palace_of(me);
        break;
      case BISHOP: {
        // Bishop moves 2 diagonally; blocking square must be empty
        var raw = 0n;
        for (var d = 0; d < 4; d++) {
          var mid = from + BISHOP_BLOCKS[d];
          var to2 = from + BISHOP_TARGETS[d];
          if (to2 < 0 || to2 >= 90) continue;
          if (Math.abs(file_of(to2) - file_of(from)) !== 2) continue;
          if (own_half(to2, me) !== own_half(from, me)) continue;
          if (this.pieceOn[mid] !== 0) continue;
          raw |= ONE << BigInt(to2);
        }
        att = raw & ~myB;
        break;
      }
      case KNIGHT: {
        var raw = 0n;
        for (var g = 0; g < 4; g++) {
          var block = from + KNIGHT_BLOCK_DELTAS[g];
          if (block < 0 || block >= 90) continue;
          if (this.pieceOn[block] !== 0) continue;
          for (var k2 = 0; k2 < 2; k2++) {
            var to2 = from + KNIGHT_TARGETS[g][k2];
            if (to2 < 0 || to2 >= 90) continue;
            if (Math.abs(file_of(to2) - file_of(from)) > 2) continue;
            if (Math.abs(rank_of(to2) - rank_of(from)) > 2) continue;
            raw |= ONE << BigInt(to2);
          }
        }
        att = raw & ~myB;
        break;
      }
      case ROOK:
        att = rook_attacks(from, occ) & ~myB;
        break;
      case CANNON: {
        // Empty squares + one jump for capture
        var nonCap = rook_attacks(from, occ) & ~occ;
        var cap = cannon_attacks(from, occ) & ~nonCap & this.byColorBB[opp];
        att = nonCap | cap;
        break;
      }
      case PAWN: {
        var forward = me === RED ? -9 : +9;
        var raw2 = 0n;
        var toF = from + forward;
        if (toF >= 0 && toF < 90 && file_of(toF) === file_of(from))
          raw2 |= ONE << BigInt(toF);
        if ((me === RED && rank_of(from) <= 4) ||
            (me === BLACK && rank_of(from) >= 5)) {
          if (from % 9 > 0) raw2 |= ONE << BigInt(from - 1);
          if (from % 9 < 8) raw2 |= ONE << BigInt(from + 1);
        }
        att = raw2 & ~myB;
        break;
      }
    }
    while (att !== 0n) {
      var to = bb_lsb(att);
      att &= att - 1n;
      // Face-to-face kings: when both kings are on the same file with no pieces between,
      // moving the king along the file is illegal because the kings would face. We filter
      // that via legal filtering after move is made. For pseudo we still emit the move.
      mvs.push(MOVE(from, to));
    }
  }
  return mvs;
};

// Generate only captures (for quiescence)
Position.prototype.generate_captures = function(mvs) {
  var me  = this.sideToMove;
  var opp = 1 - me;
  var myB = this.byColorBB[me];
  var oppB= this.byColorBB[opp];
  var occ = myB | oppB;

  // Iterate over our pieces that have at least one capture available
  var ours = myB;
  while (ours !== 0n) {
    var from = bb_lsb(ours);
    ours &= ours - 1n;
    var pc = this.pieceOn[from];
    var t  = type_of(pc);
    var att = 0n;
    switch (t) {
      case ROOK:
        att = rook_attacks(from, occ) & oppB;
        break;
      case CANNON:
        att = cannon_attacks(from, occ) & oppB;
        break;
      case PAWN: {
        var forward = me === RED ? -9 : +9;
        var toF = from + forward;
        if (toF >= 0 && toF < 90 && file_of(toF) === file_of(from))
          if (((oppB >> BigInt(toF)) & 1n) !== 0n) att |= ONE << BigInt(toF);
        if ((me === RED && rank_of(from) <= 4) ||
            (me === BLACK && rank_of(from) >= 5)) {
          if (from % 9 > 0 && ((oppB >> BigInt(from - 1)) & 1n) !== 0n) att |= ONE << BigInt(from - 1);
          if (from % 9 < 8 && ((oppB >> BigInt(from + 1)) & 1n) !== 0n) att |= ONE << BigInt(from + 1);
        }
        break;
      }
      case KNIGHT: {
        for (var g = 0; g < 4; g++) {
          var block = from + KNIGHT_BLOCK_DELTAS[g];
          if (block < 0 || block >= 90) continue;
          if (this.pieceOn[block] !== 0) continue;
          for (var k2 = 0; k2 < 2; k2++) {
            var to2 = from + KNIGHT_TARGETS[g][k2];
            if (to2 < 0 || to2 >= 90) continue;
            if (((oppB >> BigInt(to2)) & 1n) === 0n) continue;
            att |= ONE << BigInt(to2);
          }
        }
        break;
      }
      case BISHOP: {
        for (var d = 0; d < 4; d++) {
          var mid = from + BISHOP_BLOCKS[d];
          var to2 = from + BISHOP_TARGETS[d];
          if (to2 < 0 || to2 >= 90) continue;
          if (this.pieceOn[mid] !== 0) continue;
          if (((oppB >> BigInt(to2)) & 1n) === 0n) continue;
          att |= ONE << BigInt(to2);
        }
        break;
      }
      case ADVISOR: {
        for (var d = 0; d < 4; d++) {
          var to2 = from + ADVISOR_DELTA[d];
          if (to2 < 0 || to2 >= 90) continue;
          if (Math.abs(file_of(to2) - file_of(from)) !== 1) continue;
          if (((oppB >> BigInt(to2)) & 1n) === 0n) continue;
          att |= ONE << BigInt(to2);
        }
        att &= palace_of(me);
        break;
      }
      case KING: {
        for (var d = 0; d < 4; d++) {
          var to2 = from + KING_DELTA[d];
          if (to2 < 0 || to2 >= 90) continue;
          if (Math.abs(file_of(to2) - file_of(from)) > 1) continue;
          if (((oppB >> BigInt(to2)) & 1n) === 0n) continue;
          att |= ONE << BigInt(to2);
        }
        att &= palace_of(me);
        break;
      }
    }
    while (att !== 0n) {
      var to = bb_lsb(att);
      att &= att - 1n;
      mvs.push(MOVE(from, to));
    }
  }
  return mvs;
};

// Static Exchange Evaluation (simplified)
Position.prototype.see = function(mv, threshold) {
  if (threshold === undefined) threshold = 0;
  var from = SRC(mv), to = DST(mv);
  var pc   = this.pieceOn[from];
  var t    = type_of(pc);
  var gain = [0];
  // Approx MVV-LVA initial gain
  gain[0] = PIECE_TYPE_VALUE[type_of(this.pieceOn[to])] - threshold;
  if (gain[0] < 0) return 0;
  // Simplified: just return gain (no deeper exchange search)
  return gain[0] > 0 ? 1 : 0;
};

Position.prototype.is_legal = function(mv) {
  return this.do_move(mv);
};

Position.prototype.gives_check = function(mv) {
  // Quick approximation: do the move, check, undo.
  if (!this.do_move(mv)) return false;
  var chk = this.attackers_to(this.kingSq[1 - this.sideToMove], this.sideToMove) !== 0n;
  this.undo_move();
  return chk;
};

// Move-history based repetition (very simple).
Position.prototype.has_repeated = function() {
  var h = this.st[this.st.length - 1].hash;
  var c = 0;
  for (var i = this.history.length - 2; i >= 0; i--) {
    if (this.history[i] === h) { c++; if (c >= 2) return true; }
  }
  return false;
};

// Distance-from-root, used for mate-distance scoring.
Position.prototype.game_ply = function() {
  return this.st.length - 1;
};

// ---------- Zobrist hashing ----------
var ZOBRIST = {
  pieces: [],      // [color*7+type][sq]
  side: 0n
};
function init_zobrist() {
  function rnd() {
    // 32-bit random helper built on Math.random
    return BigInt(Math.floor(Math.random() * 0x100000000)) * 0x100000000n +
           BigInt(Math.floor(Math.random() * 0x100000000));
  }
  for (var i = 0; i < 14; i++) {
    var arr = [];
    for (var s = 0; s < 90; s++) arr.push(rnd());
    ZOBRIST.pieces.push(arr);
  }
  ZOBRIST.side = rnd();
}
init_zobrist();

function compute_hash(pos) {
  var h = 0n;
  for (var s = 0; s < 90; s++) {
    var pc = pos.pieceOn[s];
    if (pc) {
      var idx = color_of(pc) === RED ? type_of(pc) : 7 + type_of(pc);
      h ^= ZOBRIST.pieces[idx][s];
    }
  }
  if (pos.sideToMove === BLACK) h ^= ZOBRIST.side;
  return h;
}
