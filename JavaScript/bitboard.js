/*
 * bitboard.js - Pikafish 风格的位棋盘 (Bitboard) 模块 - JavaScript 实现
 *
 * 参考 Pikafish (https://github.com/official-pikafish/Pikafish) 的 src/bitboard.h / bitboard.cpp
 * 实现 90 格 (9x10) 中国象棋位棋盘,使用 BigInt 表示 128-bit 位棋盘
 *
 * 坐标映射:
 *   - file (列): 0..8, 红方从右到左为 a..i
 *   - rank (行): 0..9, 0 为黑方底线, 9 为红方底线
 *   - square    = file + rank * 9   (范围 0..89)
 */

"use strict";

// =============================================================================
// 常量
// =============================================================================

const FILE_NB = 9;
const RANK_NB = 10;
const SQUARE_NB = 90;

// 文件
const FILE_A = 0, FILE_B = 1, FILE_C = 2, FILE_D = 3, FILE_E = 4;
const FILE_F = 5, FILE_G = 6, FILE_H = 7, FILE_I = 8;

// 行列
const RANK_0 = 0, RANK_1 = 1, RANK_2 = 2, RANK_3 = 3, RANK_4 = 4;
const RANK_5 = 5, RANK_6 = 6, RANK_7 = 7, RANK_8 = 8, RANK_9 = 9;

// 空位
const SQ_NONE = 90;

// 阵营
const RED = 0, BLACK = 1, COLOR_NB = 2;

// 棋子类型 (Pikafish 中: R, N, B, A, K, C, P = 0..6)
const R_ROOK = 0, R_KNIGHT = 1, R_BISHOP = 2, R_ADVISOR = 3;
const R_KING = 4, R_CANNON = 5, R_PAWN = 6;
const B_ROOK = 7, B_KNIGHT = 8, B_BISHOP = 9, B_ADVISOR = 10;
const B_KING = 11, B_CANNON = 12, B_PAWN = 13;
const PIECE_TYPE_NB = 14;

// 类别: 去掉颜色得到 PIECE_TYPE
const PIECE_TYPE = [0,1,2,3,4,5,6, 0,1,2,3,4,5,6];
const COLOR_OF   = [RED,RED,RED,RED,RED,RED,RED, BLACK,BLACK,BLACK,BLACK,BLACK,BLACK,BLACK];

// =============================================================================
// 方向 / 增量
// =============================================================================

const DELTA_N = -9;   // 上 (北)
const DELTA_S = 9;    // 下 (南)
const DELTA_E = 1;    // 右 (东)
const DELTA_W = -1;   // 左 (西)

const KING_DELTA   = [-9, 9, 1, -1];
const ADVISOR_DELTA = [-10, -8, 8, 10];
const KNIGHT_DELTA = [
  [ -17,  17 ], // 向上 (N)
  [ -17,  17 ], // 占位 (不会使用)
  [  -1,   1 ], // 占位
  [ -10,  10 ]  // 占位 - 这里我们改用 Pikafish 风格实现
];
// Knight: 8 个方向, 起点偏移 + 马腿位置
// Pikafish 的做法: 每个方向有一个 (方向偏移, 马腿偏移) 对
const KNIGHT_LEG = [
  { d: -19, leg: -9  }, // 方向 0: 上左
  { d: -19, leg: -9  }, // 同上,占位
  { d:  -1, leg: -9  }, // 方向 2: 上右
  { d:  -1, leg: -9  }, // 占位
  { d:  17, leg:  9  }, // 方向 4: 下左
  { d:  17, leg:  9  }, // 占位
  { d:   1, leg:  9  }, // 方向 6: 下右
  { d:   1, leg:  9  }  // 占位
];

