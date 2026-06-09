/*
 * Pikafish Chinese Chess Engine - Position Evaluation (HCE)
 * Converted from Stockfish/Pikafish C++ evaluate.cpp
 */

import {
  SQUARE_NB, FILE_NB, RANK_NB,
  WHITE, BLACK, COLOR_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  PIECE_NB, PIECE_TYPE_NB,
  PieceValue, MG, EG, PHASE_NB,
  VALUE_ZERO, VALUE_DRAW, VALUE_KNOWN_WIN, VALUE_MATE,
  makeScore, mgValue, egValue, SCORE_ZERO,
  colorOf, typeOf, fileOf, rankOf, makeSquare,
  relativeRankOf, relativeRank, pawnPush,
  SQ_A0, SQ_I9, SQ_NONE,
} from './pikafish_types.js';

import {
  bbSet, bbClr, bbTest, bbEmpty, popcount, lsb,
  SquareBB, FileBB, RankBB,
  attacksByPieceType,
  rookAttacks, cannonAttacks, knightAttacks,
  bishopAttacks, advisorAttacks, kingAttacks, pawnAttacks,
  flyingGeneralCheck,
  inPalace, ownHalf,
  PseudoAttacks,
} from './pikafish_bitboard.js';

// Piece-Square Tables for Chinese Chess
// These tables give bonus/penalty for piece positions
// [PIECE][SQUARE] = Score(mg, eg)

// PSQT tables initialized from Pikafish defaults
const PSQT = [];

function initPSQT() {
  for (let pc = 0; pc < PIECE_NB; pc++) {
    PSQT[pc] = new Int32Array(SQUARE_NB);
  }
}

initPSQT();

// Bonus for various positional features

// Pawn advancement bonus
const PawnProgBonus = [0, 0, 0, 0, 0, 10, 20, 30, 40, 50];

// Knight center control bonus (rank 2-5 higher)
function knightPositionScore(sq, c) {
  const r = relativeRankOf(c, sq);
  const f = fileOf(sq);
  // Center files (files 2-6) are better than edges
  const fileScore = [0, 2, 5, 7, 7, 5, 2, 0, 0];
  const rankScore = [0, 2, 5, 8, 10, 10, 8, 5, 3, 0];
  return makeScore(fileScore[f] * 3 + rankScore[r] * 4,
                   fileScore[f] * 2 + rankScore[r] * 3);
}

// Cannon position
function cannonPositionScore(sq, c) {
  const r = relativeRankOf(c, sq);
  const f = fileOf(sq);
  // Cannons are better on back ranks for defense, forward for attack
  const fileScore = [3, 5, 7, 7, 7, 5, 3, 2, 1];
  return makeScore(fileScore[f] * 2 + Math.max(0, (9 - r) - 2) * 3,
                   fileScore[f] + Math.max(0, (9 - r) - 2) * 2);
}

// Rook position
function rookPositionScore(sq, c) {
  const r = relativeRankOf(c, sq);
  const f = fileOf(sq);
  // Rooks are best on open files and forward ranks
  const fileScore = [5, 6, 8, 9, 9, 8, 6, 5, 4];
  return makeScore(fileScore[f] * 3 + r * 4,
                   fileScore[f] * 2 + r * 3);
}

// Bishop position (only own half: ranks 0-4 for relative)
function bishopPositionScore(sq, c) {
  const r = relativeRankOf(c, sq);
  // Better central
  const f = fileOf(sq);
  const m = Math.abs(f - 4);
  return makeScore((4 - m) * 4 + r * 2,
                   (4 - m) * 3 + r);
}

// Advisor position (in palace)
function advisorPositionScore(sq, c) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  // Center of palace is best (e-file for advisor)
  const d = Math.abs(f - 4);
  return makeScore((2 - d) * 5, (2 - d) * 3);
}

// King position (in palace)
function kingPositionScore(sq, c) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  // King is safest in corner of palace (file 3 or 5)
  const d = Math.abs(f - 4);
  return makeScore(d * 3, d * 2);
}

// Pawn position
function pawnPositionScore(sq, c) {
  const r = relativeRankOf(c, sq);
  const f = fileOf(sq);
  // Advanced pawns are valuable
  const advBonus = r >= 5 ? (r - 4) * 10 : 0;
  // Center pawns slightly better
  const centerBonus = (4 - Math.abs(f - 4)) * 3;
  return makeScore(advBonus + centerBonus,
                   advBonus * 2 + centerBonus);
}

/**
 * Initialize PSQT values
 */
