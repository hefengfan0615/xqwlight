/*
 * position.js - Pikafish 风格 Position 模块 - JavaScript 实现
 *
 * 参考 Pikafish 的 src/position.h / position.cpp:
 *   - 使用位棋盘 (Bitboard) 描述棋盘
 *   - Zobrist 哈希
 *   - 增量 make/undo move
 *   - 完整着法生成 (pseudo-legal)
 *   - 简易 PST 估值 (Pikafish 在 evaluate.cpp 中使用 NNUE; 这里用 PST 简化)
 */

"use strict";

// 引入 bitboard
// 通过 <script> 标签加载时 bitboard.js 中定义的变量已经是全局

// =============================================================================
// 着法编码
// =============================================================================

// Pikafish 使用 16-bit 整数编码着法:
// bits 0-6:  from square  (0-89)
// bits 7-13: to square    (0-89)
// bits 14-15: 保留 (Pikafish 中为 flags, 我们用 14-15 表示类型)
// 这里我们用 16-bit, 低 7 位源, 中 7 位目标, 高 2 位保留
function makeMove(from, to) {
  return (to << 7) | from;
}
function moveFrom(mv) { return mv & 0x7F; }
function moveTo(mv)   { return (mv >> 7) & 0x7F; }
const MOVE_NONE = 0;
const MOVE_NULL = 0;

// =============================================================================
// 状态对象 (类似 Pikafish 的 StateInfo)
// =============================================================================

function StateInfo() {
  this.key        = 0n;     // zobrist key
  this.captured   = -1;     // 被吃掉的棋子 (无则为 -1)
  // 历史 / 计步
  this.rule50     = 0;      // 50 回合规则
  this.moveCount  = 0;      // 总回合数
  // 上一手是否将军 (用于空着裁剪)
  this.givesCheck = false;
}

// =============================================================================
// Position
// =============================================================================

function Position() {
  this.st = [];       // StateInfo 栈
  this.byPieceBB = new Array(14);  // 各类棋子位棋盘
  for (let i = 0; i < 14; i++) this.byPieceBB[i] = 0n;
  this.occRed  = 0n;
  this.occBlk  = 0n;
  this.occ     = 0n;
  this.side    = RED;
  this.pieceOn = new Int8Array(90);   // 每格上的棋子
  for (let i = 0; i < 90; i++) this.pieceOn[i] = -1;

  this.stack = [];    // 增量 undo 信息: {captured, prevPieceOn[from], prevPieceOn[to], prevKey, prevSide, prevGivesCheck, prevRule50}
  // king squares
  this.kingRed = SQ_NONE;
  this.kingBlk = SQ_NONE;
}

// -----------------------------------------------------------------------------
// 基础操作
// -----------------------------------------------------------------------------

Position.prototype.putPiece = function(pc, sq) {
  this.byPieceBB[pc] |= bbOf(sq);
  this.pieceOn[sq] = pc;
};

Position.prototype.removePiece = function(pc, sq) {
  this.byPieceBB[pc] &= ~bbOf(sq);
  this.pieceOn[sq] = -1;
};

Position.prototype.movePiece = function(pc, from, to) {
  this.byPieceBB[pc] &= ~bbOf(from);
  this.byPieceBB[pc] |=  bbOf(to);
  this.pieceOn[from] = -1;
  this.pieceOn[to]   = pc;
};

Position.prototype.pieceAt = function(sq) {
  return this.pieceOn[sq];
};

Position.prototype.kingSquare = function(c) {
  return c === RED ? this.kingRed : this.kingBlk;
};

// -----------------------------------------------------------------------------
// 攻击检测
// -----------------------------------------------------------------------------

