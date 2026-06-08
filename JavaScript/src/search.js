/*
 * search.js - 主搜索与静态搜索
 * 参考 Pikafish (Stockfish 衍生) 的 search.cpp 思想：
 *   - 迭代加深 (Iterative Deepening)
 *   - 内部迭代加深 (IID) 简化版：用 TT 中的最佳走法作为首步
 *   - Alpha-Beta + PVS (Principal Variation Search)
 *   - 置换表 (Transposition Table)
 *   - 杀手走法 + 历史启发
 *   - 静态搜索 (Quiescence Search)：只在吃子走法中搜索，消解水平效应
 *   - 空着裁剪 (Null Move Pruning)
 *   - 走法唯一性验证 (searchUnique)
 *   - PV (Principal Variation) 跟踪与回溯
 *   - 引擎信息回调：向 UI 报告 depth / score / pv / nps / knps / time
 * 移植自象棋小巫师 (XiangQi Wizard Light) 的 Search 类，按 Pikafish 风格重写。
 */

"use strict";

import {
  MATE_VALUE, WIN_VALUE, DRAW_VALUE, ADVANCED_VALUE,
  LIMIT_DEPTH, NULL_DEPTH, RANDOMNESS,
  HASH_ALPHA, HASH_BETA, HASH_PV,
} from "./types.js";

import { MovePicker } from "./movepick.js";

const INF = MATE_VALUE;
const MAX_PV = LIMIT_DEPTH;

export class Search {
  /**
   * @param {Object} pos       - Position 实例
   * @param {number} hashLevel - 置换表大小 2^hashLevel
   */
  constructor(pos, hashLevel = 16) {
    this.hashMask = (1 << hashLevel) - 1;
    this.pos = pos;

    // ---------- 置换表 ----------
    this.hashTable = new Array(this.hashMask + 1);
    for (let i = 0; i <= this.hashMask; i++) {
      this.hashTable[i] = { depth: 0, flag: 0, vl: 0, mv: 0, zobristLock: 0 };
    }

    // ---------- 杀手走法表 ----------
    this.killerTable = new Array(LIMIT_DEPTH);
    for (let i = 0; i < LIMIT_DEPTH; i++) this.killerTable[i] = [0, 0];

    // ---------- 历史启发表 ----------
    this.historyTable = new Array(14 * 256).fill(0);

    // ---------- PV 表 ----------
    // pvTable[ply][i] 存储第 ply 层第 i 步的走法
    this.pvTable = [];
    this.pvLength = new Array(LIMIT_DEPTH).fill(0);
    for (let i = 0; i < LIMIT_DEPTH; i++) {
      this.pvTable.push(new Array(LIMIT_DEPTH).fill(0));
    }

    // ---------- 统计 ----------
    this.allNodes = 0;
    this.allMillis = 0;
    this.mvResult = 0;

    // ---------- 引擎信息回调（被 UI 注入） ----------
    this.onInfo = null;

    // 当前迭代完成度 (用于分数稳定时中断)
    this.thisDepth = 0;
  }

  // ============== 置换表操作 ==============
  getHashItem() {
    return this.hashTable[this.pos.zobristKey & this.hashMask];
  }

  probeHash(vlAlpha, vlBeta, depth, mv) {
    const hash = this.getHashItem();
    if (hash.zobristLock !== this.pos.zobristLock) {
      mv[0] = 0;
      return -MATE_VALUE;
    }
    mv[0] = hash.mv;
    let mate = false;
    if (hash.vl > WIN_VALUE) {
      if (hash.vl <= MATE_VALUE - 100) return -MATE_VALUE; // 实际上 BAN_VALUE
      hash.vl -= this.pos.distance;
      mate = true;
    } else if (hash.vl < -WIN_VALUE) {
      if (hash.vl >= -MATE_VALUE + 100) return -MATE_VALUE;
      hash.vl += this.pos.distance;
      mate = true;
    } else if (hash.vl === this.pos.drawValue()) {
      return -MATE_VALUE;
    }
    if (hash.depth < depth && !mate) return -MATE_VALUE;
    if (hash.flag === HASH_BETA) return (hash.vl >= vlBeta ? hash.vl : -MATE_VALUE);
    if (hash.flag === HASH_ALPHA) return (hash.vl <= vlAlpha ? hash.vl : -MATE_VALUE);
    return hash.vl;
  }