// 我们使用更直观的 8 方向表示
// idx: 0=NW, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W
const KNIGHT_MOVES = [
  { d:  -19, leg:  -9 },  // NW
  { d:  -10, leg:  -1 },  // N
  { d:   -7, leg:   1 },  // NE
  { d:   10, leg:   9 },  // E   (实际是 1 + 9 之类,这里仅为示意)
  { d:   19, leg:   9 },  // SE
  { d:   10, leg:   1 },  // S
  { d:    7, leg:  -1 },  // SW
  { d:  -10, leg:  -9 }   // W
];
// 上面这种方式不直观, 我们使用 Pikafish 的命名规则重做:
// 在 Pikafish 里马的走法是 8 个方向, 每个方向由 (位移, 马腿位置) 描述
// 这里我们用清晰的常量数组,后续在 move generation 中使用

// 重新定义 (位移 dx + dy*9, 马腿位置 dx + dy*9)
// 马从 (fx, fy) 走到 (tx, ty), 然后判断马腿 (fx + dx, fy + dy)
// dy:-1(上), 0(平), 1(下); dx:-1(左), 0(中), 1(右)
const KNIGHT_OFFSETS = [
  { dx: -1, dy: -2, lx: 0, ly: -1 }, // 左上
  { dx:  1, dy: -2, lx: 0, ly: -1 }, // 右上
  { dx: -1, dy:  2, lx: 0, ly:  1 }, // 左下
  { dx:  1, dy:  2, lx: 0, ly:  1 }, // 右下
  { dx: -2, dy: -1, lx: -1, ly: 0 }, // 上左
  { dx: -2, dy:  1, lx: -1, ly: 0 }, // 下左
  { dx:  2, dy: -1, lx: 1, ly: 0 },  // 上右
  { dx:  2, dy:  1, lx: 1, ly: 0 }   // 下右
];

// =============================================================================
// 兵的位置相关: 过河判断
// =============================================================================

// 红兵在 rank 5,6,7,8,9; 黑兵在 rank 0,1,2,3,4
// 红兵过河 (rank >= 5), 可横走; 黑兵过河 (rank <= 4), 可横走

// 宫: 红方 rank 7..9 file 3..5; 黑方 rank 0..2 file 3..5
// 在 0..89 坐标下:
//   红宫: square 3+7*9..5+9*9, 即 file 3-5, rank 7-9
//   黑宫: square 3..5

const IN_RED_FORT = [
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,1,1,1,0,0,0,
  0,0,0,1,1,1,0,0,0,
  0,0,0,1,1,1,0,0,0,
];

const IN_BLK_FORT = [
  0,0,0,1,1,1,0,0,0,
  0,0,0,1,1,1,0,0,0,
  0,0,0,1,1,1,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
];

// 象眼位置 (红方): (2,5) (2,7) (4,5) (4,7) (6,5) (6,7) (8,5) (8,7)
// 在 0..89 坐标下, 红方象眼 rank 5, 7, file 偶数 (2,4,6,8)
const BISHOP_LEG_RED = [
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,1,0,1,0,1,   // rank 5, file 2,4,6,8
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,1,0,1,0,1,   // rank 7, file 2,4,6,8
  0,0,0,0,0,0,0,0,0,
];
// 黑方象眼 rank 2, 4
const BISHOP_LEG_BLK = [
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,1,0,1,0,1,   // rank 2
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,1,0,1,0,1,   // rank 4
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,
];

// =============================================================================
// 工具函数
// =============================================================================

function square(file, rank) { return file + rank * 9; }
function fileOf(sq)         { return sq % 9; }
function rankOf(sq)         { return (sq / 9) | 0; }
function squareOk(sq)       { return sq >= 0 && sq < 90; }
function fileOk(f)          { return f >= 0 && f < 9; }
function rankOk(r)          { return r >= 0 && r < 10; }

// =============================================================================
// BigInt 位棋盘操作
// =============================================================================

const BB_ZERO = 0n;
const BB_ALL  = (1n << 90n) - 1n;

function bbOf(sq) { return 1n << BigInt(sq); }

function bbTest(b, sq) { return ((b >> BigInt(sq)) & 1n) !== 0n; }

