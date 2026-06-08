"use strict";

const T = require('./types.js');
const { Position, StateInfo } = require('./position.js');
const Evaluate = require('./evaluate.js');

// ==============================================
// Search module - complete alpha-beta search
// ==============================================

let nodes = 0;

// Quiescence search - only search tactical moves
function quiesce(pos, alpha, beta, depth, ply) {
  nodes++;
  
  if (ply > 20) { // Limit recursion depth
    return Evaluate.evaluate(pos);
  }
  
  const standPat = Evaluate.evaluate(pos);
  
  if (standPat >= beta) {
    return beta;
  }
  
  if (standPat > alpha) {
    alpha = standPat;
  }
  
  // Generate tactical moves (captures)
  const allMoves = pos.generate_moves();
  
  for (const m of allMoves) {
    // Only consider captures for quiescence
    if (pos.empty(T.to_sq(m))) {
      continue;
    }
    
    const st = new StateInfo();
    pos.do_move(m, st);
    
    const value = -quiesce(pos, -beta, -alpha, depth + 1, ply + 1);
    
    pos.undo_move(m);
    
    if (value >= beta) {
      return beta;
    }
    
    if (value > alpha) {
      alpha = value;
    }
  }
  
  return alpha;
}

// Main alpha-beta search
function search(pos, depth, alpha, beta) {
  nodes++;
  
  // Check for terminal nodes
  if (depth <= 0) {
    return Evaluate.evaluate(pos); // Skip quiesce for now
  }
  
  // Generate legal moves
  const moves = pos.generate_moves();
  
  if (moves.length === 0) {
    if (pos.in_check()) {
      return -T.VALUE_MATE + nodes; // Simplified mate score
    } else {
      return 0; // Draw/stalemate
    }
  }
  
  let bestValue = -T.VALUE_INFINITE;
  
  for (const m of moves) {
    const st = new StateInfo();
    pos.do_move(m, st);
    
    const value = -search(pos, depth - 1, -beta, -alpha);
    
    pos.undo_move(m);
    
    if (value > bestValue) {
      bestValue = value;
    }
    
    if (value > alpha) {
      alpha = value;
    }
    
    if (alpha >= beta) {
      break; // Beta cutoff
    }
  }
  
  return bestValue;
}

// Main search function - finds best move
function think(pos, depth) {
  nodes = 0;
  let bestMove = T.MOVE_NONE;
  let bestValue = -T.VALUE_INFINITE;
  
  const moves = pos.generate_moves();
  
  if (moves.length === 0) {
    return { 
      move: T.MOVE_NONE, 
      value: pos.in_check() ? -T.VALUE_MATE : 0,
      nodes: 0 
    };
  }
  
  // Search at given depth
  const searchDepth = Math.min(depth, 4); // Limit to avoid too long searches
  
  for (const m of moves) {
    const st = new StateInfo();
    pos.do_move(m, st);
    
    const value = -search(pos, searchDepth - 1, -T.VALUE_INFINITE, T.VALUE_INFINITE);
    
    pos.undo_move(m);
    
    if (value > bestValue) {
      bestValue = value;
      bestMove = m;
    }
  }
  
  return {
    move: bestMove,
    value: bestValue,
    nodes: nodes
  };
}

// Search limits class
class SearchLimits {
  constructor() {
    this.time = Infinity;
    this.nodes = Infinity;
    this.depth = 64;
  }
}

module.exports = {
  think,
  SearchLimits
};