Position.prototype.isSquareAttacked = function(sq, bySide) {
  // bySide 表示谁在攻击 sq
  // 检测方式: 用所有能攻击 sq 的对方棋子
  if (bySide === RED) {
    // 红方
    if (RedPawnAttacks[sq] !== 0n) {
      // 红兵反过来: 攻击 sq 的红兵在 sq - 9 (黑兵前进方向) 或 sq ± 1 (过河后)
      const attackers = RedPawnAttacks[sq];
      // 那些在攻击位的红兵,实际上是 (sq + 9) 或过河后的 (sq - 1) / (sq + 1)
      // 我们反查: 找出所有在 attacks 位的兵
      // 简单方法: 检查 sq - 9, sq - 1, sq + 1 是否有红兵
      // 但 RedPawnAttacks[sq] 已经把红兵在 sq 时的攻击位算出来了
      // 现在 sq 是被攻击的目标, 我们要看红方在攻击它
      // 红兵攻击 sq 的条件: 攻击者位置在 sq - 9 (即攻击者走过 9 来到 sq, 但红兵只前进), 或 sq - 1 / sq + 1 (过河后)
      // 反查 = 攻击者的位置 = sq 的"被攻击"反向
      // 实现: 遍历攻击位, 检查对应方格是否有红兵
      let b = attackers;
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] >= 0 && this.pieceOn[s] <= 6) return true; // 红兵
      }
    }
    // 帅: 攻击 sq 的红帅位置
    if (RedKingAttacks[sq] !== 0n) {
      let b = RedKingAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] === R_KING) return true;
      }
    }
    // 仕
    if (RedAdvAttacks[sq] !== 0n) {
      let b = RedAdvAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] === R_ADVISOR) return true;
      }
    }
    // 象
    if (RedBshAttacks[sq] !== 0n) {
      let b = RedBshAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        const leg = bbCtz(RedBshLegs[s]);
        // 检查象眼是否被堵
        if (this.pieceOn[s] === R_BISHOP && this.pieceOn[leg] === -1) return true;
      }
    }
    // 马
    if (RedHrsAttacks[sq] !== 0n) {
      let b = RedHrsAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        // 检查马腿
        if (this.pieceOn[s] === R_KNIGHT) {
          // 马腿: 我们需要知道 s 攻击 sq 的具体方向
          // 简单方法: 计算从 s 到 sq 的位移, 反查马腿
          const leg = this._knightLeg(s, sq, RED);
          if (leg !== -1 && this.pieceOn[leg] === -1) return true;
        }
      }
    }
    // 车
    if ((this.byPieceBB[R_ROOK] & rookAttacks(sq, this.occ)) !== 0n) return true;
    // 炮
    if ((this.byPieceBB[R_CANNON] & cannonAttacks(sq, this.occ)) !== 0n) return true;
  } else {
    // 黑方
    if (BlkPawnAttacks[sq] !== 0n) {
      let b = BlkPawnAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] >= 7 && this.pieceOn[s] <= 13) return true;
      }
    }
    if (BlkKingAttacks[sq] !== 0n) {
      let b = BlkKingAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] === B_KING) return true;
      }
    }
    if (BlkAdvAttacks[sq] !== 0n) {
      let b = BlkAdvAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] === B_ADVISOR) return true;
      }
    }
    if (BlkBshAttacks[sq] !== 0n) {
      let b = BlkBshAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        const leg = bbCtz(BlkBshLegs[s]);
        if (this.pieceOn[s] === B_BISHOP && this.pieceOn[leg] === -1) return true;
      }
    }
    if (BlkHrsAttacks[sq] !== 0n) {
      let b = BlkHrsAttacks[sq];
      while (b) {
        const s = bbCtz(b); b &= b - 1n;
        if (this.pieceOn[s] === B_KNIGHT) {
          const leg = this._knightLeg(s, sq, BLACK);
          if (leg !== -1 && this.pieceOn[leg] === -1) return true;
        }
      }
    }
    if ((this.byPieceBB[B_ROOK] & rookAttacks(sq, this.occ)) !== 0n) return true;
    if ((this.byPieceBB[B_CANNON] & cannonAttacks(sq, this.occ)) !== 0n) return true;
  }
  return false;
};

Position.prototype._knightLeg = function(from, to, color) {
  const dx = fileOf(to) - fileOf(from);
  const dy = rankOf(to) - rankOf(from);
  for (const k of KNIGHT_OFFSETS) {
    if (k.dx === dx && k.dy === dy) {
      return from + k.lx + k.ly * 9;
    }
  }
  return -1;
};

Position.prototype.inCheck = function() {
  return this.isSquareAttacked(this.kingSquare(this.side), 1 - this.side);
};

