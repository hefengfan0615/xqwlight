/*
 * worker.js - Search Worker
 *
 * Runs the engine search in a Web Worker so the UI thread stays responsive.
 * Communicates with the main thread via postMessage:
 *
 *   IN:  { type: "search", fen: ..., maxDepth: ..., maxTimeMs: ..., history: [...] }
 *   IN:  { type: "stop" }
 *
 *   OUT: { type: "info", depth, score, pv, nodes, nps, time }
 *   OUT: { type: "best",  mv, pv, score }
 *   OUT: { type: "error", message }
 */

"use strict";

importScripts("position.js", "search.js");

var runningSearch = null;
var history = [];

self.onmessage = function(e) {
  var msg = e.data;
  if (msg.type === "search") {
    if (runningSearch) {
      runningSearch.stopped = true;
    }
    history = msg.history || [];
    var pos = new Position();
    pos.fromFen(msg.fen);
    // replay history
    for (var i = 0; i < history.length; i++) {
      pos.makeMove(history[i]);
    }
    runningSearch = new Search(pos, 20);
    runningSearch.infoCallback = function(info) {
      self.postMessage({
        type: "info",
        depth: info.depth,
        score: info.score,
        scoreStr: info.scoreStr,
        pv: info.pv,
        nodes: info.nodes,
        nps: info.nps,
        time: info.time
      });
    };
    runningSearch.onComplete = function(mv, pv, vl) {
      self.postMessage({ type: "best", mv: mv, pv: pv, score: vl });
      runningSearch = null;
    };
    try {
      runningSearch.searchMain(msg.maxDepth || 16, msg.maxTimeMs || 8000);
    } catch (err) {
      self.postMessage({ type: "error", message: err.message || String(err) });
      runningSearch = null;
    }
  } else if (msg.type === "stop") {
    if (runningSearch) {
      runningSearch.stopped = true;
    }
  }
};
