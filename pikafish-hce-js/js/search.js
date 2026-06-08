/*
 * search.js - Strong Xiangqi Search
 *
 * JavaScript port of the Pikafish-HCE / Stockfish-style alpha-beta search
 * with:
 *   - Iterative deepening
 *   - Transposition table (Zobrist key + lock)
 *   - PVS / aspiration windows
 *   - Move ordering: TT move, MVV-LVA captures, killer moves, history
 *   - Null-move pruning with verification
 *   - Late-move reduction (LMR)
 *   - Futility pruning
 *   - Delta pruning in quiescence
 *   - Quiescence search (captures)
 *   - Time control with stop flag
 *   - Per-iteration info callback (depth, score, PV, nps, time)
 */

"use strict";

var LIMIT_DEPTH = 64;
var NULL_DEPTH  = 2;

var HASH_ALPHA = 1;
var HASH_BETA  = 2;
var HASH_PV    = 3;

var PHASE_HASH      = 0;
var PHASE_GEN_CAPS  = 1;
var PHASE_KILLER_1  = 2;
var PHASE_KILLER_2  = 3;
var PHASE_REST      = 4;

var KILLER_LEVELS = 2;
var HISTORY_MAX   = 8192;

function shellSort(mvs, vls) {
  var n = mvs.length;
  var gaps = [701, 301, 132, 57, 23, 10, 4, 1];
  for (var gi = 0; gi < gaps.length; gi++) {
    var g = gaps[gi];
    if (g >= n) continue;
    for (var i = g; i < n; i++) {
      var tmp = mvs[i], tmpV = vls[i];
      var j = i;
      while (j >= g && vls[j - g] < tmpV) {
        mvs[j] = mvs[j - g]; vls[j] = vls[j - g]; j -= g;
      }
      mvs[j] = tmp; vls[j] = tmpV;
    }
  }
}

function TT(hashLevel) {
  this.hashLevel = hashLevel;
  this.hashMask  = (1 << hashLevel) - 1;
  this.hashSize  = 1 << hashLevel;
  this.entries   = new Array(this.hashSize);
  for (var i = 0; i < this.hashSize; i++) {
    this.entries[i] = {
      zobristLock: 0,
      zobristKey:  0,
      flag:    0,
      depth:   0,
      vl:      0,
      mv:      0
    };
  }
  this.clear();
}
TT.prototype.clear = function() {
  for (var i = 0; i < this.hashSize; i++) {
    this.entries[i].zobristLock = 0;
    this.entries[i].zobristKey  = 0;
    this.entries[i].flag = 0;
    this.entries[i].depth = 0;
    this.entries[i].vl = 0;
    this.entries[i].mv = 0;
  }
};
TT.prototype.get = function(key) { return this.entries[key & this.hashMask]; };

function MoveSort(pos, mvHash, killerTable, historyTable) {
  this.pos = pos;
  this.mvHash = mvHash;
  this.mvKiller1 = killerTable[pos.distance][0] || 0;
  this.mvKiller2 = killerTable[pos.distance][1] || 0;
  this.historyTable = historyTable;
  this.mvs = [];
  this.vls = [];
  this.index = 0;
  this.phase = PHASE_HASH;
  this.inCheck = pos.inCheck();
}

MoveSort.prototype.next = function() {
  var pos = this.pos;
  switch (this.phase) {
    case PHASE_HASH:
      this.phase = PHASE_GEN_CAPS;
      if (this.mvHash > 0 && pos.legalMove(this.mvHash)) return this.mvHash;
    case PHASE_GEN_CAPS: {
      this.phase = PHASE_KILLER_1;
      var vls = [];
      var all = pos.generateMoves(null);
      for (var i = 0; i < all.length; i++) {
        var mv = all[i];
        var sqDst = DST(mv);
        var victim = pos.squares[sqDst] & 7;
        var attacker = pos.squares[SRC(mv)] & 7;
        var score;
        if (victim !== 0) {
          score = MVV_LVA(victim, attacker);
        } else {
          score = (this.historyTable[pos.historyIndex(mv)] || 0);
        }
        vls.push(score);
      }
      this.mvs = all;
      this.vls = vls;
      shellSort(this.mvs, this.vls);
      this.index = 0;
      while (this.index < this.mvs.length) {
        var mv = this.mvs[this.index];
        var v  = this.vls[this.index];
        this.index++;
        if (v > 0 && mv !== this.mvHash) return mv;
      }
      this.index = 0;
    }
    case PHASE_KILLER_1:
      this.phase = PHASE_KILLER_2;
      if (this.mvKiller1 > 0 && this.mvKiller1 !== this.mvHash && pos.legalMove(this.mvKiller1)) return this.mvKiller1;
    case PHASE_KILLER_2:
      this.phase = PHASE_REST;
      if (this.mvKiller2 > 0 && this.mvKiller2 !== this.mvHash && this.mvKiller2 !== this.mvKiller1 && pos.legalMove(this.mvKiller2)) return this.mvKiller2;
    case PHASE_REST:
    default:
      while (this.index < this.mvs.length) {
        var mv = this.mvs[this.index];
        this.index++;
        if (mv !== this.mvHash && mv !== this.mvKiller1 && mv !== this.mvKiller2) {
          return mv;
        }
      }
  }
  return 0;
};