Position.prototype.givesCheck = function(mv) {
  // 简化版: 应用着法, 检查对方是否被将军
  const from = moveFrom(mv), to = moveTo(mv);
  const pc = this.pieceOn[from];
  const captured = this.pieceOn[to];
  const color = COLOR_OF[pc];

  // 应用
  this.removePiece(pc, from);
  this.byPieceBB[pc] |= bbOf(to);
  this.pieceOn[to] = pc;
  const oldKingSq = this.kingSquare(color);
  if (pc === R_KING || pc === B_KING) {
    if (color === RED) this.kingRed = to;
    else this.kingBlk = to;
  }
  // 临时: 移除被吃
  if (captured >= 0) {
    this.byPieceBB[captured] &= ~bbOf(to);
  }
  this.occ = this.computeOcc();
  // 检查对方帅是否被攻击
  const oppKing = color === RED ? this.kingBlk : this.kingRed;
  const gives = this.isSquareAttacked(oppKing, color);
  // 撤销
  this.byPieceBB[pc] &= ~bbOf(to);
  this.byPieceBB[pc] |= bbOf(from);
  this.pieceOn[from] = pc;
  this.pieceOn[to]   = captured;
  if (pc === R_KING || pc === B_KING) {
    if (color === RED) this.kingRed = from;
    else this.kingBlk = from;
  }
  if (captured >= 0) {
    this.byPieceBB[captured] |= bbOf(to);
  }
  this.occ = this.computeOcc();
  return gives;
};

Position.prototype.computeOcc = function() {
  let o = 0n;
  for (let p = 0; p < 14; p++) o |= this.byPieceBB[p];
  return o;
};

// -----------------------------------------------------------------------------
// Zobrist key
// -----------------------------------------------------------------------------

Position.prototype.computeKey = function() {
  let key = 0n;
  for (let p = 0; p < 14; p++) {
    let b = this.byPieceBB[p];
    while (b) {
      const s = bbCtz(b); b &= b - 1n;
      key ^= ZOBRIST[p][s];
    }
  }
  if (this.side === BLACK) key ^= ZOBRIST_SIDE;
  return key;
};

// -----------------------------------------------------------------------------
// 走子 / 撤销
// -----------------------------------------------------------------------------

Position.prototype.doMove = function(mv, st) {
  const from = moveFrom(mv), to = moveTo(mv);
  const pc   = this.pieceOn[from];
  const captured = this.pieceOn[to];
  const color = COLOR_OF[pc];

  // 保存历史
  this.stack.push({
    mv: mv,
    captured: captured,
    from: from,
    to: to,
    pc: pc,
    color: color,
    kingRed: this.kingRed,
    kingBlk: this.kingBlk,
    occ: this.occ,
    side: this.side
  });

  // 更新 key
  let key = 0n;
  // 移除 from
  key ^= ZOBRIST[pc][from];
  // 添加 to (若 captured >= 0, 移除 captured)
  if (captured >= 0) key ^= ZOBRIST[captured][to];
  key ^= ZOBRIST[pc][to];
  // 切换阵营
  if (color === RED) {
    this.occRed &= ~bbOf(from); this.occRed |= bbOf(to);
    if (captured >= 0) { this.occBlk &= ~bbOf(to); }
  } else {
    this.occBlk &= ~bbOf(from); this.occBlk |= bbOf(to);
    if (captured >= 0) { this.occRed &= ~bbOf(to); }
  }
  this.occ = this.occRed | this.occBlk;

  this.movePiece(pc, from, to);
  if (captured >= 0) this.byPieceBB[captured] &= ~bbOf(to);

  if (pc === R_KING) this.kingRed = to;
  if (pc === B_KING) this.kingBlk = to;

  this.side = 1 - this.side;
  key ^= ZOBRIST_SIDE;

  this.st.push({ key: key, captured: captured, rule50: 0, moveCount: 0, givesCheck: this.inCheck() });
  return true;
};

