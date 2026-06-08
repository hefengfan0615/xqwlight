/*
 * movepick.js - Staged move ordering.
 * Ported from Pikafish (https://github.com/official-pikafish/Pikafish)
 *
 * The MovePicker yields one legal move at a time in an order designed to
 * maximise alpha-beta cut-offs.  Stages (Pikafish-style):
 *
 *   1. TT move            (the move from the transposition table)
 *   2. Capture stage      (winning captures, ordered by SEE/MVV-LVA)
 *   3. Quiet killer 1
 *   4. Quiet killer 2
 *   5. Quiet stage        (all remaining quiet moves, ordered by history)
 *   6. Losing captures    (bad captures last, ordered by SEE ascending)
 */
"use strict";

var STAGE_TT       = 0;
var STAGE_GEN_CAPS = 1;
var STAGE_GOOD_CAPS= 2;
var STAGE_KILLER_1 = 3;
var STAGE_KILLER_2 = 4;
var STAGE_GEN_QUIET= 5;
var STAGE_QUIET    = 6;
var STAGE_BAD_CAPS = 7;
var STAGE_DONE     = 8;

// MVV-LVA attacker order (lower is better attacker)
var LVA_VALUE = [0, 0, 0, 2, 4, 4, 1, 0,
                 0, 0, 0, 2, 4, 4, 1, 0,
                 0, 0, 0, 2, 4, 4, 1, 0];

function MovePicker(pos, ttMove, killers, history) {
  this.pos = pos;
  this.ttMove = ttMove;
  this.killers = killers;
  this.history = history;
  this.stage = STAGE_TT;
  this.moves = [];
  this.scores = [];
  this.idx = 0;
  this.badCaps = [];
  this.badCapScores = [];
  this.badIdx = 0;
}

MovePicker.prototype.score_capture = function(mv) {
  var pos = this.pos;
  var from = SRC(mv), to = DST(mv);
  var victim = type_of(pos.pieceOn[to]);
  var attacker = type_of(pos.pieceOn[from]);
  // MVV-LVA: prefer big victim, small attacker
  return PIECE_TYPE_VALUE[victim] * 16 - LVA_VALUE[attacker] - 1;
};

MovePicker.prototype.next = function() {
  var pos = this.pos;
  while (true) {
    switch (this.stage) {
      case STAGE_TT:
        this.stage = STAGE_GEN_CAPS;
        if (this.ttMove && this.ttMove !== 0 && this.is_legal(this.ttMove)) {
          return this.ttMove;
        }
        break;

      case STAGE_GEN_CAPS:
        this.stage = STAGE_GOOD_CAPS;
        this.moves.length = 0;
        this.scores.length = 0;
        // Generate captures from current position (pseudo); we'll filter by SEE
        var allCaps = [];
        pos.generate_captures(allCaps);
        for (var i = 0; i < allCaps.length; i++) {
          var mv = allCaps[i];
          // SEE >= 0 -> good capture
          var seeScore = this.see_ge0(mv) ? 1 : 0;
          var entry = { mv: mv, score: this.score_capture(mv) };
          if (seeScore) {
            this.moves.push(entry);
          } else {
            this.badCaps.push(entry);
          }
        }
        this.moves.sort(function(a, b) { return b.score - a.score; });
        this.badCaps.sort(function(a, b) { return a.score - b.score; });
        this.idx = 0;
        break;

      case STAGE_GOOD_CAPS:
        if (this.idx < this.moves.length) {
          var e = this.moves[this.idx++];
          if (e.mv !== this.ttMove && this.is_legal(e.mv)) return e.mv;
          break;
        }
        this.stage = STAGE_KILLER_1;
        break;

      case STAGE_KILLER_1: {
        this.stage = STAGE_KILLER_2;
        var k1 = this.killers[0];
        if (k1 && k1 !== this.ttMove && this.is_legal(k1) && !this.is_capture(k1)) {
          return k1;
        }
        break;
      }
      case STAGE_KILLER_2: {
        this.stage = STAGE_GEN_QUIET;
        var k2 = this.killers[1];
        if (k2 && k2 !== this.ttMove && this.is_legal(k2) && !this.is_capture(k2)) {
          return k2;
        }
        break;
      }

      case STAGE_GEN_QUIET:
        this.stage = STAGE_QUIET;
        this.moves.length = 0;
        this.scores.length = 0;
        var all = [];
        pos.generate_pseudo(all);
        for (var j = 0; j < all.length; j++) {
          var mv2 = all[j];
          if (this.is_capture(mv2)) continue;
          if (mv2 === this.ttMove) continue;
          if (mv2 === this.killers[0] || mv2 === this.killers[1]) continue;
          this.moves.push(mv2);
        }
        // sort by history
        var self = this;
        this.moves.sort(function(a, b) {
          return self.history_score(b) - self.history_score(a);
        });
        this.idx = 0;
        break;

      case STAGE_QUIET:
        if (this.idx < this.moves.length) {
          var mv3 = this.moves[this.idx++];
          if (this.is_legal(mv3)) return mv3;
          break;
        }
        this.stage = STAGE_BAD_CAPS;
        this.idx = 0;
        break;

      case STAGE_BAD_CAPS:
        if (this.idx < this.badCaps.length) {
          var e2 = this.badCaps[this.idx++];
          if (e2.mv !== this.ttMove && this.is_legal(e2.mv)) return e2.mv;
          break;
        }
        this.stage = STAGE_DONE;
        return 0;

      default: return 0;
    }
  }
};

MovePicker.prototype.history_score = function(mv) {
  var pos = this.pos;
  var from = SRC(mv), to = DST(mv);
  var pc   = pos.pieceOn[from];
  var idx  = ((type_of(pc)) << 8) | to;
  return this.history[idx] || 0;
};

MovePicker.prototype.is_capture = function(mv) {
  return this.pos.pieceOn[DST(mv)] !== 0;
};

MovePicker.prototype.is_legal = function(mv) {
  // We do a fast pseudo-check by looking up attack pattern and verifying
  // the piece can move there, then verify king safety via do/undo.
  return this.pos.is_legal(mv);
};

// Simplified SEE: returns true if the capture has non-negative SEE.
MovePicker.prototype.see_ge0 = function(mv) {
  return this.pos.see(mv, 0) >= 0;
};