function Search(pos, hashLevel) {
  this.pos = pos;
  this.tt  = new TT(hashLevel);
  this.killerTable = new Array(LIMIT_DEPTH);
  for (var i = 0; i < LIMIT_DEPTH; i++) this.killerTable[i] = [0, 0];
  this.historyTable = new Array(14 * 256);
  for (var j = 0; j < this.historyTable.length; j++) this.historyTable[j] = 0;
  this.nodes = 0;
  this.t0 = 0;
  this.hardLimit = 0;
  this.softLimit = 0;
  this.stopped  = false;
  this.infoCallback = null;
  this.bestMove = 0;
  this.pvLine = [];
  this.rootPV  = [];
  this.aspMargin = 25;
  this.maxDepth  = LIMIT_DEPTH;
  this.onComplete = null;
  this.onSearchEnd = null;
}

Search.prototype.elapsed = function() { return (Date.now ? Date.now() : new Date().getTime()) - this.t0; };
Search.prototype.outOfTime = function() { return this.stopped || this.elapsed() >= this.hardLimit; };

Search.prototype.boundCheck = function(soft) {
  if (this.outOfTime()) { this.stopped = true; return true; }
  if (soft && this.elapsed() >= this.softLimit) { this.stopped = true; return true; }
  return false;
};

Search.prototype.probeHash = function(vlAlpha, vlBeta, depth, mvOut) {
  var hash = this.tt.get(this.pos.zobristKey);
  if (hash.zobristLock !== this.pos.zobristLock) { mvOut[0] = 0; return -MATE_VALUE; }
  mvOut[0] = hash.mv;
  var vl = hash.vl, mate = false;
  if (vl > WIN_VALUE) {
    if (vl <= BAN_VALUE) return -MATE_VALUE;
    vl -= this.pos.distance; mate = true;
  } else if (vl < -WIN_VALUE) {
    if (vl >= -BAN_VALUE) return -MATE_VALUE;
    vl += this.pos.distance; mate = true;
  } else if (vl === this.pos.drawValue()) {
    return -MATE_VALUE;
  }
  if (hash.flag === HASH_BETA) {
    return (vl >= vlBeta ? vl : -MATE_VALUE);
  }
  if (hash.flag === HASH_ALPHA) {
    return (vl <= vlAlpha ? vl : -MATE_VALUE);
  }
  return vl;
};

Search.prototype.recordHash = function(flag, vl, depth, mv) {
  var hash = this.tt.get(this.pos.zobristKey);
  if (hash.depth > depth) return;
  hash.flag = flag;
  hash.depth = depth;
  if (vl > WIN_VALUE) {
    if (mv === 0 && vl <= BAN_VALUE) return;
    hash.vl = vl + this.pos.distance;
  } else if (vl < -WIN_VALUE) {
    if (mv === 0 && vl >= -BAN_VALUE) return;
    hash.vl = vl - this.pos.distance;
  } else if (vl === this.pos.drawValue() && mv === 0) {
    return;
  } else {
    hash.vl = vl;
  }
  hash.mv = mv;
  hash.zobristLock = this.pos.zobristLock;
  hash.zobristKey  = this.pos.zobristKey;
};

Search.prototype.setKiller = function(mv, depth) {
  var slot = this.killerTable[this.pos.distance];
  if (slot[0] !== mv) { slot[1] = slot[0]; slot[0] = mv; }
};