Position.prototype.undoMove = function() {
  const s = this.stack.pop();
  if (!s) return;
  const { mv, captured, from, to, pc, color, kingRed, kingBlk, occ, side } = s;
  this.side = side;
  this.kingRed = kingRed;
  this.kingBlk = kingBlk;
  this.occ = occ;
  this.occRed = (color === RED)
    ? (occ & (this.byPieceBB[R_ROOK]|this.byPieceBB[R_KNIGHT]|this.byPieceBB[R_BISHOP]|this.byPieceBB[R_ADVISOR]|this.byPieceBB[R_KING]|this.byPieceBB[R_CANNON]|this.byPieceBB[R_PAWN]))
    : (occ & ~this.occBlk);
  this.occBlk = (color === BLACK)
    ? (occ & (this.byPieceBB[B_ROOK]|this.byPieceBB[B_KNIGHT]|this.byPieceBB[B_BISHOP]|this.byPieceBB[B_ADVISOR]|this.byPieceBB[B_KING]|this.byPieceBB[B_CANNON]|this.byPieceBB[B_PAWN]))
    : (occ & ~this.occRed);

  // 简化: 重新计算
  let r = 0n, b = 0n;
  for (let p = 0; p < 7; p++) r |= this.byPieceBB[p];
  for (let p = 7; p < 14; p++) b |= this.byPieceBB[p];
  this.occRed = r;
  this.occBlk = b;
  this.occ = r | b;

  // 还原棋子
  this.byPieceBB[pc] &= ~bbOf(to);
  this.byPieceBB[pc] |=  bbOf(from);
  this.pieceOn[to]   = captured;
  this.pieceOn[from] = pc;
  if (captured >= 0) this.byPieceBB[captured] |= bbOf(to);

  this.st.pop();
};

Position.prototype.doNullMove = function(st) {
  this.stack.push({
    mv: 0, captured: -1, from: -1, to: -1, pc: -1, color: -1,
    kingRed: this.kingRed, kingBlk: this.kingBlk, occ: this.occ, side: this.side
  });
  this.side = 1 - this.side;
  this.st.push({ key: 0n, captured: -1, rule50: 0, moveCount: 0, givesCheck: false });
};

Position.prototype.undoNullMove = function() {
  const s = this.stack.pop();
  this.side = s.side;
  this.kingRed = s.kingRed;
  this.kingBlk = s.kingBlk;
  this.occ = s.occ;
  this.st.pop();
};

// -----------------------------------------------------------------------------
// 着法生成 (pseudo-legal) - 类似 Pikafish 的 generate<LEGAL>
// -----------------------------------------------------------------------------

Position.prototype.generateMoves = function(mvs) {
  // mvs: Int32Array, 返回 [count, ...] 格式
  let n = 0;
  const side = this.side;

  for (let sq = 0; sq < 90; sq++) {
    const pc = this.pieceOn[sq];
    if (pc < 0) continue;
    if (COLOR_OF[pc] !== side) continue;
    const pt = PIECE_TYPE[pc];

    switch (pt) {
      case 0: // Rook
        n = this._genSliding(sq, pc, mvs, n, true);
        break;
      case 1: // Knight
        n = this._genKnight(sq, pc, mvs, n);
        break;
      case 2: // Bishop
        n = this._genBishop(sq, pc, mvs, n);
        break;
      case 3: // Advisor
        n = this._genAdvisor(sq, pc, mvs, n);
        break;
      case 4: // King
        n = this._genKing(sq, pc, mvs, n);
        break;
      case 5: // Cannon
        n = this._genSliding(sq, pc, mvs, n, false);
        break;
      case 6: // Pawn
        n = this._genPawn(sq, pc, mvs, n);
        break;
    }
  }
  return n;
};

Position.prototype._push = function(mvs, n, from, to) {
  // 排除吃自己
  const dst = this.pieceOn[to];
  if (dst >= 0 && COLOR_OF[dst] === this.side) return n;
  mvs[n] = (to << 7) | from;
  return n + 1;
};

