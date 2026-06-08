/*
 * movepick.js - 走法排序器 (MovePicker)
 * 参考 Pikafish (Stockfish 衍生) 的 movepick.cpp 思想：
 *   - 分阶段生成走法：TT 走法 → 杀手 1 → 杀手 2 → 普通走法（按历史启发排序）
 *   - 静态搜索 (qsearch) 阶段只生成吃子走法
 *   - 被将军时 (evasion) 阶段生成所有合法走法
 * 移植自象棋小巫师 (XiangQi Wizard Light) 的 MoveSort，结构更接近 Pikafish 引擎。
 */

"use strict";

import {
  STAGE_TT, STAGE_KILLER1, STAGE_KILLER2, STAGE_GEN, STAGE_REST, STAGE_EVASION,
  shellSort, HOME_HALF, DST,
} from "./types.js";

export class MovePicker {
  /**
   * @param {Object} opts
   * @param {Object} opts.pos        - Position 实例
   * @param {number} opts.mvHash     - 置换表走法 (TT move)
   * @param {Array}  opts.killerTable- 杀手走法表
   * @param {Array}  opts.historyTable - 历史启发表
   * @param {string} opts.mode       - "main" | "qsearch" | "evasion"
   */
  constructor({ pos, mvHash, killerTable, historyTable, mode = "main" }) {
    this.pos = pos;
    this.historyTable = historyTable;
    this.mode = mode;
    this.mvs = [];
    this.vls = [];
    this.mvHash = 0;
    this.mvKiller1 = 0;
    this.mvKiller2 = 0;
    this.index = 0;
    this.singleReply = false;

    // 是否被将军 -> 全部走法模式 (对应 Pikafish EVASION 阶段)
    if (pos.inCheck()) {
      this.mode = "evasion";
    }

    if (this.mode === "main") {
      this.mvHash = mvHash || 0;
      this.mvKiller1 = killerTable[pos.distance] ? killerTable[pos.distance][0] : 0;
      this.mvKiller2 = killerTable[pos.distance] ? killerTable[pos.distance][1] : 0;
      this.stage = STAGE_TT;
    } else if (this.mode === "qsearch") {
      this.stage = STAGE_TT;
      this.mvHash = mvHash || 0;
    } else {
      // evasion: 立刻生成全部走法，按 history 排序
      this.stage = STAGE_REST;
      const mvsAll = pos.generateMoves(null);
      for (let i = 0; i < mvsAll.length; i++) {
        const mv = mvsAll[i];
        if (!pos.makeMove(mv)) continue;
        pos.undoMakeMove();
        this.mvs.push(mv);
        this.vls.push(mv === (mvHash || 0) ? 0x7fffffff : historyTable[pos.historyIndex(mv)]);
      }
      shellSort(this.mvs, this.vls);
      this.singleReply = this.mvs.length === 1;
    }
  }

  /**
   * 取下一走法 (对应 Pikafish MovePicker::next_move)
   * @returns {number} 走法编码，0 表示走法已耗尽
   */
  next() {
    switch (this.stage) {
      case STAGE_TT:
        this.stage = STAGE_KILLER1;
        if (this.mvHash > 0 && this.pos.legalMove(this.mvHash)) {
          return this.mvHash;
        }
        // 不可走时 fallthrough
        /* falls through */
      case STAGE_KILLER1:
        this.stage = STAGE_KILLER2;
        if (this.mode === "main" &&
            this.mvKiller1 !== this.mvHash && this.mvKiller1 > 0 &&
            this.pos.legalMove(this.mvKiller1)) {
          return this.mvKiller1;
        }
        /* falls through */
      case STAGE_KILLER2:
        this.stage = STAGE_GEN;
        if (this.mode === "main" &&
            this.mvKiller2 !== this.mvHash && this.mvKiller2 > 0 &&
            this.pos.legalMove(this.mvKiller2)) {
          return this.mvKiller2;
        }
        /* falls through */
      case STAGE_GEN: {
        this.stage = STAGE_REST;
        // qsearch 阶段只生成吃子走法，按 MVV-LVA 排序
        if (this.mode === "qsearch") {
          this.mvs = this.pos.generateMoves(this.vls);
          // 把已经返回过的 TT move 排到最前
          shellSort(this.mvs, this.vls);
          this.index = 0;
          // 截掉得分过低的吃子（不进入深层搜索）
          for (let i = 0; i < this.mvs.length; i++) {
            if (this.vls[i] < 10 ||
                (this.vls[i] < 20 && HOME_HALF(DST(this.mvs[i]), this.pos.sdPlayer))) {
              this.mvs.length = i;
              break;
            }
          }
        } else {
          this.mvs = this.pos.generateMoves(null);
          this.vls = [];
          for (let i = 0; i < this.mvs.length; i++) {
            this.vls.push(this.historyTable[this.pos.historyIndex(this.mvs[i])]);
          }
          shellSort(this.mvs, this.vls);
          this.index = 0;
        }
        return this._nextFromRest();
      }
      case STAGE_REST:
      case STAGE_EVASION:
      default:
        return this._nextFromRest();
    }
  }

  _nextFromRest() {
    while (this.index < this.mvs.length) {
      const mv = this.mvs[this.index++];
      if (mv !== this.mvHash && mv !== this.mvKiller1 && mv !== this.mvKiller2) {
        return mv;
      }
    }
    return 0;
  }

  /** 是否为唯一应将 (single reply)，PVS 决定是否完整窗口搜索 */
  getSingleReply() { return this.singleReply; }
}