Search.prototype.setHistory = function(mv, depth) {
  var idx = this.pos.historyIndex(mv);
  this.historyTable[idx] += depth * depth;
  if (this.historyTable[idx] > HISTORY_MAX) {
    for (var i = 0; i < this.historyTable.length; i++) this.historyTable[i] = (this.historyTable[i] + 1) >> 1;
  }
};

Search.prototype.getHistory = function(mv) {
  return this.historyTable[this.pos.historyIndex(mv)] || 0;
};

Search.prototype.searchQuiesc = function(vlAlpha_, vlBeta) {
  this.nodes++;
  var vlAlpha = vlAlpha_;
  var vl = this.pos.mateValue();
  if (vl >= vlBeta) return vl;
  var vlRep = this.pos.repStatus(1);
  if (vlRep > 0) return this.pos.repValue(vlRep);
  if (this.pos.distance === LIMIT_DEPTH) return this.pos.evaluate();
  var vlBest = -MATE_VALUE;

  if (this.pos.inCheck()) {
    var mvsAll = this.pos.generateMoves(null);
    var hv = new Array(mvsAll.length);
    for (var i = 0; i < mvsAll.length; i++) hv[i] = this.getHistory(mvsAll[i]);
    shellSort(mvsAll, hv);
    for (var i2 = 0; i2 < mvsAll.length; i2++) {
      var mv = mvsAll[i2];
      if (!this.pos.makeMove(mv)) continue;
      vl = -this.searchQuiesc(-vlBeta, -vlAlpha);
      this.pos.undoMakeMove();
      if (vl > vlBest) {
        if (vl >= vlBeta) return vl;
        vlBest = vl; vlAlpha = Math.max(vl, vlAlpha);
      }
    }
    return vlBest === -MATE_VALUE ? this.pos.mateValue() : vlBest;
  }

  vl = this.pos.evaluate();
  if (vl > vlBest) {
    if (vl >= vlBeta) return vl;
    vlBest = vl; vlAlpha = Math.max(vl, vlAlpha);
  }
  var captureList = [];
  var allMvs = this.pos.generateMoves(null);
  for (var i3 = 0; i3 < allMvs.length; i3++) {
    var sqDst = DST(allMvs[i3]);
    if (this.pos.squares[sqDst] > 0) captureList.push(allMvs[i3]);
  }
  var mvc = [], svc = [];
  for (var i4 = 0; i4 < captureList.length; i4++) {
    var mv2 = captureList[i4];
    var victim = this.pos.squares[DST(mv2)] & 7;
    var attacker = this.pos.squares[SRC(mv2)] & 7;
    mvc.push(mv2);
    svc.push(MVV_LVA(victim, attacker));
  }
  shellSort(mvc, svc);
  for (var i5 = 0; i5 < mvc.length; i5++) {
    var mvCap = mvc[i5];
    var pcVictim = this.pos.squares[DST(mvCap)] & 7;
    var captVal = PIECE_MATERIAL[pcVictim];
    if (vlBest + captVal + 200 < vlAlpha && pcVictim !== PIECE_KING) continue;
    if (!this.pos.makeMove(mvCap)) continue;
    vl = -this.searchQuiesc(-vlBeta, -vlAlpha);
    this.pos.undoMakeMove();
    if (vl > vlBest) {
      if (vl >= vlBeta) return vl;
      vlBest = vl; vlAlpha = Math.max(vl, vlAlpha);
    }
  }
  return vlBest;
};

