"use strict";

// ============================================================
// Pikafish JS - PSQT (Piece-Square Tables) and Evaluation
// Implements the HCE (Hand-Crafted Evaluation) from Pikafish
// ============================================================

const T = require('./types');
const BB = require('./bitboard');
const MoveGen = require('./movegen');

// Score helpers: combine MG and EG into a single number
// We store as {mg, eg} for clarity, then convert
function makeScore(mg, eg) { return mg + (eg << 16); }
function mgValue(score) { return score & 0xFFFF; }
function egValue(score) { return score >> 16; }

// Piece-Square tables from Pikafish
// Scores are mirrored for files F-I based on A-E
// Format: Bonus[pieceType][rank][file] (files A-E)

const S = makeScore;

// Rook PSQT
const rookBonus = [
  [S(-203,-131), S(46,-225), S(-147,-86), S(-17,5), S(8,-13)],
  [S(-203,-52), S(58,-67), S(-89,-110), S(-78,121), S(-106,106)],
  [S(-138,-61), S(7,-96), S(-65,-9), S(-110,7), S(-8,45)],
  [S(-60,77), S(-48,-33), S(-58,61), S(88,54), S(175,-4)],
  [S(-61,32), S(42,-7), S(-112,34), S(181,13), S(-170,14)],
  [S(-69,-12), S(192,24), S(88,-76), S(53,-74), S(110,86)],
  [S(-199,103), S(-8,-85), S(179,-39), S(48,23), S(12,79)],
  [S(139,130), S(20,-149), S(95,113), S(92,101), S(-20,-69)],
  [S(-72,-15), S(163,-21), S(124,-79), S(32,46), S(-78,-100)],
  [S(109,-97), S(66,-29), S(-86,-4), S(39,55), S(22,54)]
];

// Advisor PSQT
const advisorBonus = [
  [S(0,0), S(0,0), S(0,0), S(41,33), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(38,113)],
  [S(0,0), S(0,0), S(0,0), S(-152,47), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)]
];

// Cannon PSQT
const cannonBonus = [
  [S(-4,15), S(-42,-59), S(-44,-53), S(61,124), S(4,34)],
  [S(38,6), S(141,-34), S(-63,22), S(-1,37), S(113,41)],
  [S(21,-24), S(72,-11), S(58,82), S(104,60), S(212,42)],
  [S(35,106), S(-194,-36), S(112,97), S(102,-151), S(-2,-43)],
  [S(-40,-30), S(-56,78), S(-82,32), S(-113,136), S(246,6)],
  [S(-66,13), S(66,-102), S(2,40), S(-7,34), S(79,112)],
  [S(51,-196), S(100,-46), S(20,-34), S(1,52), S(48,163)],
  [S(149,-165), S(-13,84), S(-2,9), S(67,-107), S(180,58)],
  [S(-48,100), S(55,-17), S(-2,16), S(-42,-91), S(88,51)],
  [S(135,-53), S(225,-12), S(-15,26), S(189,144), S(13,12)]
];

// Pawn PSQT
const pawnBonus = [
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(-27,-19), S(0,0), S(-19,-27), S(0,0), S(56,34)],
  [S(-12,-18), S(0,0), S(41,-2), S(0,0), S(39,61)],
  [S(-28,70), S(-53,93), S(138,46), S(26,197), S(73,52)],
  [S(-74,69), S(-145,80), S(53,161), S(2,210), S(-65,22)],
  [S(91,-92), S(-120,104), S(18,41), S(19,46), S(-121,-67)],
  [S(-181,-148), S(50,56), S(182,34), S(11,41), S(62,17)],
  [S(116,-57), S(85,-85), S(-84,3), S(35,-33), S(19,-119)]
];