Position.prototype._genSliding = function(sq, pc, mvs, n, isRook) {
  // 车和炮
  for (const d of [1, -1, 9, -9]) {
    let t = sq + d;
    let jumped = false;
    while (t >= 0 && t < 90) {
      // 边界: 车/炮走直线, 不能跨文件
      if (d === 1 || d === -1) {
        const df = Math.abs(fileOf(t) - fileOf(sq));
        const dr = Math.abs(t - sq);
        if (df !== dr) break;
      } else {
        if (fileOf(t) !== fileOf(sq)) break;
      }
      const dst = this.pieceOn[t];
      if (!jumped) {
        if (dst < 0) {
          mvs[n++] = (t << 7) | sq;
        } else {
          jumped = true;
        }
      } else {
        if (dst >= 0) {
          if (COLOR_OF[dst] !== this.side) {
            mvs[n++] = (t << 7) | sq;
          }
          break;
        }
      }
      t += d;
    }
  }
  return n;
};

Position.prototype._genKnight = function(sq, pc, mvs, n) {
  const atks = (PIECE_TYPE[pc] === 1 && COLOR_OF[pc] === RED) ? RedHrsAttacks : BlkHrsAttacks;
  const legs = (PIECE_TYPE[pc] === 1 && COLOR_OF[pc] === RED) ? RedHrsLegs    : BlkHrsLegs;
  let b = atks[sq];
  while (b) {
    const t = bbCtz(b); b &= b - 1n;
    // 找马腿
    let legBB = legs[sq];
    // 找出与 t 对应的马腿
    for (const k of KNIGHT_OFFSETS) {
      const to2 = sq + k.dx + k.dy * 9;
      if (to2 !== t) continue;
      const leg = sq + k.lx + k.ly * 9;
      if (this.pieceOn[leg] >= 0) {
        legBB = 0n;  // 马腿被堵
        break;
      }
    }
    // (上面逻辑略冗余,简化: 直接判断 t 处的马腿)
    // 重新计算: 对每个 KNIGHT_OFFSETS, 看哪个 to2 == t
    let legFound = -1;
    for (const k of KNIGHT_OFFSETS) {
      if (sq + k.dx + k.dy * 9 === t) { legFound = sq + k.lx + k.ly * 9; break; }
    }
    if (legFound >= 0 && this.pieceOn[legFound] < 0) {
      const dst = this.pieceOn[t];
      if (dst < 0 || COLOR_OF[dst] !== this.side) {
        mvs[n++] = (t << 7) | sq;
      }
    }
  }
  return n;
};

Position.prototype._genBishop = function(sq, pc, mvs, n) {
  const isRed = COLOR_OF[pc] === RED;
  const atks = isRed ? RedBshAttacks : BlkBshAttacks;
  let b = atks[sq];
  while (b) {
    const t = bbCtz(b); b &= b - 1n;
    // 找象眼
    let legFound = -1;
    for (const d of BISHOP_DIAG) {
      if (sq + d === t) { legFound = sq + (d >> 1); break; }
    }
    if (legFound >= 0 && this.pieceOn[legFound] < 0) {
      const dst = this.pieceOn[t];
      if (dst < 0 || COLOR_OF[dst] !== this.side) {
        mvs[n++] = (t << 7) | sq;
      }
    }
  }
  return n;
};

Position.prototype._genAdvisor = function(sq, pc, mvs, n) {
  const atks = (COLOR_OF[pc] === RED) ? RedAdvAttacks : BlkAdvAttacks;
  let b = atks[sq];
  while (b) {
    const t = bbCtz(b); b &= b - 1n;
    const dst = this.pieceOn[t];
    if (dst < 0 || COLOR_OF[dst] !== this.side) {
      mvs[n++] = (t << 7) | sq;
    }
  }
  return n;
};

Position.prototype._genKing = function(sq, pc, mvs, n) {
  const atks = (COLOR_OF[pc] === RED) ? RedKingAttacks : BlkKingAttacks;
  let b = atks[sq];
  while (b) {
    const t = bbCtz(b); b &= b - 1n;
    const dst = this.pieceOn[t];
    if (dst < 0 || COLOR_OF[dst] !== this.side) {
      mvs[n++] = (t << 7) | sq;
    }
  }
  return n;
};

Position.prototype._genPawn = function(sq, pc, mvs, n) {
  const isRed = COLOR_OF[pc] === RED;
  const atks = isRed ? RedPawnAttacks : BlkPawnAttacks;
  let b = atks[sq];
  while (b) {
    const t = bbCtz(b); b &= b - 1n;
    const dst = this.pieceOn[t];
    if (dst < 0 || COLOR_OF[dst] !== this.side) {
      mvs[n++] = (t << 7) | sq;
    }
  }
  return n;
};