Search.prototype.searchFull = function(vlAlpha_, vlBeta, depth, noNull) {
  if (this.boundCheck(false)) { this.stopped = true; return 0; }
  var vlAlpha = vlAlpha_;
  this.nodes++;
  var vl = this.pos.mateValue();
  if (vl >= vlBeta) return vl;
  var vlRep = this.pos.repStatus(1);
  if (vlRep > 0) return this.pos.repValue(vlRep);
  if (this.pos.distance === LIMIT_DEPTH) return this.pos.evaluate();
  if (depth <= 0) return this.searchQuiesc(vlAlpha, vlBeta);

  var mvHash = [0];
  vl = this.probeHash(vlAlpha, vlBeta, depth, mvHash);
  if (vl > -MATE_VALUE) return vl;

  var inCheck = this.pos.inCheck();

  if (!noNull && !inCheck && this.pos.nullOkay() && depth >= 3) {
    this.pos.nullMove();
    var vlNull = -this.searchFull(-vlBeta, 1 - vlBeta, depth - 1 - NULL_DEPTH, true);
    this.pos.undoNullMove();
    if (vlNull >= vlBeta) {
      if (this.pos.nullSafe() ||
          this.searchFull(vlAlpha, vlBeta, depth - NULL_DEPTH, true) >= vlBeta) {
        return vlNull;
      }
    }
  }

  var mvTT = mvHash[0];
  if (mvTT === 0 && depth >= 4) {
    this.searchFull(vlAlpha, vlBeta, depth - 2, false);
    mvTT = this.tt.get(this.pos.zobristKey).mv;
  }

  var hashFlag = HASH_ALPHA;
  var vlBest = -MATE_VALUE;
  var mvBest = 0;
  var sort = new MoveSort(this.pos, mvTT, this.killerTable, this.historyTable);
  var moveCount = 0;
  var mv;
  while ((mv = sort.next()) > 0) {
    if (!this.pos.makeMove(mv)) continue;
    moveCount++;
    var newDepth = depth - 1;
    if (inCheck) newDepth = depth;

    var doFull = true;
    if (moveCount > 3 && depth >= 3 && !inCheck &&
        this.pos.squares[DST(mv)] === 0 &&
        sort.phase === PHASE_REST) {
      var r = 1;
      if      (moveCount > 6)  r = 2;
      else if (moveCount > 12) r = 3;
      if (this.getHistory(mv) < 50) r++;
      newDepth = Math.max(1, newDepth - r);
      vl = -this.searchFull(-vlAlpha - 1, -vlAlpha, newDepth, false);
      doFull = (vl > vlAlpha);
    }

    if (doFull) {
      if (vlBest === -MATE_VALUE) {
        vl = -this.searchFull(-vlBeta, -vlAlpha, newDepth, false);
      } else {
        vl = -this.searchFull(-vlAlpha - 1, -vlAlpha, newDepth, false);
        if (vl > vlAlpha && vl < vlBeta) {
          vl = -this.searchFull(-vlBeta, -vlAlpha, newDepth, false);
        }
      }
    }
    this.pos.undoMakeMove();
    if (this.stopped) return vlBest === -MATE_VALUE ? 0 : vlBest;
    if (vl > vlBest) {
      vlBest = vl;
      if (vl >= vlBeta) {
        hashFlag = HASH_BETA;
        mvBest = mv;
        break;
      }
      if (vl > vlAlpha) {
        vlAlpha = vl;
        hashFlag = HASH_PV;
        mvBest = mv;
      }
    }
  }
  if (vlBest === -MATE_VALUE) return this.pos.mateValue();
  this.recordHash(hashFlag, vlBest, depth, mvBest);
  if (mvBest > 0 && this.pos.squares[DST(mvBest)] === 0) {
    this.setKiller(mvBest, depth);
    this.setHistory(mvBest, depth);
  }
  return vlBest;
};

Search.prototype.searchRoot = function(depth, aspAlpha, aspBeta) {
  if (this.boundCheck(false)) { this.stopped = true; return 0; }
  this.nodes++;
  var vl = this.pos.mateValue();
  if (vl >= aspBeta) return vl;
  var vlRep = this.pos.repStatus(1);
  if (vlRep > 0) return this.pos.repValue(vlRep);
  if (this.pos.distance === LIMIT_DEPTH) return this.pos.evaluate();
  if (depth <= 0) return this.searchQuiesc(aspAlpha, aspBeta);

  var mvTT = this.tt.get(this.pos.zobristKey).mv;
  var hashFlag = HASH_ALPHA;
  var vlBest = -MATE_VALUE;
  var mvBest = 0;
  var sort = new MoveSort(this.pos, mvTT, this.killerTable, this.historyTable);
  var moveCount = 0;
  var mv;
  while ((mv = sort.next()) > 0) {
    if (!this.pos.makeMove(mv)) continue;
    moveCount++;
    var newDepth = depth - 1;
    if (this.pos.inCheck()) newDepth = depth;
    var doFull = true;
    if (moveCount > 3 && depth >= 3 && !this.pos.inCheck() &&
        this.pos.squares[DST(mv)] === 0 && sort.phase === PHASE_REST) {
      var r = 1;
      if      (moveCount > 6)  r = 2;
      else if (moveCount > 12) r = 3;
      if (this.getHistory(mv) < 50) r++;
      newDepth = Math.max(1, newDepth - r);
      vl = -this.searchFull(-aspAlpha - 1, -aspAlpha, newDepth, false);
      doFull = (vl > aspAlpha);
    }
    if (doFull) {
      if (vlBest === -MATE_VALUE) {
        vl = -this.searchFull(-aspBeta, -aspAlpha, newDepth, false);
      } else {
        vl = -this.searchFull(-aspAlpha - 1, -aspAlpha, newDepth, false);
        if (vl > aspAlpha && vl < aspBeta) {
          vl = -this.searchFull(-aspBeta, -aspAlpha, newDepth, false);
        }
      }
    }
    this.pos.undoMakeMove();
    if (this.stopped) break;
    if (vl > vlBest) {
      vlBest = vl;
      if (vl >= aspBeta) {
        hashFlag = HASH_BETA;
        mvBest = mv;
        break;
      }
      if (vl > aspAlpha) {
        aspAlpha = vl;
        hashFlag = HASH_PV;
        mvBest = mv;
      }
    }
  }
  if (vlBest === -MATE_VALUE) return this.pos.mateValue();
  this.recordHash(hashFlag, vlBest, depth, mvBest);
  if (mvBest > 0 && this.pos.squares[DST(mvBest)] === 0) {
    this.setKiller(mvBest, depth);
    this.setHistory(mvBest, depth);
  }
  if (mvBest > 0) this.bestMove = mvBest;
  return vlBest;
};