export function initEvaluate() {
  for (let sq = 0; sq < SQUARE_NB; sq++) {
    for (let pc = W_ROOK; pc <= W_KING; pc++) {
      let score = 0;
      switch (pc) {
        case W_ROOK: score = rookPositionScore(sq, WHITE); break;
        case W_ADVISOR: score = advisorPositionScore(sq, WHITE); break;
        case W_CANNON: score = cannonPositionScore(sq, WHITE); break;
        case W_PAWN: score = pawnPositionScore(sq, WHITE); break;
        case W_KNIGHT: score = knightPositionScore(sq, WHITE); break;
        case W_BISHOP: score = bishopPositionScore(sq, WHITE); break;
        case W_KING: score = kingPositionScore(sq, WHITE); break;
      }
      PSQT[pc][sq] = score;
    }
    for (let pc = B_ROOK; pc <= B_KING; pc++) {
      const flippedSq = makeSquare(fileOf(sq), RANK_NB - 1 - rankOf(sq));
      let score = 0;
      switch (pc - 8) {
        case ROOK: score = rookPositionScore(sq, BLACK); break;
        case ADVISOR: score = advisorPositionScore(sq, BLACK); break;
        case CANNON: score = cannonPositionScore(sq, BLACK); break;
        case PAWN: score = pawnPositionScore(sq, BLACK); break;
        case KNIGHT: score = knightPositionScore(sq, BLACK); break;
        case BISHOP: score = bishopPositionScore(sq, BLACK); break;
        case KING: score = kingPositionScore(sq, BLACK); break;
      }
      PSQT[pc][sq] = score;
    }
  }
}

initEvaluate();

/**
 * Main evaluation function
 * Returns a score from White's perspective
 */
export function evaluate(pos) {
  const us = pos.sideToMove;
  const them = us ^ 1;

  // Check for checkmate/stalemate
  if (pos.inCheck()) {
    const moves = [];
    pos.generateLegalMoves(moves);
    if (moves.length === 0) {
      return us === WHITE ? -VALUE_MATE : VALUE_MATE;
    }
  } else {
    const moves = [];
    pos.generateLegalMoves(moves);
    if (moves.length === 0) {
      return VALUE_DRAW;
    }
  }

  // Draw detection
  if (pos.hasRepetition()) return VALUE_DRAW;

  let score = SCORE_ZERO;

  // Material evaluation
  score += evaluateMaterial(pos);

  // Positional evaluation (PSQT)
  score += evaluatePSQT(pos);

  // Piece-specific bonuses
  score += evaluatePieces(pos);

  // King safety
  score += evaluateKingSafety(pos);

  // Pawn structure
  score += evaluatePawns(pos);

  // Convert score to side-to-move perspective
  const mg = mgValue(score);
  const eg = egValue(score);

  // Tapered eval based on game phase (material remaining)
  const phase = computePhase(pos);
  const result = (mg * phase + eg * (128 - phase)) / 128;

  return us === WHITE ? result : -result;
}

/**
 * Compute game phase from remaining material
 */
function computePhase(pos) {
  let totalPhase = 0;

  // Each piece contributes to phase
  // Opening phase = 128, endgame phase = 0
  const phaseValues = [0, 4, 1, 3, 1, 3, 2, 0];

  for (let c = 0; c < COLOR_NB; c++) {
    for (let pt = 1; pt <= BISHOP; pt++) {
      totalPhase += pos.pieceCount[c][pt] * phaseValues[pt];
    }
  }

  return Math.min(128, Math.max(0, totalPhase));
}

/**
 * Material evaluation - sum of piece values
 */
function evaluateMaterial(pos) {
  let mgScore = 0, egScore = 0;

  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    for (let pt = 1; pt <= BISHOP; pt++) {
      mgScore += sign * pos.pieceCount[c][pt] * PieceValue[MG][makePiece(c, pt)];
      egScore += sign * pos.pieceCount[c][pt] * PieceValue[EG][makePiece(c, pt)];
    }
  }

  return makeScore(mgScore, egScore);
}

/**
 * PSQT evaluation
 */
function evaluatePSQT(pos) {
  let mgScore = 0, egScore = 0;

  for (let sq = 0; sq < SQUARE_NB; sq++) {
    const pc = pos.board[sq];
    if (pc === 0) continue;
    const c = colorOf(pc);
    const sign = c === WHITE ? 1 : -1;
    const psqt = PSQT[pc][sq];
    mgScore += sign * mgValue(psqt);
    egScore += sign * egValue(psqt);
  }

  return makeScore(mgScore, egScore);
}

/**
 * Piece-specific evaluation
 */
function evaluatePieces(pos) {
  let mgScore = 0, egScore = 0;

  // Evaluate rooks
  mgScore += evaluateRooks(pos);
  egScore += evaluateRooksEG(pos);

  // Evaluate cannons
  mgScore += evaluateCannons(pos);
  egScore += evaluateCannonsEG(pos);

  // Evaluate knights
  mgScore += evaluateKnights(pos);
  egScore += evaluateKnightsEG(pos);

  return makeScore(mgScore, egScore);
}