// 弹出最低位的索引
function bbPopLsb(b) {
  if (b === 0n) return SQ_NONE;
  const sq = Number(b & -b).toString(2).length - 1; // 不准确, 改为查找
  // BigInt 没法直接 .toString 找到 lsb 的位置,用 toString(2)
  const bin = (b & -b).toString(2);  // 等于 1 << sq
  return bin.length - 1;
}

// 弹出一个 bit 并返回索引 (Pikafish 风格)
function bbPopLsbInPlace(arr) {
  for (let i = 0; i < 90; i++) {
    if (arr[i]) { arr[i] = 0; return i; }
  }
  return SQ_NONE;
}

// 简单 popcount for BigInt (借用 number 转换)
function bbCount(b) {
  let c = 0;
  let x = b;
  while (x) {
    if (x & 1n) c++;
    x >>= 1n;
  }
  return c;
}

// BigInt lsb 索引 (Ctz)
function bbCtz(b) {
  if (b === 0n) return 90;
  // 转换为 16 进制字符串去掉前缀, 计算其最低位
  let x = b & -b;  // 1 << sq
  // BigInt 转字符串再 parse
  const hex = x.toString(16);
  // 用查表法找最低位 1 的位置
  // 简单实现: 转换为 2 进制
  return x.toString(2).length - 1;
}

// 把 BigInt 位棋盘拆解为 int array (用来枚举 bit)
function bbToArray(b) {
  const arr = new Int32Array(90);
  let x = b;
  let i = 0;
  while (x && i < 90) {
    if (x & 1n) arr[i] = 1;
    x >>= 1n;
    i++;
  }
  return arr;
}

// =============================================================================
// 兵/卒的攻击模式 (Pikafish 风格: 预计算)
// =============================================================================

// 兵的攻击位 (单格步长)
// 红色: 前进 + 过河后左右
// 黑色: 前进 + 过河后左右

// RedPawnAttacks[sq] 给出红兵在 sq 时的攻击位
const RedPawnAttacks = new Array(90).fill(0n);
const BlkPawnAttacks = new Array(90).fill(0n);

for (let sq = 0; sq < 90; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  // 红兵前进
  if (r > 0) RedPawnAttacks[sq] |= bbOf(sq - 9);
  // 红兵过河后可横走
  if (r >= 5) {
    if (f > 0) RedPawnAttacks[sq] |= bbOf(sq - 1);
    if (f < 8) RedPawnAttacks[sq] |= bbOf(sq + 1);
  }
  // 黑兵前进
  if (r < 9) BlkPawnAttacks[sq] |= bbOf(sq + 9);
  // 黑兵过河后可横走
  if (r <= 4) {
    if (f > 0) BlkPawnAttacks[sq] |= bbOf(sq - 1);
    if (f < 8) BlkPawnAttacks[sq] |= bbOf(sq + 1);
  }
}

// =============================================================================
// 将/帅的攻击 (Pikafish 风格)
// =============================================================================

const RedKingAttacks = new Array(90).fill(0n);
const BlkKingAttacks = new Array(90).fill(0n);

for (let sq = 0; sq < 90; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  // 红帅在 rank 7..9 file 3..5
  if (r >= 7 && f >= 3 && f <= 5) {
    for (const d of KING_DELTA) {
      const t = sq + d;
      if (t < 0 || t >= 90) continue;
      if (rankOf(t) < 7) continue;
      if (fileOf(t) < 3 || fileOf(t) > 5) continue;
      RedKingAttacks[sq] |= bbOf(t);
    }
  }
  // 黑将
  if (r <= 2 && f >= 3 && f <= 5) {
    for (const d of KING_DELTA) {
      const t = sq + d;
      if (t < 0 || t >= 90) continue;
      if (rankOf(t) > 2) continue;
      if (fileOf(t) < 3 || fileOf(t) > 5) continue;
      BlkKingAttacks[sq] |= bbOf(t);
    }
  }
}