Search.prototype.buildPV = function(maxPly) {
  var pv = [];
  var seen = {};
  var pos = this.pos;
  for (var ply = 0; ply < maxPly; ply++) {
    if (this.boundCheck(false)) break;
    var h = this.tt.get(pos.zobristKey);
    if (h.zobristLock !== pos.zobristLock) break;
    if (h.mv === 0) break;
    var mv = h.mv;
    if (seen[pos.zobristKey]) break;
    seen[pos.zobristKey] = true;
    if (!pos.makeMove(mv)) break;
    pv.push(mv);
  }
  for (var i = 0; i < pv.length; i++) pos.undoMakeMove();
  return pv;
};

Search.prototype.searchMain = function(maxDepth, maxTimeMs) {
  this.t0 = Date.now ? Date.now() : new Date().getTime();
  this.hardLimit = maxTimeMs > 0 ? maxTimeMs : 5000;
  this.softLimit = Math.max(50, Math.floor(this.hardLimit * 0.55));
  this.maxDepth = maxDepth > 0 ? maxDepth : LIMIT_DEPTH;
  this.nodes = 0;
  this.stopped = false;
  this.bestMove = 0;

  var bestVL = 0;
  var prevPV = [];
  var alpha = -MATE_VALUE, beta = MATE_VALUE;
  for (var depth = 1; depth <= this.maxDepth; depth++) {
    if (this.boundCheck(true)) break;
    var vl;
    if (depth >= 4) {
      alpha = Math.max(bestVL - this.aspMargin, -MATE_VALUE);
      beta  = Math.min(bestVL + this.aspMargin,  MATE_VALUE);
      vl = this.searchRoot(depth, alpha, beta);
      if (this.stopped) break;
      if (vl <= alpha || vl >= beta) {
        alpha = -MATE_VALUE; beta = MATE_VALUE;
        vl = this.searchRoot(depth, alpha, beta);
        if (this.stopped) break;
      }
    } else {
      vl = this.searchRoot(depth, alpha, beta);
      if (this.stopped) break;
    }
    bestVL = vl;
    if (this.bestMove > 0) {
      var pv = this.buildPV(depth);
      prevPV = pv;
      if (this.infoCallback) {
        var elapsed = this.elapsed();
        var nps = elapsed > 0 ? Math.floor(this.nodes * 1000 / elapsed) : 0;
        var score = (vl > WIN_VALUE)  ? ("mate "  + (MATE_VALUE - vl))
                  : (vl < -WIN_VALUE) ? ("mate -" + (MATE_VALUE + vl))
                  : ("cp " + vl);
        this.infoCallback({
          depth:  depth,
          selDepth: depth,
          score:   vl,
          scoreStr: score,
          pv:      pv.slice(),
          nodes:   this.nodes,
          nps:     nps,
          time:    elapsed,
          hashfull: 0
        });
      }
    }
    if (bestVL > WIN_VALUE || bestVL < -WIN_VALUE) break;
  }
  if (this.onComplete) this.onComplete(this.bestMove, prevPV, bestVL);
  return { mv: this.bestMove, pv: prevPV, vl: bestVL };
};