  recordHash(flag, vl, depth, mv) {
    const hash = this.getHashItem();
    if (hash.depth > depth) return;
    hash.flag = flag;
    hash.depth = depth;
    if (vl > WIN_VALUE) {
      if (mv === 0 && vl <= MATE_VALUE - 100) return;
      hash.vl = vl + this.pos.distance;
    } else if (vl < -WIN_VALUE) {
      if (mv === 0 && vl >= -MATE_VALUE + 100) return;
      hash.vl = vl - this.pos.distance;
    } else if (vl === this.pos.drawValue() && mv === 0) {
      return;
    } else {
      hash.vl = vl;
    }
    hash.mv = mv;
    hash.zobristLock = this.pos.zobristLock;
  }

  setBestMove(mv, depth) {
    this.historyTable[this.pos.historyIndex(mv)] += depth * depth;
    const mvsKiller = this.killerTable[this.pos.distance];
    if (mvsKiller[0] !== mv) {
      mvsKiller[1] = mvsKiller[0];
      mvsKiller[0] = mv;
    }
  }

  // ============== PV 工具 ==============
  /** 从子节点拷贝 PV 到当前节点 */
  updatePv(ply, childPv) {
    this.pvTable[ply][ply] = childPv[0];
    for (let i = ply + 1; i < this.pvLength[ply + 1]; i++) {
      this.pvTable[ply][i] = this.pvTable[ply + 1][i];
    }
    this.pvLength[ply] = this.pvLength[ply + 1];
  }

  /** 截断 PV（beta 截断时） */
  truncatePv(ply) {
    this.pvLength[ply] = ply;
  }

  /** 取出当前根的 PV 数组 (跳过空走法) */
  getRootPv() {
    const pv = [];
    for (let i = 0; i < this.pvLength[0]; i++) {
      const mv = this.pvTable[0][i];
      if (mv) pv.push(mv);
      else break;
    }
    return pv;
  }

  // ============== 静态搜索 (Quiescence) ==============
  /**
   * @param {number} vlAlpha_
   * @param {number} vlBeta
   * @param {number} ply
   * @returns {number}
   */
  searchQuiesc(vlAlpha_, vlBeta, ply = 0) {
    let vlAlpha = vlAlpha_;
    this.allNodes++;
    let vl = this.pos.mateValue();
    if (vl >= vlBeta) return vl;

    const vlRep = this.pos.repStatus(1);
    if (vlRep > 0) return this.pos.repValue(vlRep);

    if (this.pos.distance === LIMIT_DEPTH) return this.pos.evaluate();

    let vlBest = -MATE_VALUE;
    const vls = [];
    let mvs = [];
    let picker;

    if (this.pos.inCheck()) {
      // 被将军：必须应将，搜索所有走法
      picker = new MovePicker({
        pos: this.pos,
        mvHash: 0,
        killerTable: this.killerTable,
        historyTable: this.historyTable,
        mode: "evasion",
      });
    } else {
      // 静止局面：先用静态评估做 stand-pat
      vl = this.pos.evaluate();
      if (vl > vlBest) {
        if (vl >= vlBeta) return vl;
        vlBest = vl;
        vlAlpha = Math.max(vl, vlAlpha);
      }
      // 再尝试吃子走法
      picker = new MovePicker({
        pos: this.pos,
        mvHash: 0,
        killerTable: this.killerTable,
        historyTable: this.historyTable,
        mode: "qsearch",
      });
    }

    let mv;
    while ((mv = picker.next()) > 0) {
      if (!this.pos.makeMove(mv)) continue;
      vl = -this.searchQuiesc(-vlBeta, -vlAlpha, ply + 1);
      this.pos.undoMakeMove();
      if (vl > vlBest) {
        if (vl >= vlBeta) {
          this.truncatePv(ply);
          return vl;
        }
        vlBest = vl;
        vlAlpha = Math.max(vl, vlAlpha);
      }
    }
    if (vlBest === -MATE_VALUE) {
      this.truncatePv(ply);
      return this.pos.mateValue();
    }
    this.truncatePv(ply);
    return vlBest;
  }

