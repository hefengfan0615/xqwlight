/*
 * main.js - 程序入口
 * 1) 创建棋盘 + 搜索引擎
 * 2) 将引擎信息回调 (depth / score / PV / KNPS) 写入底部 info 面板
 * 3) 绑定 UI 控件（让先 / 让子 / 电脑水平 / 重开 / 悔棋）
 */

"use strict";

import { Board, RESULT_UNKNOWN } from "./board.js";
import { Search } from "./search.js";
import { move2Iccs } from "./types.js";
// BOOK_DAT 通过经典脚本注入到 window

const STARTUP_FEN = [
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKAB1R w - - 0 1",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/R1BAKAB1R w - - 0 1",
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/9/1C5C1/9/RN2K2NR w - - 0 1",
];

function createOption(text, value, ie8) {
  const opt = document.createElement("option");
  opt.selected = true;
  opt.value = value;
  if (ie8) opt.text = text;
  else opt.innerHTML = text.replace(/ /g, "&nbsp;");
  return opt;
}

const board = new Board(container, "images/", "sounds/");
const search = new Search(board.pos, 18);
board.setSearch(search);
board.bookDat = window.BOOK_DAT || [];
board.millis = 100;
board.computer = 1;

// ---------- 引擎信息 -> 底部 info 面板 ----------
const infoEl = document.getElementById("info");
const depthEl = document.getElementById("info-depth");
const scoreEl = document.getElementById("info-score");
const pvEl = document.getElementById("info-pv");
const knpsEl = document.getElementById("info-knps");
const npsEl = document.getElementById("info-nps");
const nodesEl = document.getElementById("info-nodes");
const timeEl = document.getElementById("info-time");

function formatScore(score) {
  if (!score) return "0.00";
  if (score.type === "mate") {
    const m = score.value;
    if (m === 0) return "杀棋";
    return (m > 0 ? "M" : "-M") + Math.abs(m);
  }
  if (score.type === "draw") return "和棋";
  if (score.type === "book") return "开局库";
  // 转换为"分"（每 100 cp = 1 分）
  return (score.value / 100).toFixed(2);
}

function setInfoText(info) {
  if (info.book) {
    depthEl.textContent = "—";
    scoreEl.textContent = "开局库";
    pvEl.textContent = (info.pv || []).map(move2Iccs).join(" ");
    knpsEl.textContent = "—";
    npsEl.textContent = "—";
    nodesEl.textContent = "—";
    timeEl.textContent = "—";
    infoEl.classList.add("active");
    return;
  }
  depthEl.textContent = String(info.depth);
  scoreEl.textContent = formatScore(info.score);
  pvEl.textContent = (info.pv || []).slice(0, 16).map(move2Iccs).join(" ");
  knpsEl.textContent = info.knps.toFixed(2);
  npsEl.textContent = info.nps.toLocaleString();
  nodesEl.textContent = info.nodes.toLocaleString();
  timeEl.textContent = info.time + " ms";
  infoEl.classList.add("active");
}

function clearInfoText() {
  depthEl.textContent = "—";
  scoreEl.textContent = "—";
  pvEl.textContent = "等待搜索…";
  knpsEl.textContent = "—";
  npsEl.textContent = "—";
  nodesEl.textContent = "—";
  timeEl.textContent = "—";
}

search.onInfo = function (info) { setInfoText(info); };
board.onSearchStart = function () { clearInfoText(); };
board.onSearchEnd = function () { /* noop */ };

// ---------- 步骤面板 ----------
board.onAddMove = function () {
  const counter = (board.pos.mvList.length >> 1);
  const space = (counter > 99 ? "    " : "   ");
  const numStr = (counter > 9 ? "" : " ") + counter + ".";
  const text = (board.pos.sdPlayer === 0 ? space : numStr) + move2Iccs(board.mvLast);
  const value = "" + board.mvLast;
  try {
    selMoveList.add(createOption(text, value, false));
  } catch (e) {
    selMoveList.add(createOption(text, value, true));
  }
  selMoveList.scrollTop = selMoveList.scrollHeight;
};

// ---------- UI 控件 ----------
function level_change() {
  // selLevel 0=入门(10ms) 1=业余(100ms) 2=专业(1000ms)
  board.millis = Math.pow(10, selLevel.selectedIndex + 1);
}

function restart_click() {
  selMoveList.options.length = 1;
  selMoveList.selectedIndex = 0;
  board.computer = 1 - selMoveMode.selectedIndex;
  board.restart(STARTUP_FEN[selHandicap.selectedIndex]);
  clearInfoText();
}

function retract_click() {
  for (let i = board.pos.mvList.length; i < selMoveList.options.length; i++) {
    board.pos.makeMove(parseInt(selMoveList.options[i].value));
  }
  board.retract();
  selMoveList.options.length = board.pos.mvList.length;
  selMoveList.selectedIndex = selMoveList.options.length - 1;
}

function moveList_change() {
  if (board.result === RESULT_UNKNOWN) {
    selMoveList.selectedIndex = selMoveList.options.length - 1;
    return;
  }
  const from = board.pos.mvList.length;
  const to = selMoveList.selectedIndex;
  if (from === to + 1) return;
  if (from > to + 1) {
    for (let i = to + 1; i < from; i++) board.pos.undoMakeMove();
  } else {
    for (let i = from; i <= to; i++) {
      board.pos.makeMove(parseInt(selMoveList.options[i].value));
    }
  }
  board.flushBoard();
}

// 暴露到 window 供 onclick 调用
window.level_change = level_change;
window.restart_click = restart_click;
window.retract_click = retract_click;
window.moveList_change = moveList_change;

clearInfoText();