// =============================================================================
// 士/仕的攻击
// =============================================================================

const RedAdvAttacks = new Array(90).fill(0n);
const BlkAdvAttacks = new Array(90).fill(0n);

for (let sq = 0; sq < 90; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  if (r >= 7 && f >= 3 && f <= 5) {
    for (const d of ADVISOR_DELTA) {
      const t = sq + d;
      if (t < 0 || t >= 90) continue;
      if (rankOf(t) < 7) continue;
      if (fileOf(t) < 3 || fileOf(t) > 5) continue;
      RedAdvAttacks[sq] |= bbOf(t);
    }
  }
  if (r <= 2 && f >= 3 && f <= 5) {
    for (const d of ADVISOR_DELTA) {
      const t = sq + d;
      if (t < 0 || t >= 90) continue;
      if (rankOf(t) > 2) continue;
      if (fileOf(t) < 3 || fileOf(t) > 5) continue;
      BlkAdvAttacks[sq] |= bbOf(t);
    }
  }
}

// =============================================================================
// 相/象的攻击 (含象眼)
// =============================================================================

const RedBshAttacks = new Array(90).fill(0n);
const BlkBshAttacks = new Array(90).fill(0n);
const RedBshLegs    = new Array(90).fill(0n);
const BlkBshLegs    = new Array(90).fill(0n);

const BISHOP_DIAG = [-20, -16, 16, 20]; // 4 个对角线方向

for (let sq = 0; sq < 90; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  // 红方象 (在己方, rank 0..4, 不过河)
  if (r <= 4) {
    for (const d of BISHOP_DIAG) {
      const leg = sq + (d >> 1);
      const t   = sq + d;
      if (leg < 0 || leg >= 90 || t < 0 || t >= 90) continue;
      if (BISHOP_LEG_RED[leg] !== 1) continue;
      if (Math.abs(fileOf(t) - f) !== 2) continue;
      if (Math.abs(rankOf(t) - r) !== 2) continue;
      RedBshAttacks[sq] |= bbOf(t);
      RedBshLegs[sq]    |= bbOf(leg);
    }
  }
  // 黑方象
  if (r >= 5) {
    for (const d of BISHOP_DIAG) {
      const leg = sq + (d >> 1);
      const t   = sq + d;
      if (leg < 0 || leg >= 90 || t < 0 || t >= 90) continue;
      if (BISHOP_LEG_BLK[leg] !== 1) continue;
      if (Math.abs(fileOf(t) - f) !== 2) continue;
      if (Math.abs(rankOf(t) - r) !== 2) continue;
      BlkBshAttacks[sq] |= bbOf(t);
      BlkBshLegs[sq]    |= bbOf(leg);
    }
  }
}

// =============================================================================
// 马的攻击位
// =============================================================================

const RedHrsAttacks = new Array(90).fill(0n);
const BlkHrsAttacks = new Array(90).fill(0n);
const RedHrsLegs    = new Array(90).fill(0n);
const BlkHrsLegs    = new Array(90).fill(0n);

for (let sq = 0; sq < 90; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  for (const k of KNIGHT_OFFSETS) {
    const t = sq + k.dx + k.dy * 9;
    const leg = sq + k.lx + k.ly * 9;
    if (t < 0 || t >= 90) continue;
    if (leg < 0 || leg >= 90) continue;
    if (Math.abs(fileOf(t) - f) !== Math.abs(k.dx)) continue;
    if (Math.abs(rankOf(t) - r) !== Math.abs(k.dy)) continue;
    // 注意马不能走出棋盘
    if (fileOf(t) < 0 || fileOf(t) > 8) continue;
    if (rankOf(t) < 0 || rankOf(t) > 9) continue;
    // 红马不能过河 (rank <= 4), 黑马不能过河 (rank >= 5)
    if (r > 4) {
      // 红方: 此马是红马, 不能过河
      if (rankOf(t) > 4) continue;
    } else {
      // 黑方: 不能过河
      if (rankOf(t) < 5) continue;
    }
    if (r > 4) {
      RedHrsAttacks[sq] |= bbOf(t);
      RedHrsLegs[sq]    |= bbOf(leg);
    } else {
      BlkHrsAttacks[sq] |= bbOf(t);
      BlkHrsLegs[sq]    |= bbOf(leg);
    }
  }
}

