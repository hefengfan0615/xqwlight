/*
 * search.js - Alpha-beta search with iterative deepening, PVS, LMR, null-move pruning.
 * Ported from Pikafish (https://github.com/official-pikafish/Pikafish)
 *
 * Exposes:
 *   var s = new Search(pos, hashLevel);
 *   var best = s.searchMain(maxDepth, millis);
 *   s.info()   -> { depth, score, pv, knps, nodes, time }
 */
"use strict";

var MAX_PLY      = 64;
var MATE_VALUE   = SCORE_MATE;
var MATE_IN_MAX  = SCORE_MATE_IN_MAX_PLY;
var INFINITE     = SCORE_INF;

function TTEntry() {
  this.key  = 0n;
  this.move = 0;
  this.score= 0;
  this.depth= 0;
  this.bound= 0;        // 0 none, 1 alpha, 2 beta, 3 exact
  this.age  = 0;
}

var TT_NONE = 0, TT_LOWER = 1, TT_UPPER = 2, TT_EXACT = 3;

function Search(pos, hashLevel) {
  this.pos = pos;
  this.hashMask = (1 << Math.max(8, hashLevel)) - 1;
  this.tt = new Array(this.hashMask + 1);
  for (var i = 0; i <= this.hashMask; i++) this.tt[i] = new TTEntry();
  this.killers = new Array(MAX_PLY);
  for (var j = 0; j < MAX_PLY; j++) this.killers[j] = [0, 0];
  this.history = new Array(7 * 256);
  for (var k = 0; k < 7 * 256; k++) this.history[k] = 0;
  this.nodes = 0;
  this.startTime = 0;
  this.timeLimit = 0;
  this.stopped = false;
  this.maxDepth = 64;
  this.bestMove = 0;
  this.bestScore = 0;
  this.bestPV = [];
  this.curDepth = 0;
  this.curPV = new Array(MAX_PLY);
  for (var m = 0; m < MAX_PLY; m++) this.curPV[m] = new Array(MAX_PLY);
  // Plumb info callback to UI
  this.onInfo = null;
  this._ageCounter = 0;
}

Search.prototype.tt_index = function() {
  return Number(this.pos.st[this.pos.st.length - 1].hash & BigInt(this.hashMask));
};

Search.prototype.tt_probe = function(depth, alpha, beta) {
  var e = this.tt[this.tt_index()];
  if (e.key !== this.pos.st[this.pos.st.length - 1].hash) return [TT_NONE, 0, 0];
  if (e.depth < depth) return [e.bound, 0, e.move];
  if (e.bound === TT_EXACT) return [TT_EXACT, e.score, e.move];
  if (e.bound === TT_LOWER && e.score >= beta)  return [TT_LOWER, e.score, e.move];
  if (e.bound === TT_UPPER && e.score <= alpha) return [TT_UPPER, e.score, e.move];
  return [TT_NONE, 0, e.move];
};

Search.prototype.tt_store = function(depth, score, bound, mv) {
  var e = this.tt[this.tt_index()];
  // Always-replace scheme with depth preference
  if (e.key === 0n || e.depth <= depth) {
    e.key = this.pos.st[this.pos.st.length - 1].hash;
    e.move = mv || e.move;
    e.score = score;
    e.depth = depth;
    e.bound = bound;
    e.age  = this._ageCounter;
  }
};

Search.prototype.tt_move = function() {
  var e = this.tt[this.tt_index()];
  if (e.key === this.pos.st[this.pos.st.length - 1].hash) return e.move;
  return 0;
};

Search.prototype.check_time = function() {
  if (this.nodes & 1023) return;
  if ((Date.now() - this.startTime) >= this.timeLimit) this.stopped = true;
};