// Knight PSQT
const knightBonus = [
  [S(-25,-48), S(-180,-201), S(-30,-32), S(-112,-133), S(-99,56)],
  [S(-126,-95), S(-93,59), S(-142,-26), S(-37,-82), S(-64,-136)],
  [S(-82,-88), S(43,-51), S(-35,-109), S(11,54), S(-4,-16)],
  [S(25,7), S(-86,-111), S(82,-30), S(172,-90), S(-36,101)],
  [S(-154,35), S(-58,68), S(5,89), S(26,-50), S(103,56)],
  [S(117,-34), S(70,66), S(43,-50), S(151,74), S(-53,110)],
  [S(-62,-72), S(62,47), S(170,63), S(26,34), S(-74,-2)],
  [S(122,-69), S(-69,-134), S(4,25), S(78,151), S(1,198)],
  [S(-107,-19), S(-69,-57), S(-11,100), S(-64,-74), S(187,125)],
  [S(-53,20), S(12,139), S(30,-12), S(-139,-79), S(-65,25)]
];

// Bishop PSQT
const bishopBonus = [
  [S(0,0), S(0,0), S(111,129), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(18,105), S(0,0), S(0,0), S(0,0), S(206,148)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(-4,102), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)]
];

// King PSQT
const kingBonus = [
  [S(0,0), S(0,0), S(0,0), S(-74,42), S(63,65)],
  [S(0,0), S(0,0), S(0,0), S(-221,-16), S(-71,63)],
  [S(0,0), S(0,0), S(0,0), S(1,-167), S(-36,-59)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)],
  [S(0,0), S(0,0), S(0,0), S(0,0), S(0,0)]
];

const allBonus = [null, rookBonus, advisorBonus, cannonBonus, pawnBonus, knightBonus, bishopBonus, kingBonus];

// Get file index for PSQT lookup (mirrored: F->E, G->D, H->C, I->B)
function psqFile(f) {
  if (f > T.FILE_E) return T.FILE_I - f;
  return f;
}

// Get PSQT score for a piece on a square
function psqScore(pc, sq) {
  const pt = T.type_of_piece(pc);
  const color = T.color_of(pc);
  let r = T.rank_of(sq);
  let f = psqFile(T.file_of(sq));

  if (color === T.BLACK) {
    r = T.RANK_9 - r;
  }

  const bonus = allBonus[pt][r][f];
  const pieceValue = T.PieceValue[0][pt] + (T.PieceValue[1][pt] << 16);
  return (color === T.WHITE ? 1 : -1) * (pieceValue + bonus);
}

// Tactical pattern scores
const HollowCannon = S(85, 91);
const CentralKnight = S(50, 53);
const BottomCannon = S(18, 8);
const AdvisorBishopPair = S(24, -43);

// Mobility bonus tables
const mobilityBonus = {
  [T.ROOK]: [S(-26, -30), S(4, -28), S(-11, -21), S(1, -30), S(-10, -51), S(10, -37),
             S(20, -25), S(25, -36), S(35, -33), S(35, -50), S(58, -41), S(66, -9),
             S(84, -30), S(90, -12), S(110, -35), S(90, -12), S(114, -34), S(16, -43)],
  [T.ADVISOR]: [S(16, -43), S(44, 7), S(46, 3), S(58, 19), S(91, 2)],
  [T.CANNON]: [S(6, 16), S(-3, 14), S(17, 17), S(8, 44), S(1, 30), S(10, 30), S(6, 35),
               S(-18, 31), S(-14, 30), S(-4, 21), S(-13, 51), S(5, 42), S(-14, 55),
               S(-9, 57), S(-21, 62), S(-4, 70), S(0, 67), S(-23, 66)],
  [T.KNIGHT]: [S(-5, -48), S(22, -23), S(40, -24), S(45, 10), S(53, 29), S(97, 32),
               S(85, 34), S(119, 64), S(136, 76)],
  [T.BISHOP]: [S(16, -28), S(9, -18), S(30, -9), S(71, 15), S(92, -13)]
};

// Crossed pawn penalties based on opponent advisor count
const crossedPawnTable = [
  [S(-56, -40), S(6, 24), S(11, 7), S(-29, 7), S(-9, -1), S(-4, -7)],
  [S(-68, -35), S(10, 12), S(9, 3), S(-16, 9), S(-14, 0), S(-36, -13)],
  [S(-79, 5), S(40, -8), S(32, 1), S(-22, 9), S(-20, -16), S(-40, -20)]
];

// Pieces on one side bonus
const piecesOnOneSide = [S(-3, 5), S(-13, 36), S(18, 26), S(9, 26), S(10, -4)];