// -----------------------------------------------------------------------------
// 合法着法 (排除送将)
// -----------------------------------------------------------------------------

Position.prototype.generateLegalMoves = function(mvs) {
  const n = this.generateMoves(mvs);
  let legal = 0;
  for (let i = 0; i < n; i++) {
    const mv = mvs[i];
    const from = moveFrom(mv), to = moveTo(mv);
    const pc = this.pieceOn[from];
    const captured = this.pieceOn[to];
    const color = COLOR_OF[pc];

    // 应用
    this.removePiece(pc, from);
    this.byPieceBB[pc] |= bbOf(to);
    this.pieceOn[to] = pc;
    const oldKing = (pc === R_KING) ? this.kingRed : (pc === B_KING) ? this.kingBlk : -1;
    if (pc === R_KING) this.kingRed = to;
    if (pc === B_KING) this.kingBlk = to;
    if (captured >= 0) this.byPieceBB[captured] &= ~bbOf(to);

    // 重新计算 occ
    if (color === RED) {
      this.occRed &= ~bbOf(from);
      this.occRed |= bbOf(to);
      if (captured >= 0) this.occBlk &= ~bbOf(to);
    } else {
      this.occBlk &= ~bbOf(from);
      this.occBlk |= bbOf(to);
      if (captured >= 0) this.occRed &= ~bbOf(to);
    }
    this.occ = this.occRed | this.occBlk;

    // 检查我方帅是否被对方攻击
    const myKing = color === RED ? this.kingRed : this.kingBlk;
    const inCheck = this.isSquareAttacked(myKing, 1 - color);

    // 撤销
    this.byPieceBB[pc] &= ~bbOf(to);
    this.byPieceBB[pc] |=  bbOf(from);
    this.pieceOn[from] = pc;
    this.pieceOn[to]   = captured;
    if (pc === R_KING) this.kingRed = from;
    if (pc === B_KING) this.kingBlk = from;
    if (captured >= 0) this.byPieceBB[captured] |= bbOf(to);

    if (color === RED) {
      this.occRed |= bbOf(from);
      this.occRed &= ~bbOf(to);
      if (captured >= 0) this.occBlk |= bbOf(to);
    } else {
      this.occBlk |= bbOf(from);
      this.occBlk &= ~bbOf(to);
      if (captured >= 0) this.occRed |= bbOf(to);
    }
    this.occ = this.occRed | this.occBlk;

    if (!inCheck) mvs[legal++] = mv;
  }
  return legal;
};

// -----------------------------------------------------------------------------
// FEN 解析
// -----------------------------------------------------------------------------

const FEN_PIECE = "          rnbakabnr  RNBAKABNR";  // 索引 0..15, 但我们用 0..14
// 红方: K, A, B, N, R, C, P -> 4, 3, 2, 1, 0, 5, 6
// 黑方: k, a, b, n, r, c, p -> 11, 10, 9, 8, 7, 12, 13
const FEN_TO_PIECE = {};
FEN_TO_PIECE['K']=R_KING; FEN_TO_PIECE['A']=R_ADVISOR; FEN_TO_PIECE['B']=R_BISHOP;
FEN_TO_PIECE['N']=R_KNIGHT; FEN_TO_PIECE['R']=R_ROOK; FEN_TO_PIECE['C']=R_CANNON;
FEN_TO_PIECE['P']=R_PAWN;
FEN_TO_PIECE['k']=B_KING; FEN_TO_PIECE['a']=B_ADVISOR; FEN_TO_PIECE['b']=B_BISHOP;
FEN_TO_PIECE['n']=B_KNIGHT; FEN_TO_PIECE['r']=B_ROOK; FEN_TO_PIECE['c']=B_CANNON;
FEN_TO_PIECE['p']=B_PAWN;

