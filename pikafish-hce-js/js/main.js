/* main.js - Game controller (uses Web Worker for search) */

"use strict";

var STARTUP_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

var pos = new Position();
pos.fromFen(STARTUP_FEN);
var mvHistory = [];
var aiThinking = false;
var selDepth = 16;
var selTime = 6;
var worker = null;
var currentPv = [];

var boardEl = document.getElementById("boardContainer");
var board = new Board(boardEl, "");
board.setPosition(pos);
board.onSelect = onUserMove;

var statusText = document.getElementById("statusText");
var statusPill = document.getElementById("statusPill");
var siDepth = document.getElementById("siDepth");
var siScore = document.getElementById("siScore");
var siNodes = document.getElementById("siNodes");
var siNps   = document.getElementById("siNps");
var siTime  = document.getElementById("siTime");
var siPV    = document.getElementById("siPV");
var moveListEl = document.getElementById("moveList");
var movesCount = document.getElementById("movesCount");
var turnInfo   = document.getElementById("turnInfo");
var selSideEl  = document.getElementById("selSide");
var selDepthEl = document.getElementById("selDepth");
var selTimeEl  = document.getElementById("selTime");
var btnNew     = document.getElementById("btnNew");
var btnUndo    = document.getElementById("btnUndo");
var btnHint    = document.getElementById("btnHint");
var btnStop    = document.getElementById("btnStop");
var selSideMode = "0"; // 0=player red, 1=player black, 2=human-human, 3=engine-engine
var stoppedByUser = false;

function setStatus(s, color) {
  statusText.textContent = s;
  if (color) statusPill.style.background = color;
}

function fmtScore(vl) {
  if (vl >  WIN_VALUE) return "将杀 (" + (MATE_VALUE - vl) + ")";
  if (vl < -WIN_VALUE) return "被将杀 (" + (MATE_VALUE + vl) + ")";
  var s = (vl / 100).toFixed(2);
  return (vl > 0 ? "+" : "") + s;
}

function moveToChinese(mv, pos) {
  if (!mv) return "";
  var sd = 1 - pos.sdPlayer;
  var sqSrc = SRC(mv), sqDst = DST(mv);
  pos.undoMakeMove();
  var pc = pos.squares[sqSrc];
  pos.makeMove(mv);
  var pt = pc & 7;
  var redNames = ["帅", "仕", "相", "马", "车", "炮", "兵"];
  var blkNames = ["将", "士", "象", "马", "车", "炮", "卒"];
  var name = (sd === 0) ? redNames[pt] : blkNames[pt];
  var fx = FILE_X(sqSrc) - 3, fy = RANK_Y(sqSrc);
  var tx = FILE_X(sqDst) - 3, ty = RANK_Y(sqDst);
  var toRank   = (sd === 0) ? (9 - ty) : (ty + 1);
  var fromFile = (8 - fx);
  var toFile   = (8 - tx);
  var CHN_DIGIT = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (fx === tx) {
    if ((sd === 0 && ty < fy) || (sd === 1 && ty > fy))
      return name + CHN_DIGIT[fromFile] + "进" + CHN_DIGIT[toRank];
    return name + CHN_DIGIT[fromFile] + "退" + CHN_DIGIT[toRank];
  } else {
    return name + CHN_DIGIT[fromFile] + "平" + CHN_DIGIT[toFile];
  }
}

