/*
 * cchess.js - 辅助函数 (Pikafish 模块)
 *
 * 提供:
 *   - 棋子在 0..89 坐标和字符串之间的转换 (ICCS 坐标)
 *   - 棋盘视图相关常量
 *   - 棋子字符与代码转换
 */

"use strict";

// =============================================================================
// 棋盘坐标常量 (9x10 棋盘)
// =============================================================================

const BOARD_W = 9;
const BOARD_H = 10;
const SQUARE_W = 60;   // 像素
const SQUARE_H = 60;
const BOARD_OFFSET_X = 30;
const BOARD_OFFSET_Y = 30;

// ICCS 坐标 -> file/rank
// 例如: h3 -> file=7, rank=2 (红方视角下)
// 红方: 从右到左 a-i, 数字从己方到底 0-9
// 黑方: 从左到右 a-i, 数字从己方到底 0-9 (棋盘翻转)
// 我们使用 0-89 坐标: file 0-8, rank 0-9 (0 在顶, 9 在底)

const FILES = "abcdefghi";

// (file, rank) -> ICCS 字符串 (红方视角, 用于显示)
function squareToIccs(sq, flipped) {
  const f = sq % 9;
  const r = (sq / 9) | 0;
  if (flipped) {
    // 黑方视角: 列从右到左
    return FILES.charAt(8 - f) + (10 - r);
  }
  return FILES.charAt(f) + (r + 1);
}

// ICCS 字符串 -> square
function iccsToSquare(s) {
  const f = FILES.indexOf(s.charAt(0));
  let r;
  if (s.length >= 3) {
    // "10" 表示 rank 9
    r = 9;
  } else {
    r = parseInt(s.charAt(1), 10) - 1;
  }
  return f + r * 9;
}

// 着法 -> ICCS
function moveToIccs(mv, flipped) {
  const from = moveFrom(mv);
  const to = moveTo(mv);
  return squareToIccs(from, flipped) + "-" + squareToIccs(to, flipped);
}

// 棋子 -> 字符
const PIECE_CHAR_RED   = ["R","N","B","A","K","C","P"];
const PIECE_CHAR_BLK   = ["r","n","b","a","k","c","p"];

function pieceToChar(pc) {
  if (pc < 0) return "";
  const pt = PIECE_TYPE[pc];
  if (pc < 7) return PIECE_CHAR_RED[pt];
  return PIECE_CHAR_BLK[pt];
}

// =============================================================================
// 暴露
// =============================================================================

window.squareToIccs = squareToIccs;
window.iccsToSquare = iccsToSquare;
window.moveToIccs   = moveToIccs;
window.pieceToChar  = pieceToChar;
window.FILES        = FILES;
window.BOARD_W      = BOARD_W;
window.BOARD_H      = BOARD_H;
window.SQUARE_W     = SQUARE_W;
window.SQUARE_H     = SQUARE_H;
window.BOARD_OFFSET_X = BOARD_OFFSET_X;
window.BOARD_OFFSET_Y = BOARD_OFFSET_Y;