// Quiescence search: only tactical moves, alpha-beta
Search.prototype.qsearch = function(alpha, beta, ply) {
  this.nodes++;
  if (ply >= MAX_PLY) return evaluate(this.pos);

  this.check_time();
  if (this.stopped) return alpha;

  var stand = evaluate(this.pos);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  var ttMv = this.tt_move();
  var picker = new MovePicker(this.pos, ttMv, [0, 0], this.history);
  var mv;
  while ((mv = picker.next()) !== 0) {
    if (!this.pos.do_move(mv)) continue;
    var score = -this.qsearch(-beta, -alpha, ply + 1);
    this.pos.undo_move();
    if (this.stopped) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
};

// Late-move-reduction table
function lmr_table_init() {
  // Reduction table indexed by [depth][moveNumber]
  var t = new Array(64);
  for (var d = 0; d < 64; d++) {
    t[d] = new Array(64);
    for (var m = 0; m < 64; m++) {
      t[d][m] = (d < 2 || m < 3) ? 0 :
        (Math.log(d) * Math.log(m) / 2.5) | 0;
    }
  }
  return t;
}
var LMR_TABLE = lmr_table_init();

// Main alpha-beta search
Search.prototype.search = function(alpha, beta, depth, ply, doNull) {
  this.nodes++;
  this.check_time();
  if (this.stopped) return alpha;
  if (ply >= MAX_PLY) return evaluate(this.pos);

  var inCheck = this.pos.in_check();
  if (inCheck) depth++;            // check extension
  if (depth <= 0) return this.qsearch(alpha, beta, ply);

  // Mate-distance pruning
  alpha = Math.max(alpha, -MATE_VALUE + ply);
  beta  = Math.min(beta,  MATE_VALUE - ply);
  if (alpha >= beta) return alpha;

  // Repetition draw
  if (ply > 0 && this.pos.has_repeated()) return 0;

  // TT probe
  var probe = this.tt_probe(depth, alpha, beta);
  if (probe[0] !== TT_NONE && ply > 0) return probe[1];

  // Null-move pruning
  if (doNull && !inCheck && depth >= 3 && ply > 0) {
    var mat = this.material();
    if (mat > 200) {
      this.pos.do_null_move();
      var nullScore = -this.search(-beta, -beta + 1, depth - 3, ply + 1, false);
      this.pos.undo_null_move();
      if (this.stopped) return alpha;
      if (nullScore >= beta) return beta;
    }
  }

  var ttMv = this.tt_move();
  var killers = this.killers[ply];
  var picker = new MovePicker(this.pos, ttMv, killers, this.history);

  var bestScore = -INFINITE;
  var bestMove  = 0;
  var bound     = TT_UPPER;
  var moveCount = 0;
  var mv;
  while ((mv = picker.next()) !== 0) {
    if (!this.pos.do_move(mv)) continue;
    var score;
    var newDepth = depth - 1;
    var givesCheck = this.pos.in_check();

    if (moveCount === 0) {
      score = -this.search(-beta, -alpha, newDepth, ply + 1, true);
    } else {
      // Late-move reduction
      var r = 0;
      if (depth >= 3 && moveCount >= 3 && !inCheck && !givesCheck) {
        r = LMR_TABLE[Math.min(depth, 63)][Math.min(moveCount, 63)];
        r = Math.max(0, r - (this.history_hit(mv) > 5000 ? 1 : 0));
      }
      score = -this.search(-alpha - 1, -alpha, newDepth - r, ply + 1, true);
      if (r > 0 || (score > alpha && score < beta)) {
        score = -this.search(-beta, -alpha, newDepth, ply + 1, true);
      }
    }
    this.pos.undo_move();
    if (this.stopped) return alpha;

    if (score > bestScore) {
      bestScore = score;
      bestMove  = mv;
      this.curPV[ply][ply] = mv;
      for (var p = ply + 1; p < this.curPV[ply + 1].length; p++) {
        this.curPV[ply][p] = this.curPV[ply + 1][p];
      }
      if (score > alpha) {
        alpha = score;
        bound = TT_EXACT;
        if (score >= beta) {
          bound = TT_LOWER;
          // Killer / history update
          if (this.pos.pieceOn[DST(mv)] === 0) {
            this.killers[ply][0] = mv;
            var idx = ((type_of(this.pos.pieceOn[SRC(mv)])) << 8) | DST(mv);
            if (this.history[idx] < 32000) this.history[idx] += depth * depth;
          }
          break;
        }
      }
    }
    moveCount++;
  }

  if (moveCount === 0) {
    if (inCheck) return -MATE_VALUE + ply;
    return 0;
  }
  this.tt_store(depth, bestScore, bound, bestMove);
  return bestScore;
};

Search.prototype.material = function() {
  var s = 0;
  for (var i = 0; i < 90; i++) {
    var pc = this.pos.pieceOn[i];
    if (pc) s += PIECE_TYPE_VALUE[type_of(pc)];
  }
  return s;
};

Search.prototype.history_hit = function(mv) {
  var pc = this.pos.pieceOn[SRC(mv)];
  if (!pc) return 0;
  var idx = (type_of(pc) << 8) | DST(mv);
  return this.history[idx] || 0;
};

// Root search: iterative deepening, with time management
Search.prototype.searchMain = function(maxDepth, millis) {
  this.nodes = 0;
  this.stopped = false;
  this.startTime = Date.now();
  this.timeLimit = millis;
  this.maxDepth = maxDepth;
  this._ageCounter++;
  this.bestMove = 0;
  this.bestScore = 0;
  this.bestPV = [];

  for (var d = 1; d <= maxDepth; d++) {
    this.curDepth = d;
    var score = this.searchRoot(d);
    if (this.stopped && d > 1) break;
    // Update best
    this.bestScore = score;
    this.bestPV = this.curPV[0].slice(0, d + 4);
    this.bestMove = this.bestPV[0] || 0;
    // Output info to UI
    if (this.onInfo) {
      this.onInfo({
        depth: d,
        score: score,
        pv: this.bestPV,
        nodes: this.nodes,
        time: Date.now() - this.startTime,
        knps: (this.nodes / Math.max(1, Date.now() - this.startTime))
      });
    }
    if (score > MATE_IN_MAX || score < -MATE_IN_MAX) break;
  }
  return this.bestMove || 0;
};

Search.prototype.searchRoot = function(depth) {
  this.nodes++;
  this.check_time();
  if (this.stopped) return this.bestScore;

  var alpha = -INFINITE, beta = INFINITE;
  var delta = 50;     // aspiration window

  var ttMv = this.tt_move();
  var killers = this.killers[0];
  var picker = new MovePicker(this.pos, ttMv, killers, this.history);
  var bestScore = -INFINITE;
  var bestMove  = 0;
  var bound     = TT_UPPER;
  var moveCount = 0;
  var mv;
  while ((mv = picker.next()) !== 0) {
    if (!this.pos.do_move(mv)) continue;
    var newDepth = depth - 1;
    var score;
    if (moveCount === 0) {
      score = -this.search(-beta, -alpha, newDepth, 1, true);
    } else {
      score = -this.search(-alpha - 1, -alpha, newDepth, 1, true);
      if (score > alpha && score < beta) {
        score = -this.search(-beta, -alpha, newDepth, 1, true);
      }
    }
    this.pos.undo_move();
    if (this.stopped) return bestScore;

    if (score > bestScore) {
      bestScore = score;
      bestMove  = mv;
      this.curPV[0][0] = mv;
      for (var p = 1; p < this.curPV[1].length; p++) this.curPV[0][p] = this.curPV[1][p];
      if (score > alpha) {
        alpha = score;
        bound = TT_EXACT;
        if (score >= beta) {
          bound = TT_LOWER;
          if (this.pos.pieceOn[DST(mv)] === 0) {
            this.killers[0][0] = mv;
            var idx = ((type_of(this.pos.pieceOn[SRC(mv)])) << 8) | DST(mv);
            if (this.history[idx] < 32000) this.history[idx] += depth * depth;
          }
        }
      }
    }
    moveCount++;
  }
  if (moveCount === 0) {
    // No legal moves: either checkmate or stalemate
    if (this.pos.in_check()) return -MATE_VALUE;
    return 0;
  }
  this.tt_store(depth, bestScore, bound, bestMove);
  return bestScore;
};

// Format a PV line as a readable string of moves
function pvToString(pv) {
  var s = "";
  for (var i = 0; i < pv.length; i++) {
    if (!pv[i]) break;
    if (i > 0) s += " ";
    s += moveToIccs(pv[i]);
  }
  return s;
}