Position.prototype.setFen = function(fen) {
  // 清空
  for (let i = 0; i < 14; i++) this.byPieceBB[i] = 0n;
  this.occRed = 0n; this.occBlk = 0n; this.occ = 0n;
  this.kingRed = SQ_NONE; this.kingBlk = SQ_NONE;
  for (let i = 0; i < 90; i++) this.pieceOn[i] = -1;
  this.stack = []; this.st = [];

  // 解析 board 部分
  const parts = fen.trim().split(/\s+/);
  const board = parts[0];
  // 红方在底 (rank 9), 黑方在顶 (rank 0)
  // FEN 从黑方底 (rank 0) 开始
  let rank = 0, file = 0;
  for (const c of board) {
    if (c === '/') { rank++; file = 0; continue; }
    if (c >= '1' && c <= '9') {
      file += parseInt(c, 10);
    } else {
      const pc = FEN_TO_PIECE[c];
      if (pc !== undefined) {
        const sq = file + rank * 9;
        this.putPiece(pc, sq);
        if (pc === R_KING) this.kingRed = sq;
        if (pc === B_KING) this.kingBlk = sq;
      }
      file++;
    }
  }
  // 阵营
  this.side = (parts[1] === 'b' || parts[1] === 'B') ? BLACK : RED;
  // 重新计算 occ
  for (let p = 0; p < 7; p++) this.occRed |= this.byPieceBB[p];
  for (let p = 7; p < 14; p++) this.occBlk |= this.byPieceBB[p];
  this.occ = this.occRed | this.occBlk;

  this.st = [];
  this.stack = [];
  this.st.push({ key: this.computeKey(), captured: -1, rule50: 0, moveCount: 0, givesCheck: this.inCheck() });
  return true;
};

Position.prototype.fen = function() {
  let s = "";
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    for (let f = 0; f < 9; f++) {
      const pc = this.pieceOn[f + r * 9];
      if (pc < 0) { empty++; continue; }
      if (empty > 0) { s += String(empty); empty = 0; }
      const c = "rnbakcp".charAt(PIECE_TYPE[pc]);
      const ch = COLOR_OF[pc] === RED ? c.toUpperCase() : c;
      s += ch;
    }
    if (empty > 0) s += String(empty);
    if (r < 9) s += "/";
  }
  s += " " + (this.side === RED ? "w" : "b");
  return s;
};

// -----------------------------------------------------------------------------
// 简易估值 (PST 加权) - 替代 Pikafish 的 NNUE 评估
// -----------------------------------------------------------------------------

// 棋子基础价值 (Pikafish Value 中的近似值)
const PIECE_VAL = [
  900, 400, 200, 200, 10000, 450, 100,   // 红方
  900, 400, 200, 200, 10000, 450, 100    // 黑方
];

// 棋子位置奖励 (PST) - 90 平方, 简化
// 红方从 rank 9 -> 0 看, 黑方反过来
// 这里我们提供一个通用位置奖励表
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
  10, 18, 22, 35, 40, 35, 22, 18, 10,
  20, 27, 30, 40, 42, 40, 30, 27, 20,
  20, 27, 30, 40, 42, 40, 30, 27, 20,
  20, 27, 30, 40, 42, 40, 30, 27, 20,
  10, 18, 22, 35, 40, 35, 22, 18, 10
];
// 黑方对称: 反向
const PST_PAWN_BLK = PST_PAWN.slice().reverse();

const PST_KNIGHT = [
  90, 90, 90, 96, 90, 96, 90, 90, 90,
  90, 96,103, 97, 94, 97,103, 96, 90,
  92, 98, 99,103, 99,103, 99, 98, 92,
  93,108,100,107,100,107,100,108, 93,
  90,100, 99,103,104,103, 99,100, 90,
  90, 98,101,102,103,102,101, 98, 90,
  92, 94, 98, 95, 98, 95, 98, 94, 92,
  93, 92, 94, 95, 92, 95, 94, 92, 93,
  85, 90, 92, 93, 78, 93, 92, 90, 85,
  88, 85, 90, 88, 90, 88, 90, 85, 88
];
const PST_KNIGHT_BLK = PST_KNIGHT.slice().reverse();

const PST_BISHOP = [
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0, 20,  0,  0,  0, 20,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
  18,  0,  0, 20, 23, 20,  0,  0, 18,
   0,  0,  0,  0, 23,  0,  0,  0,  0,
   0,  0, 20, 20,  0, 20, 20,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0
];
const PST_BISHOP_BLK = PST_BISHOP.slice().reverse();