// =============================================================================
// 车/炮的攻击: 用 occ 位棋盘做射线扫描
// =============================================================================

function rookAttacks(sq, occ) {
  let att = 0n;
  // 4 方向射线
  for (const d of [1, -1, 9, -9]) {
    let t = sq + d;
    while (t >= 0 && t < 90) {
      // 边界: 不能跨文件
      if (d === 1 || d === -1) {
        const f0 = fileOf(sq), f1 = fileOf(t);
        if (Math.abs(f1 - f0) !== Math.abs(t - sq)) break;
      } else {
        const f0 = fileOf(sq), f1 = fileOf(t);
        if (f0 !== f1) break;
      }
      att |= bbOf(t);
      if (bbTest(occ, t)) break;
      t += d;
    }
  }
  return att;
}

function cannonAttacks(sq, occ) {
  let att = 0n;
  for (const d of [1, -1, 9, -9]) {
    let t = sq + d;
    let jumped = false;
    while (t >= 0 && t < 90) {
      if (d === 1 || d === -1) {
        const f0 = fileOf(sq), f1 = fileOf(t);
        if (Math.abs(f1 - f0) !== Math.abs(t - sq)) break;
      } else {
        const f0 = fileOf(sq), f1 = fileOf(t);
        if (f0 !== f1) break;
      }
      if (!jumped) {
        if (bbTest(occ, t)) { jumped = true; t += d; continue; }
        att |= bbOf(t);
      } else {
        if (bbTest(occ, t)) { att |= bbOf(t); break; }
      }
      t += d;
    }
  }
  return att;
}

// =============================================================================
// 全局: 将当前 zobrist 随机值预生成
// =============================================================================