  // ============== 全局搜索 (Alpha-Beta) ==============
  searchFull(vlAlpha_, vlBeta, depth, noNull, ply = 0) {
    let vlAlpha = vlAlpha_;
    if (depth <= 0) {
      // 进入静态搜索，并维护 PV
      this.pvLength[ply] = ply;
      return this.searchQuiesc(vlAlpha, vlBeta, ply);
    }
    this.allNodes++;
    let vl = this.pos.mateValue();
    if (vl >= vlBeta) {
      this.truncatePv(ply);
      return vl;
    }
    const vlRep = this.pos.repStatus(1);
    if (vlRep > 0) {
      this.truncatePv(ply);
      return this.pos.repValue(vlRep);
    }
    const mvHash = [0];
    vl = this.probeHash(vlAlpha, vlBeta, depth, mvHash);
    if (vl > -MATE_VALUE) {
      this.truncatePv(ply);
      return vl;
    }
    if (this.pos.distance === LIMIT_DEPTH) {
      this.truncatePv(ply);
      return this.pos.evaluate();
    }
    // 空着裁剪 (Null Move Pruning)
    if (!noNull && !this.pos.inCheck() && this.pos.nullOkay()) {
      this.pos.nullMove();
      vl = -this.searchFull(-vlBeta, 1 - vlBeta, depth - NULL_DEPTH - 1, true, ply + 1);
      this.pos.undoNullMove();
      if (vl >= vlBeta &&
          (this.pos.nullSafe() ||
           this.searchFull(vlAlpha, vlBeta, depth - NULL_DEPTH, true, ply + 1) >= vlBeta)) {
        this.truncatePv(ply);
        return vl;
      }
    }

    let hashFlag = HASH_ALPHA;
    let vlBest = -MATE_VALUE;
    let mvBest = 0;

    // 走法排序 (Pikafish 风格的 MovePicker)
    const sort = new MovePicker({
      pos: this.pos,
      mvHash: mvHash[0],
      killerTable: this.killerTable,
      historyTable: this.historyTable,
      mode: "main",
    });

    // 开始填充本层 PV
    this.pvLength[ply] = ply;

    let mv;
    let moveCount = 0;
    while ((mv = sort.next()) > 0) {
      if (!this.pos.makeMove(mv)) continue;
      moveCount++;
      const singleReply = sort.getSingleReply();
      const newDepth = this.pos.inCheck() || singleReply ? depth : depth - 1;
      let val;
      if (vlBest === -MATE_VALUE) {
        val = -this.searchFull(-vlBeta, -vlAlpha, newDepth, false, ply + 1);
      } else {
        // PVS：先零窗口搜索
        val = -this.searchFull(-vlAlpha - 1, -vlAlpha, newDepth, false, ply + 1);
        if (val > vlAlpha && val < vlBeta) {
          val = -this.searchFull(-vlBeta, -vlAlpha, newDepth, false, ply + 1);
        }
      }
      this.pos.undoMakeMove();
      if (val > vlBest) {
        vlBest = val;
        if (val >= vlBeta) {
          hashFlag = HASH_BETA;
          mvBest = mv;
          // beta 截断 -> 截断 PV
          this.truncatePv(ply);
          break;
        }
        if (val > vlAlpha) {
          vlAlpha = val;
          hashFlag = HASH_PV;
          mvBest = mv;
          // 更新本层 PV
          this.pvTable[ply][ply] = mv;
          // 从子节点复制
          for (let i = ply + 1; i < this.pvLength[ply + 1]; i++) {
            this.pvTable[ply][i] = this.pvTable[ply + 1][i];
          }
          this.pvLength[ply] = this.pvLength[ply + 1];
        }
      }
    }
    if (vlBest === -MATE_VALUE) {
      this.truncatePv(ply);
      return this.pos.mateValue();
    }
    this.recordHash(hashFlag, vlBest, depth, mvBest);
    if (mvBest > 0) this.setBestMove(mvBest, depth);
    return vlBest;
  }

  // ============== 根搜索 ==============
  searchRoot(depth) {
    let vlBest = -MATE_VALUE;
    const sort = new MovePicker({
      pos: this.pos,
      mvHash: this.mvResult,
      killerTable: this.killerTable,
      historyTable: this.historyTable,
      mode: "main",
    });
    this.pvLength[0] = 0;
    let mv;
    while ((mv = sort.next()) > 0) {
      if (!this.pos.makeMove(mv)) continue;
      const newDepth = this.pos.inCheck() ? depth : depth - 1;
      let val;
      if (vlBest === -MATE_VALUE) {
        val = -this.searchFull(-MATE_VALUE, MATE_VALUE, newDepth, true, 1);
      } else {
        val = -this.searchFull(-vlBest - 1, -vlBest, newDepth, false, 1);
        if (val > vlBest) {
          val = -this.searchFull(-MATE_VALUE, -vlBest, newDepth, true, 1);
        }
      }
      this.pos.undoMakeMove();
      if (val > vlBest) {
        vlBest = val;
        this.mvResult = mv;
        // 把根的走法放到 PV 首位
        this.pvTable[0][0] = mv;
        // 从 ply=1 的子节点复制 PV (子节点将其首步存放在 pvTable[1][1])
        for (let i = 1; i < this.pvLength[1]; i++) {
          this.pvTable[0][i] = this.pvTable[1][i];
        }
        this.pvLength[0] = this.pvLength[1];
        if (vlBest > -WIN_VALUE && vlBest < WIN_VALUE) {
          vlBest += Math.floor(Math.random() * RANDOMNESS) -
            Math.floor(Math.random() * RANDOMNESS);
          vlBest = (vlBest === this.pos.drawValue() ? vlBest - 1 : vlBest);
        }
        // 报告根的 PV (每发现一个更优解都报告一次)
        if (this.onInfo) this.onInfo(this._buildInfo(depth, vlBest));
      }
    }
    if (mv > 0) this.setBestMove(this.mvResult, depth);
    return vlBest;
  }