const PST_ROOK = [
 206,208,207,213,214,213,207,208,206,
 206,212,209,216,233,216,209,212,206,
 206,208,207,214,216,214,207,208,206,
 206,213,213,216,216,216,213,213,206,
 208,211,211,214,215,214,211,211,208,
 208,212,212,214,215,214,212,212,208,
 204,209,204,212,214,212,204,209,204,
 198,208,204,212,212,212,204,208,198,
 200,208,206,212,200,212,206,208,200,
 194,206,204,212,200,212,204,206,194
];
const PST_ROOK_BLK = PST_ROOK.slice().reverse();

const PST_CANNON = [
 100,100, 96, 91, 90, 91, 96,100,100,
  98, 98, 96, 92, 89, 92, 96, 98, 98,
  97, 97, 96, 91, 92, 91, 96, 97, 97,
  96, 99, 99, 98,100, 98, 99, 99, 96,
  96, 96, 96, 96,100, 96, 96, 96, 96,
  95, 96, 99, 96,100, 96, 99, 96, 95,
  96, 96, 96, 96, 96, 96, 96, 96, 96,
  97, 96,100, 99,101, 99,100, 96, 97,
  96, 97, 98, 98, 98, 98, 98, 97, 96,
  96, 96, 97, 99, 99, 99, 97, 96, 96
];
const PST_CANNON_BLK = PST_CANNON.slice().reverse();

const PST_ADVISOR = [
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0, 20,  0, 20,  0,  0,  0,
   0,  0,  0,  0, 23,  0,  0,  0,  0,
   0,  0,  0, 20,  0, 20,  0,  0,  0
];
const PST_ADVISOR_BLK = PST_ADVISOR.slice().reverse();

const PST_KING = [
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0
];

Position.prototype.evaluate = function() {
  let score = 0;
  // 红方分 - 黑方分
  for (let p = 0; p < 14; p++) {
    let b = this.byPieceBB[p];
    let v = PIECE_VAL[p];
    while (b) {
      const s = bbCtz(b); b &= b - 1n;
      let pst = 0;
      const isRed = p < 7;
      const pt = PIECE_TYPE[p];
      switch (pt) {
        case 0: pst = isRed ? PST_ROOK[s]     : PST_ROOK_BLK[s];     break;
        case 1: pst = isRed ? PST_KNIGHT[s]   : PST_KNIGHT_BLK[s];   break;
        case 2: pst = isRed ? PST_BISHOP[s]   : PST_BISHOP_BLK[s];   break;
        case 3: pst = isRed ? PST_ADVISOR[s]  : PST_ADVISOR_BLK[s];  break;
        case 4: pst = PST_KING[s]; break;
        case 5: pst = isRed ? PST_CANNON[s]   : PST_CANNON_BLK[s];   break;
        case 6: pst = isRed ? PST_PAWN[s]     : PST_PAWN_BLK[s];     break;
      }
      if (isRed) score += v + pst;
      else       score -= v + pst;
    }
  }
  // 翻转以当前走子方为正向
  if (this.side === BLACK) score = -score;
  // 微小随机因子
  return score;
};

// -----------------------------------------------------------------------------
// 字符串表示
// -----------------------------------------------------------------------------

Position.prototype.toString = function() {
  const lines = [];
  for (let r = 0; r < 10; r++) {
    let line = "";
    for (let f = 0; f < 9; f++) {
      const pc = this.pieceOn[f + r * 9];
      if (pc < 0) line += " .";
      else {
        const pt = PIECE_TYPE[pc];
        const c = "rnbakcp".charAt(PIECE_TYPE[pc]);
        line += COLOR_OF[pc] === RED ? " " + c.toUpperCase() : " " + c;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
};

// =============================================================================
// 暴露到全局
// =============================================================================

window.makeMove = makeMove;
window.moveFrom = moveFrom;
window.moveTo = moveTo;
window.MOVE_NONE = MOVE_NONE;
window.MOVE_NULL = MOVE_NULL;
window.StateInfo = StateInfo;
window.Position = Position;