function evaluateRooks(pos) {
  let score = 0;
  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const rooks = pos.piecesByType(c, ROOK);
    let bbRef = { bb: rooks };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      const f = fileOf(sq);
      const r = rankOf(sq);

      // Bonus for rook on 7th/2nd rank (attacking)
      const relR = relativeRankOf(c, sq);
      if (relR >= 7) score += sign * 10;

      // Bonus for rook on open/semi-open file
      let fileBlocked = false;
      for (let rr = 0; rr < RANK_NB; rr++) {
        const testSq = makeSquare(f, rr);
        if (testSq !== sq) {
          const pc2 = pos.board[testSq];
          if (pc2 !== 0 && typeOf(pc2) === ROOK) continue;
          if (pc2 !== 0 && typeOf(pc2) === PAWN) {
            fileBlocked = true;
            break;
          }
        }
      }
      if (!fileBlocked) score += sign * 15;
    }
  }
  return score;
}

function evaluateRooksEG(pos) {
  let score = 0;
  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const rooks = pos.piecesByType(c, ROOK);
    let bbRef = { bb: rooks };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      const relR = relativeRankOf(c, sq);
      score += sign * relR * 5; // Forward rooks in endgame
    }
  }
  return score;
}

function evaluateCannons(pos) {
  let score = 0;

  // Cannon prefers having a "mount" (piece to jump over)
  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const cannons = pos.piecesByType(c, CANNON);
    let bbRef = { bb: cannons };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      // Count potential mounts in each direction
      let mounts = 0;
      for (const d of [9, -9, 1, -1]) {
        let found = false;
        for (let s = sq + d; s >= 0 && s < SQUARE_NB; s += d) {
          if (d === 1 || d === -1) {
            if (fileOf(s) === 0 || fileOf(s) === 8) break;
          }
          if (pos.board[s] !== 0) { found = true; break; }
        }
        if (found) mounts++;
      }
      score += sign * mounts * 3;
    }
  }
  return score;
}

function evaluateCannonsEG(pos) {
  let score = 0;
  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const cannons = pos.piecesByType(c, CANNON);
    let bbRef = { bb: cannons };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      const relR = relativeRankOf(c, sq);
      score += sign * relR * 3;
    }
  }
  return score;
}

function evaluateKnights(pos) {
  let score = 0;
  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const knights = pos.piecesByType(c, KNIGHT);
    let bbRef = { bb: knights };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      // Knight mobility: count safe destination squares
      const att = attacksByPieceType(KNIGHT, sq, c, pos.occupied);
      const mobility = popcount(att & ~pos.pieces(c));
      score += sign * mobility * 3;
    }
  }
  return score;
}

function evaluateKnightsEG(pos) {
  return 0; // Mobility already handled
}

/**
 * King safety
 */
function evaluateKingSafety(pos) {
  let score = 0;

  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const kingSq = pos.kingSquare(c);
    if (kingSq === SQ_NONE) continue;

    const f = fileOf(kingSq);

    // King should be centered in palace
    const centerDist = Math.abs(f - 4);
    score -= sign * centerDist * 5;

    // King safety: count defenders near king
    let defenders = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const sq = makeSquare(f + df, rankOf(kingSq) + dr);
        if (sq >= 0 && sq < SQUARE_NB && fileOf(sq) >= 0 && fileOf(sq) < FILE_NB) {
          const pc = pos.board[sq];
          if (pc !== 0 && colorOf(pc) === c) {
            const pt = typeOf(pc);
            if (pt === ADVISOR || pt === BISHOP) defenders++;
          }
        }
      }
    }
    score += sign * defenders * 8;
  }

  return makeScore(score, score / 2);
}

/**
 * Pawn structure evaluation
 */
function evaluatePawns(pos) {
  let score = 0;

  for (let c = 0; c < COLOR_NB; c++) {
    const sign = c === WHITE ? 1 : -1;
    const pawns = pos.piecesByType(c, PAWN);
    let bbRef = { bb: pawns };
    let sq;
    while ((sq = pos.popLsbBB(bbRef)) !== SQ_NONE) {
      const r = rankOf(sq);
      const relR = relativeRankOf(c, sq);

      // Passed pawn bonus (advanced)
      if (relR >= 5) {
        score += sign * (relR - 4) * 15;
      }

      // Connected pawns bonus
      const left = sq - 1;
      const right = sq + 1;
      if ((isOkSquare(left) && pos.board[left] !== 0 &&
           colorOf(pos.board[left]) === c && typeOf(pos.board[left]) === PAWN) ||
          (isOkSquare(right) && pos.board[right] !== 0 &&
           colorOf(pos.board[right]) === c && typeOf(pos.board[right]) === PAWN)) {
        score += sign * 5;
      }
    }
  }

  return makeScore(score, score * 2);
}

export { PSQT };