  _buildInfo(depth, vl) {
    const pv = this.getRootPv();
    return {
      depth,
      selDepth: depth,
      score: this._formatScore(vl),
      scoreCp: vl,
      pv,
      nodes: this.allNodes,
      time: this.allMillis,
      nps: this.allMillis > 0 ? Math.floor(this.allNodes / (this.allMillis / 1000)) : 0,
      knps: this.allMillis > 0 ? (this.allNodes / this.allMillis) : 0,
    };
  }

  _formatScore(vl) {
    if (vl > WIN_VALUE) {
      // 杀棋：距离根的步数（正值表示走出杀棋的步数）
      const mateIn = (MATE_VALUE - vl + 1) >> 1;
      return { type: "mate", value: mateIn };
    }
    if (vl < -WIN_VALUE) {
      const mateIn = -((MATE_VALUE + vl) >> 1);
      return { type: "mate", value: mateIn };
    }
    if (Math.abs(vl) === DRAW_VALUE) {
      return { type: "draw", value: 0 };
    }
    return { type: "cp", value: vl };
  }

  // ============== 走法唯一性验证 ==============
  searchUnique(vlBeta, depth) {
    const sort = new MovePicker({
      pos: this.pos,
      mvHash: this.mvResult,
      killerTable: this.killerTable,
      historyTable: this.historyTable,
      mode: "main",
    });
    sort.next();
    let mv;
    while ((mv = sort.next()) > 0) {
      if (!this.pos.makeMove(mv)) continue;
      const val = -this.searchFull(
        -vlBeta, 1 - vlBeta,
        this.pos.inCheck() ? depth : depth - 1,
        false, 1
      );
      this.pos.undoMakeMove();
      if (val >= vlBeta) return false;
    }
    return true;
  }

  // ============== 迭代加深入口 ==============
  /**
   * @param {number} depth   - 最大深度
   * @param {number} millis  - 时限 (毫秒)
   * @param {Array}  bookDat - 开局库
   * @returns {number} best move
   */
  searchMain(depth, millis, bookDat) {
    // 1) 开局库
    if (bookDat && bookDat.length > 0) {
      const mvBook = this.pos.bookMove(bookDat);
      if (mvBook > 0) {
        this.pos.makeMove(mvBook);
        if (this.pos.repStatus(3) === 0) {
          this.pos.undoMakeMove();
          this.mvResult = mvBook;
          if (this.onInfo) {
            this.allMillis = 0;
            this.onInfo({
              depth: 0, selDepth: 0,
              score: { type: "book", value: 0 },
              scoreCp: 0,
              pv: [mvBook],
              nodes: 0, time: 0, nps: 0, knps: 0,
              book: true,
            });
          }
          return mvBook;
        }
        this.pos.undoMakeMove();
      }
    }

    this.allNodes = 0;
    this.mvResult = 0;
    this.pos.distance = 0;
    const t0 = Date.now();
    for (let i = 1; i <= depth; i++) {
      this.thisDepth = i;
      const vl = this.searchRoot(i);
      this.allMillis = Date.now() - t0;
      if (this.onInfo) this.onInfo(this._buildInfo(i, vl));
      // 放宽提前终止条件：至少搜 10 层，或者时间用完才停
      if (i >= 10 && this.allMillis > millis) break;
      if (i >= 20 && (vl > WIN_VALUE || vl < -WIN_VALUE)) break;
    }
    return this.mvResult;
  }

  // ============== 统计 ==============
  getKNPS() { return this.allNodes / (this.allMillis || 1); }
}
