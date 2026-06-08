"use strict";

const T = require('./types.js');
const Evaluate = require('./evaluate.js');

// ==============================================
// Search limits
// ==============================================
class SearchLimits {
  constructor() {
    this.time = Infinity;
    this.nodes = Infinity;
    this.depth = 64;
  }
}

// ==============================================
// Transposition table entry
// ==============================================
class TTEntry {
  constructor() {
    this.key = '';
    this.depth = 0;
    this.value = 0;
    this.bound = T.BOUND_NONE;
    this.move = T.MOVE_NONE;
  }
}

// ==============================================
// Search stack
// ==============================================
class SearchStack {
  constructor() {
    this.ply = 0;
    this.currentMove = T.MOVE_NONE;
    this.excludedMove = T.MOVE_NONE;
  }
}

// ==============================================
// Search module
// ==============================================
let nodes = 0;

// Simple alpha-beta search
function search(pos, depth, alpha, beta, stack) {
  nodes++;
  
  // Check for terminal nodes
  if (depth <= 0 || pos.in_check()) {
    return quiesce(pos, alpha, beta);
  }
  
  // Generate legal moves
  const moves = pos.generate_moves();
  
  if (moves.length === 0) {
    if (pos.in_check()) {
      return T.mated_in(stack.ply);
    } else {
      return 0; // Draw
    }
  }
  
  let bestValue = -T.VALUE_INFINITE;
  let bestMove = T.MOVE_NONE;
  
  for (const m of moves) {
    pos.do_move(m);
    stack.ply++;
    
    const value = -search(pos, depth - 1, -beta, -alpha, stack);
    
    pos.undo_move(m);
    stack.ply--;
    
    if (value > bestValue) {
      bestValue = value;
      bestMove = m;
    }
    
    if (value > alpha) {
      alpha = value;
    }
    
    if (alpha >= beta) {
      break;
    }
  }
  
  return bestValue;
}

// Quiescence search
function quiesce(pos, alpha, beta) {
  nodes++;
  
  const standPat = Evaluate.evaluate(pos);
  
  if (standPat >= beta) {
    return beta;
  }
  
  if (standPat > alpha) {
    alpha = standPat;
  }
  
  // Generate tactical moves (captures, checks)
  const allMoves = pos.generate_moves();
  
  for (const m of allMoves) {
    // Only consider captures for quiescence
    const to = T.to_sq(m);
    if (pos.piece_on(to) === T.NO_PIECE) {
      continue;
    }
    
    pos.do_move(m);
    
    const value = -quiesce(pos, -beta, -alpha);
    
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

// Main search function
function think(pos, limits = new SearchLimits()) {
  nodes = 0;
  let bestMove = T.MOVE_NONE;
  let bestValue = -T.VALUE_INFINITE;
  
  const stack = new SearchStack();
  
  const moves = pos.generate_moves();
  
  if (moves.length === 0) {
    return { move: T.MOVE_NONE, value: pos.in_check() ? T.mated_in(0) : 0 };
  }
  
  // Iterative deepening (simplified - just single depth)
  const depth = Math.min(limits.depth, 8);
  
  for (const m of moves) {
    pos.do_move(m);
    stack.ply++;
    
    const value = -search(pos, depth - 1, -T.VALUE_INFINITE, T.VALUE_INFINITE, stack);
    
    pos.undo_move(m);
    stack.ply--;
    
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

module.exports = {
  think,
  SearchLimits
};