// Rook on open file bonus
const rookOnOpenFile = [S(0, -8), S(14, 16)];

// Connected pawn bonus
const connectedPawn = S(5, -5);

// Trapped knight penalty
const trappedKnight = S(-5, -2);

// Evaluate the position from the perspective of side to move
function evaluate(pos) {
  if (pos.checkers()) {
    // In check, return a simpler evaluation
    return evaluateSimple(pos);
  }

  let mg = [0, 0], eg = [0, 0]; // scores for white and black

  // Piece-square evaluation + mobility
  const attackedBy = [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]]; // simplified as bitboards
  const attackedBy2 = [0n, 0n];

  for (let color = T.WHITE; color <= T.BLACK; color++) {
    const us = color;
    const them = 1 - color;
    const kingSq = pos.kingSquare(us);

    // Initialize attackedBy for king
    const kingAtk = BB.kingAttacks[kingSq] || [];
    for (const sq of kingAtk) attackedBy[us][sq] = 1;

    // Iterate over all pieces
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc === T.NO_PIECE || T.color_of(pc) !== us) continue;
      const pt = T.type_of_piece(pc);

      // Get piece attacks and mobility
      let pieceAtk = [];
      switch (pt) {
        case T.ROOK: {
          // Simplified rook attacks
          const dirs = BB.lineDirs;
          for (const dir of dirs) {
            let s = sq;
            while (true) {
              const nf = T.file_of(s) + (dir === T.EAST ? 1 : dir === T.WEST ? -1 : 0);
              const nr = T.rank_of(s) + (dir === T.NORTH ? 1 : dir === T.SOUTH ? -1 : 0);
              if (nf < T.FILE_A || nf > T.FILE_I || nr < T.RANK_0 || nr > T.RANK_9) break;
              s = T.make_square(nf, nr);
              pieceAtk.push(s);
              if (pos.board[s] !== T.NO_PIECE) break;
            }
          }
          break;
        }
        case T.CANNON: {
          // Simplified cannon attacks
          const dirs = BB.lineDirs;
          for (const dir of dirs) {
            let s = sq;
            let screenFound = false;
            while (true) {
              const nf = T.file_of(s) + (dir === T.EAST ? 1 : dir === T.WEST ? -1 : 0);
              const nr = T.rank_of(s) + (dir === T.NORTH ? 1 : dir === T.SOUTH ? -1 : 0);
              if (nf < T.FILE_A || nf > T.FILE_I || nr < T.RANK_0 || nr > T.RANK_9) break;
              s = T.make_square(nf, nr);
              if (!screenFound) {
                if (pos.board[s] !== T.NO_PIECE) {
                  screenFound = true;
                } else {
                  pieceAtk.push(s);
                }
              } else {
                if (pos.board[s] !== T.NO_PIECE) {
                  pieceAtk.push(s);
                  break;
                }
              }
            }
          }
          break;
        }
        case T.KNIGHT:
          pieceAtk = BB.knightAttacks[sq].filter((to, i) => pos.board[BB.knightPins[sq][i]] === T.NO_PIECE);
          break;
        case T.BISHOP:
          pieceAtk = BB.bishopAttacks[sq].filter((to, i) => pos.board[BB.bishopPins[sq][i]] === T.NO_PIECE);
          break;
        case T.ADVISOR:
          pieceAtk = BB.advisorAttacks[sq];
          break;
        case T.KING:
          pieceAtk = BB.kingAttacks[sq];
          break;
        case T.PAWN: {
          const fwd = BB.pawnAttacksForward[sq];
          if (fwd >= 0) pieceAtk.push(fwd);
          const crossed = us === T.WHITE ? T.rank_of(sq) >= T.RANK_5 : T.rank_of(sq) <= T.RANK_4;
          if (crossed) {
            const caps = us === T.WHITE ? BB.pawnCapturesWhite[sq] : BB.pawnCapturesBlack[sq];
            pieceAtk.push(...caps);
          }
          break;
        }
      }

      // Update attacked by all pieces
      for (const s of pieceAtk) attackedBy[us][s] = 1;

      // Count mobility (squares not attacked by enemy pawns - simplified)
      const mob = pieceAtk.length;
      if (mobilityBonus[pt] && mob < mobilityBonus[pt].length) {
        const mb = mobilityBonus[pt][mob];
        mg[us] += mgValue(mb);
        eg[us] += egValue(mb);
      }

      // Piece-specific evaluation
      if (pt === T.CANNON) {
        const enemyKingSq = pos.kingSquare(them);
        if (T.file_of(sq) === T.FILE_E && (enemyKingSq === T.SQ_E0 || enemyKingSq === T.SQ_E9)) {
          const between = BB.betweenSquares(sq, enemyKingSq);
          const blockerCount = between.filter(s => pos.board[s] !== T.NO_PIECE).length;
          // Hollow cannon (空头炮)
          if (blockerCount === 0) {
            mg[us] += mgValue(HollowCannon);
            eg[us] += egValue(HollowCannon);
          }
          // Cannon pinning central knight
          if (blockerCount === 2) {
            for (const s of between) {
              if (pos.board[s] === (them === T.WHITE ? T.W_KNIGHT : T.B_KNIGHT)) {
                if (BB.kingAttacks[enemyKingSq].includes(s)) {
                  mg[us] += mgValue(CentralKnight);
                  eg[us] += egValue(CentralKnight);
                }
              }
            }
          }
        }
        // Bottom cannon (沉底炮)
        const enemyBottom = us === T.WHITE ? T.RANK_9 : T.RANK_0;
        if (T.rank_of(sq) === enemyBottom) {
          const between = BB.betweenSquares(sq, pos.kingSquare(them));
          const blockerCount = between.filter(s => pos.board[s] !== T.NO_PIECE).length;
          if (blockerCount === 0 && (pos.kingSquare(them) === T.SQ_E0 || pos.kingSquare(them) === T.SQ_E9)) {
            mg[us] += mgValue(BottomCannon);
            eg[us] += egValue(BottomCannon);
          }
        }
      }

      if (pt === T.ROOK) {
        // Rook on open file
        const fileOpen = true; // simplified
        if (fileOpen) {
          const rof = rookOnOpenFile[0]; // simplified
          mg[us] += mgValue(rof);
          eg[us] += egValue(rof);
        }
      }

      if (pt === T.KNIGHT) {
        // Trapped knight check
        const atEdge = T.file_of(sq) === T.FILE_A || T.file_of(sq) === T.FILE_I ||
                       T.rank_of(sq) === T.RANK_0 || T.rank_of(sq) === T.RANK_9;
        if (atEdge) {
          const around = [sq + T.NORTH, sq + T.SOUTH, sq + T.EAST, sq + T.WEST]
            .filter(s => T.is_ok_sq(s));
          const hasEnemyRook = around.some(s =>
            pos.board[s] === (them === T.WHITE ? T.W_ROOK : T.B_ROOK));
          const hasOwnRook = around.some(s =>
            pos.board[s] === (us === T.WHITE ? T.W_ROOK : T.B_ROOK));
          if (hasEnemyRook && hasOwnRook) {
            mg[us] += mgValue(trappedKnight);
            eg[us] += egValue(trappedKnight);
          }
        }
      }
    }
  }

  // Threat evaluation
  for (let us = T.WHITE; us <= T.BLACK; us++) {
    const them = 1 - us;
    // Advisor + Bishop pair
    const advisorCount = pos.piecesByType[T.ADVISOR];
    const bishopCount = pos.piecesByType[T.BISHOP];
    // Count per color
    let usAdvisors = 0, usBishops = 0;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc !== T.NO_PIECE && T.color_of(pc) === us) {
        if (T.type_of_piece(pc) === T.ADVISOR) usAdvisors++;
        if (T.type_of_piece(pc) === T.BISHOP) usBishops++;
      }
    }
    if (usAdvisors + usBishops === 4) {
      mg[us] += mgValue(AdvisorBishopPair);
      eg[us] += egValue(AdvisorBishopPair);
    }

    // Crossed pawns
    let crossedPawns = 0;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc === (us === T.WHITE ? T.W_PAWN : T.B_PAWN)) {
        const crossed = us === T.WHITE ? T.rank_of(sq) >= T.RANK_5 : T.rank_of(sq) <= T.RANK_4;
        if (crossed && T.rank_of(sq) !== (us === T.WHITE ? T.RANK_9 : T.RANK_0)) {
          crossedPawns++;
        }
      }
    }
    let themAdvisors = 0;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc === (them === T.WHITE ? T.W_ADVISOR : T.B_ADVISOR)) themAdvisors++;
    }
    if (crossedPawns < 6) {
      const cp = crossedPawnTable[Math.min(themAdvisors, 2)][crossedPawns];
      mg[us] += mgValue(cp);
      eg[us] += egValue(cp);
    }

    // Connected pawns
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc === (us === T.WHITE ? T.W_PAWN : T.B_PAWN)) {
        const eastSq = sq + T.EAST;
        if (T.is_ok_sq(eastSq)) {
          const eastPc = pos.board[eastSq];
          if (eastPc === pc) {
            mg[us] += mgValue(connectedPawn);
            eg[us] += egValue(connectedPawn);
          }
        }
      }
    }

    // Pieces on one side (simplified)
    const crossed = us === T.WHITE ?
      (s) => T.rank_of(s) >= T.RANK_5 : (s) => T.rank_of(s) <= T.RANK_4;
    let strongLeft = 0, strongRight = 0;
    for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
      const pc = pos.board[sq];
      if (pc === T.NO_PIECE || T.color_of(pc) !== us) continue;
      const pt = T.type_of_piece(pc);
      if (pt === T.ROOK || pt === T.KNIGHT || pt === T.CANNON) {
        if (crossed(sq)) {
          if (T.file_of(sq) <= T.FILE_D) strongLeft++;
          else strongRight++;
        }
      }
    }
    strongLeft = Math.min(strongLeft, 4);
    strongRight = Math.min(strongRight, 4);
    mg[us] += mgValue(piecesOnOneSide[strongLeft]) + mgValue(piecesOnOneSide[strongRight]);
    eg[us] += egValue(piecesOnOneSide[strongLeft]) + egValue(piecesOnOneSide[strongRight]);
  }

  // Compute material balance
  let materialMg = 0, materialEg = 0;
  for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
    const pc = pos.board[sq];
    if (pc !== T.NO_PIECE) {
      const color = T.color_of(pc);
      const pt = T.type_of_piece(pc);
      const sign = color === T.WHITE ? 1 : -1;
      materialMg += sign * T.PieceValue[0][pt];
      materialEg += sign * T.PieceValue[1][pt];
    }
  }

  // Combine scores
  const totalMg = materialMg + (mg[T.WHITE] - mg[T.BLACK]);
  const totalEg = materialEg + (eg[T.WHITE] - eg[T.BLACK]);

  // Game phase (0 = endgame, 128 = midgame)
  let phase = 0;
  phase += pos.piecesByType[T.ROOK] * 28;
  phase += pos.piecesByType[T.KNIGHT] * 24;
  phase += pos.piecesByType[T.CANNON] * 24;
  phase += pos.piecesByType[T.BISHOP] * 12;
  phase += pos.piecesByType[T.ADVISOR] * 12;
  phase += pos.piecesByType[T.PAWN] * 16;
  phase = Math.min(phase, 128);

  // Interpolate
  const value = (totalMg * phase + totalEg * (128 - phase)) / 128;

  // Apply 60-move rule damping
  const rule60_a = 118, rule60_b = 221;
  const damped = value * (rule60_a - pos.rule60) / rule60_b;

  // Perspective: from side to move
  const result = pos.sideToMove === T.WHITE ? damped : -damped;

  // Clamp to avoid mate values
  return Math.max(-T.VALUE_MATE_IN_MAX_PLY + 1, Math.min(T.VALUE_MATE_IN_MAX_PLY - 1, Math.round(result)));
}

// Simplified evaluation for positions in check
function evaluateSimple(pos) {
  let value = 0;
  for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
    const pc = pos.board[sq];
    if (pc === T.NO_PIECE) continue;
    const color = T.color_of(pc);
    const pt = T.type_of_piece(pc);
    const sign = color === T.WHITE ? 1 : -1;
    value += sign * T.PieceValue[0][pt];
  }
  return pos.sideToMove === T.WHITE ? value : -value;
}

module.exports = { evaluate, evaluateSimple, psqScore };
