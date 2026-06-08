"use strict";

const T = require('./types.js');
const B = require('./bitboard.js');
const PSQT = require('./psqt.js');

// Global flag for full evaluation
let FullEvaluation = true;

// ==============================================
// Material table entry (simplified)
// ==============================================
class MaterialEntry {
  constructor() {
    this.gamePhase = 128; // Midgame by default
    this.imbalanceScore = 0;
  }
  
  game_phase() {
    return this.gamePhase;
  }
  
  imbalance() {
    return this.imbalanceScore;
  }
  
  specialized_eval_exists() {
    return false;
  }
  
  evaluate() {
    return 0;
  }
}

// ==============================================
// Evaluation module
// ==============================================
function evaluate(pos) {
  // Simple PSQT-based evaluation
  let score = 0;
  
  // Calculate PSQT score
  let psqScore = 0;
  for (let sq = 0; sq < T.SQUARE_NB; sq++) {
    const pc = pos.piece_on(sq);
    if (pc !== T.NO_PIECE) {
      psqScore += PSQT.psq_score(pc, sq);
    }
  }
  
  score += psqScore;
  
  // Calculate game phase (simplified)
  let gamePhase = 128;
  
  // Scale between midgame and endgame
  const mgScore = T.mg_value(score);
  const egScore = T.eg_value(score);
  
  let result = (mgScore * gamePhase + egScore * (128 - gamePhase)) / 128;
  
  // From side to move perspective
  result = pos.side_to_move() === T.WHITE ? result : -result;
  
  // Clamp to avoid mate values
  result = Math.max(T.VALUE_MATED_IN_MAX_PLY + 1, Math.min(result, T.VALUE_MATE_IN_MAX_PLY - 1));
  
  return Math.floor(result);
}

// ==============================================
// Material probe (simplified)
// ==============================================
function probe(pos) {
  return new MaterialEntry();
}

module.exports = {
  evaluate,
  probe
};