function updateMoveList() {
  moveListEl.innerHTML = "";
  var tmpPos = new Position();
  tmpPos.fromFen(STARTUP_FEN);
  for (var i = 0; i < mvHistory.length; i++) {
    var mv = mvHistory[i];
    var line = document.createElement("div");
    line.className = "ml-row";
    if (i % 2 === 0) {
      var num = (i / 2) + 1;
      var numEl = document.createElement("span");
      numEl.className = "ml-num";
      numEl.textContent = num + ".";
      line.appendChild(numEl);
    }
    var mvEl = document.createElement("span");
    mvEl.className = "ml-mv";
    mvEl.textContent = moveToChinese(mv, tmpPos);
    line.appendChild(mvEl);
    moveListEl.appendChild(line);
    tmpPos.makeMove(mv);
  }
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function updateInfo() {
  movesCount.textContent = mvHistory.length;
  turnInfo.textContent = (pos.sdPlayer === 0) ? "红方" : "黑方";
}

function onUserMove(mv) {
  if (aiThinking) return;
  if (selSideMode === "3") return;
  if (selSideMode === "0" && pos.sdPlayer !== 0) return;
  if (selSideMode === "1" && pos.sdPlayer !== 1) return;
  if (!pos.makeMove(mv)) return;
  mvHistory.push(mv);
  board.refresh();
  updateMoveList();
  updateInfo();
  if (pos.isMate()) { setStatus("将杀！", "linear-gradient(135deg,#1a8f3a,#29c264)"); return; }
  if (selSideMode === "2") {
    setStatus("轮到对方", "linear-gradient(135deg,#0e3a6e,#1a6fc8)");
    return;
  }
  runEngine();
}

function startWorker() {
  if (worker) { try { worker.terminate(); } catch (e){} worker = null; }
  worker = new Worker("js/worker.js");
  worker.onmessage = function(e) {
    var msg = e.data;
    if (msg.type === "info") {
      siDepth.textContent = msg.depth;
      siScore.textContent = fmtScore(msg.score);
      siNodes.textContent = msg.nodes.toLocaleString();
      siNps.textContent   = (msg.nps / 1000).toFixed(1) + " k";
      siTime.textContent  = (msg.time / 1000).toFixed(2) + " s";
      currentPv = msg.pv;
      var pvStr = msg.pv.map(function(m){ return moveToChinese(m, pos); }).join(" ");
      siPV.textContent = pvStr;
      if (msg.depth === 1) { setStatus("引擎思考中… (深度 " + msg.depth + ")", "linear-gradient(135deg,#8a2a2a,#c83838)"); }
      else { setStatus("引擎思考中… (深度 " + msg.depth + ")", "linear-gradient(135deg,#8a2a2a,#c83838)"); }
    } else if (msg.type === "best") {
      aiThinking = false;
      btnStop.style.display = "none";
      var bestMv = msg.mv;
      if (bestMv > 0 && pos.makeMove(bestMv)) {
        mvHistory.push(bestMv);
        board.setLastMove(bestMv);
        board.refresh();
        updateMoveList();
        updateInfo();
        if (pos.isMate()) {
          setStatus("将杀！", "linear-gradient(135deg,#1a8f3a,#29c264)");
          return;
        }
        setStatus("轮到玩家", "linear-gradient(135deg,#0e3a6e,#1a6fc8)");
        if (selSideMode === "3") {
          // engine vs engine: keep going
          setTimeout(runEngine, 300);
        }
      } else {
        setStatus("引擎未找到走法", "linear-gradient(135deg,#444,#666)");
      }
    } else if (msg.type === "error") {
      aiThinking = false;
      btnStop.style.display = "none";
      setStatus("错误: " + msg.message, "linear-gradient(135deg,#8a2a2a,#c83838)");
    }
  };
  worker.onerror = function(err) {
    aiThinking = false;
    btnStop.style.display = "none";
    setStatus("Worker 错误: " + err.message, "linear-gradient(135deg,#8a2a2a,#c83838)");
  };
}

function runEngine() {
  if (pos.isMate()) { setStatus("将杀！", "linear-gradient(135deg,#1a8f3a,#29c264)"); return; }
  aiThinking = true;
  stoppedByUser = false;
  btnStop.style.display = "";
  setStatus("引擎思考中…", "linear-gradient(135deg,#8a2a2a,#c83838)");
  siDepth.textContent = "-"; siScore.textContent = "-"; siNodes.textContent = "-";
  siNps.textContent = "-"; siTime.textContent = "-"; siPV.textContent = "-";
  startWorker();
  worker.postMessage({
    type: "search",
    fen: pos.toFen(),
    maxDepth: parseInt(selDepthEl.value, 10),
    maxTimeMs: parseInt(selTimeEl.value, 10) * 1000,
    history: mvHistory
  });
}

function stopEngine() {
  if (worker) {
    worker.postMessage({ type: "stop" });
  }
  stoppedByUser = true;
  aiThinking = false;
  btnStop.style.display = "none";
  setStatus("已停止", "linear-gradient(135deg,#444,#666)");
}

function hintMove() {
  if (aiThinking) return;
  // Briefly run the engine but don't apply the move
  aiThinking = true;
  btnStop.style.display = "";
  setStatus("计算提示…", "linear-gradient(135deg,#8a2a2a,#c83838)");
  startWorker();
  worker.addEventListener("message", function onceListener(e) {
    if (e.data.type === "best") {
      worker.removeEventListener("message", onceListener);
      aiThinking = false;
      btnStop.style.display = "none";
      var bestMv = e.data.mv;
      if (bestMv > 0) {
        var p = moveToChinese(bestMv, pos);
        setStatus("建议: " + p, "linear-gradient(135deg,#1a4d8a,#2978c8)");
        board.sqSelected = SRC(bestMv);
        board.movelist = [bestMv];
        board.refresh();
        setTimeout(function(){ board.sqSelected = -1; board.movelist = []; board.refresh(); }, 2500);
      } else {
        setStatus("无合法走法", "linear-gradient(135deg,#444,#666)");
      }
    }
  });
  worker.postMessage({
    type: "search",
    fen: pos.toFen(),
    maxDepth: parseInt(selDepthEl.value, 10),
    maxTimeMs: Math.max(2000, parseInt(selTimeEl.value, 10) * 500),
    history: mvHistory
  });
}

function newGame() {
  if (worker) { worker.postMessage({ type: "stop" }); }
  aiThinking = false;
  btnStop.style.display = "none";
  pos = new Position();
  pos.fromFen(STARTUP_FEN);
  mvHistory = [];
  board.setPosition(pos);
  board.setLastMove(0);
  board.sqSelected = -1; board.movelist = [];
  updateMoveList();
  updateInfo();
  siDepth.textContent = "-"; siScore.textContent = "-"; siNodes.textContent = "-";
  siNps.textContent = "-"; siTime.textContent = "-"; siPV.textContent = "-";
  setStatus("新对局开始", "linear-gradient(135deg,#0e3a6e,#1a6fc8)");
  selSideMode = selSideEl.value;
  if (selSideMode === "1" || selSideMode === "3") {
    setTimeout(runEngine, 200);
  }
}

function undoMove() {
  if (aiThinking) return;
  if (mvHistory.length === 0) return;
  if (selSideMode === "0" || selSideMode === "1") {
    // Undo the last move plus the engine's reply (if any)
    while (mvHistory.length > 0 && pos.sdPlayer === 1) {
      var mv = mvHistory.pop();
      pos.undoMakeMove();
    }
    while (mvHistory.length > 0 && pos.sdPlayer === 1) {
      var mv2 = mvHistory.pop();
      pos.undoMakeMove();
    }
  } else if (selSideMode === "2") {
    var mv3 = mvHistory.pop();
    pos.undoMakeMove();
  }
  board.setLastMove(mvHistory.length > 0 ? mvHistory[mvHistory.length - 1] : 0);
  board.setPosition(pos);
  board.sqSelected = -1; board.movelist = [];
  updateMoveList();
  updateInfo();
}

btnNew.addEventListener("click", newGame);
btnUndo.addEventListener("click", undoMove);
btnHint.addEventListener("click", hintMove);
btnStop.addEventListener("click", stopEngine);
selSideEl.addEventListener("change", newGame);

updateInfo();
updateMoveList();
setStatus("新对局开始", "linear-gradient(135deg,#0e3a6e,#1a6fc8)");