function makeZobrist(seed) {
  // 简易 LCG
  let s = seed >>> 0;
  return function() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

const ZOB = makeZobrist(0x9e3779b9);

// zobrist[piece][square] - 64 bit
const ZOBRIST = new Array(14);
const ZOBRIST_SIDE = BigInt(ZOB());
for (let p = 0; p < 14; p++) {
  ZOBRIST[p] = new Array(90);
  for (let s = 0; s < 90; s++) ZOBRIST[p][s] = BigInt(ZOB());
}

// =============================================================================
// 暴露到全局 (确保跨文件访问)
// =============================================================================

(function() {
  const g = (typeof window !== 'undefined') ? window : globalThis;
  g.FILE_NB = FILE_NB; g.RANK_NB = RANK_NB; g.SQUARE_NB = SQUARE_NB;
  g.FILE_A = FILE_A; g.FILE_B = FILE_B; g.FILE_C = FILE_C; g.FILE_D = FILE_D; g.FILE_E = FILE_E;
  g.FILE_F = FILE_F; g.FILE_G = FILE_G; g.FILE_H = FILE_H; g.FILE_I = FILE_I;
  g.RANK_0 = RANK_0; g.RANK_1 = RANK_1; g.RANK_2 = RANK_2; g.RANK_3 = RANK_3; g.RANK_4 = RANK_4;
  g.RANK_5 = RANK_5; g.RANK_6 = RANK_6; g.RANK_7 = RANK_7; g.RANK_8 = RANK_8; g.RANK_9 = RANK_9;
  g.SQ_NONE = SQ_NONE;
  g.RED = RED; g.BLACK = BLACK; g.COLOR_NB = COLOR_NB;
  g.R_ROOK = R_ROOK; g.R_KNIGHT = R_KNIGHT; g.R_BISHOP = R_BISHOP; g.R_ADVISOR = R_ADVISOR;
  g.R_KING = R_KING; g.R_CANNON = R_CANNON; g.R_PAWN = R_PAWN;
  g.B_ROOK = B_ROOK; g.B_KNIGHT = B_KNIGHT; g.B_BISHOP = B_BISHOP; g.B_ADVISOR = B_ADVISOR;
  g.B_KING = B_KING; g.B_CANNON = B_CANNON; g.B_PAWN = B_PAWN;
  g.PIECE_TYPE_NB = PIECE_TYPE_NB; g.PIECE_TYPE = PIECE_TYPE; g.COLOR_OF = COLOR_OF;
  g.KING_DELTA = KING_DELTA; g.ADVISOR_DELTA = ADVISOR_DELTA;
  g.KNIGHT_OFFSETS = KNIGHT_OFFSETS; g.BISHOP_DIAG = BISHOP_DIAG;
  g.square = square; g.fileOf = fileOf; g.rankOf = rankOf;
  g.squareOk = squareOk; g.fileOk = fileOk; g.rankOk = rankOk;
  g.BB_ZERO = BB_ZERO; g.BB_ALL = BB_ALL; g.bbOf = bbOf;
  g.bbTest = bbTest; g.bbCount = bbCount; g.bbCtz = bbCtz;
  g.bbToArray = bbToArray; g.bbPopLsbInPlace = bbPopLsbInPlace;
  g.RedPawnAttacks = RedPawnAttacks; g.BlkPawnAttacks = BlkPawnAttacks;
  g.RedKingAttacks = RedKingAttacks; g.BlkKingAttacks = BlkKingAttacks;
  g.RedAdvAttacks = RedAdvAttacks; g.BlkAdvAttacks = BlkAdvAttacks;
  g.RedBshAttacks = RedBshAttacks; g.BlkBshAttacks = BlkBshAttacks;
  g.RedBshLegs = RedBshLegs; g.BlkBshLegs = BlkBshLegs;
  g.RedHrsAttacks = RedHrsAttacks; g.BlkHrsAttacks = BlkHrsAttacks;
  g.RedHrsLegs = RedHrsLegs; g.BlkHrsLegs = BlkHrsLegs;
  g.rookAttacks = rookAttacks; g.cannonAttacks = cannonAttacks;
  g.ZOBRIST = ZOBRIST; g.ZOBRIST_SIDE = ZOBRIST_SIDE;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FILE_NB, RANK_NB, SQUARE_NB,
    FILE_A, FILE_B, FILE_C, FILE_D, FILE_E, FILE_F, FILE_G, FILE_H, FILE_I,
    RANK_0, RANK_1, RANK_2, RANK_3, RANK_4, RANK_5, RANK_6, RANK_7, RANK_8, RANK_9,
    SQ_NONE, RED, BLACK, COLOR_NB,
    R_ROOK, R_KNIGHT, R_BISHOP, R_ADVISOR, R_KING, R_CANNON, R_PAWN,
    B_ROOK, B_KNIGHT, B_BISHOP, B_ADVISOR, B_KING, B_CANNON, B_PAWN,
    PIECE_TYPE_NB, PIECE_TYPE, COLOR_OF,
    KING_DELTA, ADVISOR_DELTA, KNIGHT_OFFSETS, BISHOP_DIAG,
    square, fileOf, rankOf, squareOk, fileOk, rankOk,
    BB_ZERO, BB_ALL, bbOf, bbTest, bbCount, bbCtz, bbToArray, bbPopLsbInPlace,
    RedPawnAttacks, BlkPawnAttacks,
    RedKingAttacks, BlkKingAttacks,
    RedAdvAttacks, BlkAdvAttacks,
    RedBshAttacks, BlkBshAttacks, RedBshLegs, BlkBshLegs,
    BlkBshLegs,
    RedHrsAttacks, BlkHrsAttacks, RedHrsLegs, BlkHrsLegs,
    rookAttacks, cannonAttacks,
    ZOBRIST, ZOBRIST_SIDE
  };
}
