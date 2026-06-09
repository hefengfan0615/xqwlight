/*
 * Pikafish Chinese Chess Engine - Position Evaluation (HCE)
 * Converted from Stockfish/Pikafish C++ evaluate.cpp, psqt.cpp, material.cpp
 */

import {
  SQUARE_NB, FILE_NB, RANK_NB,
  WHITE, BLACK, COLOR_NB,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  PIECE_NB, PIECE_TYPE_NB, NO_PIECE_TYPE,
  PieceValue, MG, EG, PHASE_NB,
  VALUE_ZERO, VALUE_DRAW, VALUE_KNOWN_WIN, VALUE_MATE,
  VALUE_MATED_IN_MAX_PLY, VALUE_MATE_IN_MAX_PLY,
  makeScore, mgValue, egValue, SCORE_ZERO,
  colorOf, typeOf, fileOf, rankOf, makeSquare,
  relativeRankOf, flipRank,
  PawnValueEg, PawnValueMg,
  RookValueMg, KnightValueMg, CannonValueMg, AdvisorValueMg, BishopValueMg,
  W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING,
  B_ROOK, B_ADVISOR, B_CANNON, B_PAWN, B_KNIGHT, B_BISHOP, B_KING,
  SQ_A0, SQ_E0, SQ_E1, SQ_E8, SQ_E9, SQ_NONE,
  PHASE_MIDGAME,
} from './pikafish_types.js';

import {
  bbSet, bbTest, bbEmpty, popcount, lsb,
  SquareBB, BetweenBB, 
  attacksByPieceType,
  rookAttacks, cannonAttacks, knightAttacks,
  bishopAttacks, advisorAttacks, kingAttacks, pawnAttacks,
  PseudoAttacks,
  kingLineBB,
  FileBB, RankBB,
  checkersToKing,
} from './pikafish_bitboard.js';

// Bitboard shift helpers
const shiftN = (bb) => bb << 9n;
const shiftS = (bb) => bb >> 9n;
const shiftE = (bb) => (bb << 1n) & ~FileBB[0]; // Prevent wrapping from file H to file A
const shiftW = (bb) => (bb >> 1n) & ~FileBB[8]; // Prevent wrapping from file A to file H

// Predefined file/rank masks
const FileABB = FileBB[0], FileBBB = FileBB[1], FileCBB = FileBB[2], FileDBB = FileBB[3];
const FileEBB = FileBB[4], FileFBB = FileBB[5], FileGBB = FileBB[6], FileHBB = FileBB[7], FileIBB = FileBB[8];
const Rank0BB = RankBB[0], Rank1BB = RankBB[1], Rank2BB = RankBB[2], Rank3BB = RankBB[3], Rank4BB = RankBB[4];
const Rank5BB = RankBB[5], Rank6BB = RankBB[6], Rank7BB = RankBB[7], Rank8BB = RankBB[8], Rank9BB = RankBB[9];

// =============== PSQT Tables ===============
// From Pikafish C++ psqt.cpp
// 'Bonus' contains Piece-Square parameters.
// Scores are explicit for files A to E, implicitly mirrored for E to I.

const S = (mg, eg) => makeScore(mg, eg);

// Bonus[pType][rank][mirroredFile] where mirroredFile 0-4 maps to A-E
const Bonus = [
  // NO_PIECE_TYPE (placeholder)
  [],
  // ROOK
  [
   [S(-203,-131), S(  46,-225), S(-147, -86), S( -17,   5), S(   8, -13)],
   [S(-203, -52), S(  58, -67), S( -89,-110), S( -78, 121), S(-106, 106)],
   [S(-138, -61), S(   7, -96), S( -65,  -9), S(-110,   7), S(  -8,  45)],
   [S( -60,  77), S( -48, -33), S( -58,  61), S(  88,  54), S( 175,  -4)],
   [S( -61,  32), S(  42,  -7), S(-112,  34), S( 181,  13), S(-170,  14)],
   [S( -69, -12), S( 192,  24), S(  88, -76), S(  53, -74), S( 110,  86)],
   [S(-199, 103), S(  -8, -85), S( 179, -39), S(  48,  23), S(  12,  79)],
   [S( 139, 130), S(  20,-149), S(  95, 113), S(  92, 101), S( -20, -69)],
   [S( -72, -15), S( 163, -21), S( 124, -79), S(  32,  46), S( -78,-100)],
   [S( 109, -97), S(  66, -29), S( -86,  -4), S(  39,  55), S(  22,  54)]
  ],
  // ADVISOR
  [
   [S(   0,   0), S(   0,   0), S(   0,   0), S(  41,  33), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(  38, 113)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(-152,  47), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)]
  ],
  // CANNON
  [
   [S(  -4,  15), S( -42, -59), S( -44, -53), S(  61, 124), S(   4,  34)],
   [S(  38,   6), S( 141, -34), S( -63,  22), S(  -1,  37), S( 113,  41)],
   [S(  21, -24), S(  72, -11), S(  58,  82), S( 104,  60), S( 212,  42)],
   [S(  35, 106), S(-194, -36), S( 112,  97), S( 102,-151), S(  -2, -43)],
   [S( -40, -30), S( -56,  78), S( -82,  32), S(-113, 136), S( 246,   6)],
   [S( -66,  13), S(  66,-102), S(   2,  40), S(  -7,  34), S(  79, 112)],
   [S(  51,-196), S( 100, -46), S(  20, -34), S(   1,  52), S(  48, 163)],
   [S( 149,-165), S( -13,  84), S(  -2,   9), S(  67,-107), S( 180,  58)],
   [S( -48, 100), S(  55, -17), S(  -2,  16), S( -42, -91), S(  88,  51)],
   [S( 135, -53), S( 225, -12), S( -15,  26), S( 189, 144), S(  13,  12)]
  ],
  // PAWN
  [
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S( -27, -19), S(   0,   0), S( -19, -27), S(   0,   0), S(  56,  34)],
   [S( -12, -18), S(   0,   0), S(  41,  -2), S(   0,   0), S(  39,  61)],
   [S( -28,  70), S( -53,  93), S( 138,  46), S(  26, 197), S(  73,  52)],
   [S( -74,  69), S(-145,  80), S(  53, 161), S(   2, 210), S( -65,  22)],
   [S(  91, -92), S(-120, 104), S(  18,  41), S(  19,  46), S(-121, -67)],
   [S(-181,-148), S(  50,  56), S( 182,  34), S(  11,  41), S(  62,  17)],
   [S( 116, -57), S(  85, -85), S( -84,   3), S(  35, -33), S(  19,-119)]
  ],
  // KNIGHT
  [
   [S( -25, -48), S(-180,-201), S( -30, -32), S(-112,-133), S( -99,  56)],
   [S(-126, -95), S( -93,  59), S(-142, -26), S( -37, -82), S( -64,-136)],
   [S( -82, -88), S(  43, -51), S( -35,-109), S(  11,  54), S(  -4, -16)],
   [S(  25,   7), S( -86,-111), S(  82, -30), S( 172, -90), S( -36, 101)],
   [S(-154,  35), S( -58,  68), S(   5,  89), S(  26, -50), S( 103,  56)],
   [S( 117, -34), S(  70,  66), S(  43, -50), S( 151,  74), S( -53, 110)],
   [S( -62, -72), S(  62,  47), S( 170,  63), S(  26,  34), S( -74,  -2)],
   [S( 122, -69), S( -69,-134), S(   4,  25), S(  78, 151), S(   1, 198)],
   [S(-107, -19), S( -69, -57), S( -11, 100), S( -64, -74), S( 187, 125)],
   [S( -53,  20), S(  12, 139), S(  30, -12), S(-139, -79), S( -65,  25)]
  ],
  // BISHOP
  [
   [S(   0,   0), S(   0,   0), S( 111, 129), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(  18, 105), S(   0,   0), S(   0,   0), S(   0,   0), S( 206, 148)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(  -4, 102), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)]
  ],
  // KING
  [
   [S(   0,   0), S(   0,   0), S(   0,   0), S( -74,  42), S(  63,  65)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(-221, -16), S( -71,  63)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   1,-167), S( -36, -59)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)],
   [S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0), S(   0,   0)]
  ]
];

// edgeDistance for file mirroring: min(f, 8-f)
function edgeDist(f) { return f < 8 - f ? f : 8 - f; }
// PSQT tables: [piece][square] = Score(mg, eg)
const psq = [];

function initPSQT() {
  for (let pc = 0; pc < PIECE_NB; pc++) {
    psq[pc] = new Int32Array(SQUARE_NB);
  }
  // Map Pikafish piece types: ROOK=1, ADVISOR=2, CANNON=3, PAWN=4, KNIGHT=5, BISHOP=6, KING=7
  const wPieces = [W_ROOK, W_ADVISOR, W_CANNON, W_PAWN, W_KNIGHT, W_BISHOP, W_KING];
  for (const pc of wPieces) {
    const pt = typeOf(pc); // ROOK(1) through KING(7)
    const score = makeScore(PieceValue[MG][pc], PieceValue[EG][pc]);
    for (let sq = 0; sq < SQUARE_NB; sq++) {
      const f = fileOf(sq);
      let fi = edgeDist(f);
      if (fi > 4) fi--;
      const r = rankOf(sq);
      const bonus = Bonus[pt][r][fi];
      psq[pc][sq] = score + bonus;
      // Black is flipped and negated
      const flippedSq = flipRank(sq);
      psq[pc + 8][flippedSq] = -(psq[pc][sq]);
    }
  }
}

initPSQT();

// =============== Evaluation Constants ===============
const S2 = (mg, eg) => makeScore(mg, eg);

const HollowCannon       = S2(85, 91);
const CentralKnight      = S2(50, 53);
const BottomCannon       = S2(18, 8);
const AdvisorBishopPair  = S2(24, -43);

const CrossedPawn = [
  [S2(-56, -40), S2(6, 24), S2(11, 7), S2(-29, 7), S2(-9, -1), S2(-4, -7)],
  [S2(-68, -35), S2(10, 12), S2(9, 3), S2(-16, 9), S2(-14, 0), S2(-36, -13)],
  [S2(-79, 5), S2(40, -8), S2(32, 1), S2(-22, 9), S2(-20, -16), S2(-40, -20)]
];

const ConnectedPawn     = S2(5, -5);
const TrappedKnight     = S2(-5, -2);
const RookOnOpenFile    = [S2(0, -8), S2(14, 16)];
const PiecesOnOneSide   = [S2(-3, 5), S2(-13, 36), S2(18, 26), S2(9, 26), S2(10, -4)];

const rule60_a = 118, rule60_b = 221;

// =============== Material Imbalance Tables ===============
const QuadraticOurs = [
  // ROOK
  [S2(71, 3)],
  // ADVISOR
  [S2(24, 74), S2(44, -67)],
  // CANNON
  [S2(48, 72), S2(33, 62), S2(-5, -63)],
  // PAWN
  [S2(75, -14), S2(31, 44), S2(-3, 28), S2(-11, 11)],
  // KNIGHT
  [S2(-92, 53), S2(27, -9), S2(-3, 234), S2(44, 88), S2(-30, -29)],
  // BISHOP
  [S2(54, 104), S2(175, -103), S2(106, -64), S2(43, -113), S2(24, 6), S2(2, -59)]
];

const QuadraticTheirs = [
  // ROOK
  [S2(-35, -46)],
  // ADVISOR
  [S2(-92, 32), S2(138, -7)],
  // CANNON
  [S2(-83, 13), S2(-41, 43), S2(20, 28)],
  // PAWN
  [S2(-2, 13), S2(-57, -118), S2(-18, 121), S2(70, -58)],
  // KNIGHT
  [S2(-37, 17), S2(14, -86), S2(38, -24), S2(67, 43), S2(-21, -42)],
  // BISHOP
  [S2(72, 38), S2(6, -79), S2(24, -2), S2(48, 30), S2(30, 14), S2(-51, 35)]
];

// =============== Material Probe ===============
const materialTable = new Map();

function materialProbe(pos) {
  const key = pos.materialKey.toString();
  let e = materialTable.get(key);
  if (e) return e;

  e = {};
  e.key = pos.materialKey;
  e.evaluationFunction = null;
  e.scaleFactor = [0, 0];
  e.factor = [0, 0];
  e.imbalance = () => 0;

  // Compute game phase
  const sum = pos.materialSum();
  const MidgameLimit = 15258, EndgameLimit = 3915;
  e.gamePhase = ((sum - EndgameLimit) * 128) / (MidgameLimit - EndgameLimit);
  if (e.gamePhase < 0) e.gamePhase = 0;
  if (e.gamePhase > 128) e.gamePhase = 128;

  // Check special endgame functions
  // KAABBKR: 车(任意士象) vs 士象全(任意兵卒)
  for (const us of [WHITE, BLACK]) {
    const them = us ^ 1;
    const usMaterial = pos.material(us);
    const themMaterial = pos.material(them);
    const usPieces = pos.countAll(us);
    const themPieces = pos.countAll(them);

    // is_KAABBKR
    if (themMaterial >= AdvisorValueMg * 2 + BishopValueMg * 2 &&
        usMaterial >= RookValueMg &&
        usPieces === pos.countPiece(us, ROOK) + pos.countPiece(us, ADVISOR) + pos.countPiece(us, BISHOP) + 1) {
      e.evaluationFunction = evaluateKAABBKR.bind(null, us);
      materialTable.set(key, e);
      return e;
    }

    // is_KPKP
    if (us === WHITE && usMaterial === PawnValueMg && themMaterial === PawnValueMg) {
      e.evaluationFunction = evaluateKPKP.bind(null, us);
      materialTable.set(key, e);
      return e;
    }

    // is_KBKN
    if (themMaterial >= BishopValueMg && usMaterial >= KnightValueMg &&
        usPieces === pos.countPiece(us, KNIGHT) + pos.countPiece(us, ADVISOR) + pos.countPiece(us, BISHOP) + 1) {
      e.evaluationFunction = evaluateKBKN.bind(null, us);
      materialTable.set(key, e);
      return e;
    }
  }

  // Insufficient material draw detection
  if (pos.countPiece(WHITE, PAWN) === 0 && pos.countPiece(BLACK, PAWN) === 0) {
    const majorMat = pos.countPiece(WHITE, KNIGHT) * KnightValueMg +
                     pos.countPiece(BLACK, KNIGHT) * KnightValueMg +
                     pos.countPiece(WHITE, ROOK) * RookValueMg +
                     pos.countPiece(BLACK, ROOK) * RookValueMg +
                     pos.countPiece(WHITE, CANNON) * CannonValueMg +
                     pos.countPiece(BLACK, CANNON) * CannonValueMg;

    if (majorMat === 0) {
      e.evaluationFunction = evaluateInsufficient;
      materialTable.set(key, e);
      return e;
    }

    // Only one cannon, no advisors → draw
    if (majorMat === CannonValueMg && pos.countPiece(WHITE, ADVISOR) === 0 && pos.countPiece(BLACK, ADVISOR) === 0) {
      e.evaluationFunction = evaluateInsufficient;
      materialTable.set(key, e);
      return e;
    }

    // Side without cannon can have one advisor, the cannon side only has cannon
    if ((pos.countAll(WHITE) === 2 && pos.countPiece(WHITE, CANNON) === 1 && pos.countPiece(BLACK, ADVISOR) === 1) ||
        (pos.countAll(BLACK) === 2 && pos.countPiece(BLACK, CANNON) === 1 && pos.countPiece(WHITE, ADVISOR) === 1)) {
      e.evaluationFunction = evaluateInsufficient;
      materialTable.set(key, e);
      return e;
    }

    // Two cannons, one each side, no other pieces
    if (pos.countAll(WHITE) + pos.countAll(BLACK) === 4 &&
        pos.countPiece(WHITE, CANNON) === 1 && pos.countPiece(BLACK, CANNON) === 1) {
      e.evaluationFunction = evaluateInsufficient;
      materialTable.set(key, e);
      return e;
    }
  }

  // Compute imbalance score
  const pCnt = [
    [pos.countPiece(WHITE, ROOK), pos.countPiece(WHITE, ADVISOR), pos.countPiece(WHITE, CANNON),
     pos.countPiece(WHITE, PAWN), pos.countPiece(WHITE, KNIGHT), pos.countPiece(WHITE, BISHOP)],
    [pos.countPiece(BLACK, ROOK), pos.countPiece(BLACK, ADVISOR), pos.countPiece(BLACK, CANNON),
     pos.countPiece(BLACK, PAWN), pos.countPiece(BLACK, KNIGHT), pos.countPiece(BLACK, BISHOP)]
  ];

  e.imbalanceScore = (imbalance(pCnt, WHITE) - imbalance(pCnt, BLACK)) / 16;
  e.imbalance = () => e.imbalanceScore;

  materialTable.set(key, e);
  return e;
}

function imbalance(pieceCount, Us) {
  const Them = Us ^ 1;
  let bonus = 0;

  for (let pt1 = 0; pt1 <= 5; pt1++) { // ROOK to BISHOP
    if (!pieceCount[Us][pt1]) continue;
    let v = QuadraticOurs[pt1][pt1] * pieceCount[Us][pt1];
    for (let pt2 = 0; pt2 < pt1; pt2++) {
      v = v + QuadraticOurs[pt1][pt2] * pieceCount[Us][pt2]
            + QuadraticTheirs[pt1][pt2] * pieceCount[Them][pt2];
    }
    bonus = bonus + pieceCount[Us][pt1] * v;
  }
  return bonus;
}

// Special endgame evaluators
function evaluateKAABBKR(us, pos) {
  // Simplified: material difference
  return pos.sideToMove === WHITE ? VALUE_KNOWN_WIN : -VALUE_KNOWN_WIN;
}
function evaluateKPKP(us, pos) {
  return VALUE_DRAW;
}
function evaluateKBKN(us, pos) {
  return VALUE_DRAW;
}
function evaluateInsufficient(pos) {
  return VALUE_DRAW;
}

// =============== Evaluation Class ===============
class EvaluationState {
  constructor(pos) {
    this.pos = pos;
    this.me = null;
    this.attackedBy = [new Array(PIECE_TYPE_NB), new Array(PIECE_TYPE_NB)];
    this.attackedBy2 = [0n, 0n];
    this.mobility = [0, 0]; // as Score (packed)
    for (let c = 0; c < COLOR_NB; c++) {
      for (let pt = 0; pt < PIECE_TYPE_NB; pt++) {
        this.attackedBy[c][pt] = 0n;
      }
    }
  }

  // Initialize king and pawn attacks
  initialize(us) {
    const ksq = this.pos.kingSquare(us);
    this.attackedBy[us][KING] = kingAttacks(ksq, us);
    this.attackedBy[us][PAWN] = pawnAttacksBB(us, this.pos.piecesByType(us, PAWN));
    this.attackedBy[us][NO_PIECE_TYPE] = this.attackedBy[us][KING] | this.attackedBy[us][PAWN];
    this.attackedBy2[us] = this.attackedBy[us][KING] & this.attackedBy[us][PAWN];
  }

  // Score pieces of a given color and type
  piecesScore(us, pt) {
    const them = us ^ 1;
    const ksq = this.pos.kingSquare(them);
    let b = this.pos.piecesByType(us, pt);
    let score = 0;
    this.attackedBy[us][pt] = 0n;

    while (b !== 0n) {
      const s = lsb(b);
      b = b & (b - 1n); // pop_lsb

      // Find attacked squares
      let att = attacksByPieceType(pt, s, us, this.pos.occupied);

      // If this piece is a blocker for our king, restrict attacks along pin line
      if (this.pos.blockersForKing[us] && (this.pos.blockersForKing[us] & (1n << BigInt(s)))) {
        att = att & kingLineBB(null, this.pos.kingSquare(us), s);
      }

      this.attackedBy2[us] = this.attackedBy2[us] | (this.attackedBy[us][NO_PIECE_TYPE] & att);
      this.attackedBy[us][pt] = this.attackedBy[us][pt] | att;
      this.attackedBy[us][NO_PIECE_TYPE] = this.attackedBy[us][NO_PIECE_TYPE] | att;

      // Mobility
      const mob = popcount(att & ~this.attackedBy[them][PAWN]);

      if (pt === ROOK) {
        if (isOnSemiOpenFile(this.pos, us, s)) {
          score = score + RookOnOpenFile[isOnSemiOpenFile(this.pos, them, s) ? 1 : 0];
        }
      }
      if (pt === CANNON) {
        const bbb = BetweenBB[s][ksq];
        const occ = this.pos.occupied;
        if (typeof bbb !== 'bigint' || typeof occ !== 'bigint') {
          return score;
        }
        const between = bbb & occ;
        const blocker = popcount(between) - 1;
        const originalAdvisor = ((FileDBB | FileFBB) & (Rank0BB | Rank9BB));
        const advisorBB = this.pos.piecesByType(them, ADVISOR);
        if (fileOf(s) === 4 && (ksq === SQ_E0 || ksq === SQ_E9) && popcount(originalAdvisor & advisorBB) === 2) {
          if (blocker === 0) {
            score = score + HollowCannon; // 空头炮
          }
          if (blocker === 2 && (betweenBB(s, ksq) & this.pos.piecesByType(them, KNIGHT) & this.attackedBy[them][KING])) {
            score = score + CentralKnight; // 炮镇窝心马
          }
        }
        const enemyCenter = us === WHITE ? SQ_E8 : SQ_E1;
        const r = rankOf(s);
        if (r === rankOf(enemyCenter) && blocker === 0 && (ksq === SQ_E0 || ksq === SQ_E9) && (this.pos.pieces(them) & (1n << BigInt(enemyCenter)))) {
          score = score + BottomCannon; // 沉底炮
        }
      }
      if (pt === KNIGHT) {
        const sqBB = 1n << BigInt(s);
        const aroundBB = shiftN(sqBB) | shiftS(sqBB) | shiftE(sqBB) | shiftW(sqBB);
        if ((sqBB & (FileABB | FileIBB | Rank0BB | Rank9BB)) &&
            (this.pos.piecesByType(them, ROOK) & aroundBB) &&
            (this.pos.piecesByType(us, ROOK) & aroundBB)) {
          score = score + TrappedKnight;
        }
      }
    }
    return score;
  }

  // Threat evaluation
  threatScore(us) {
    const them = us ^ 1;
    let score = 0;

    // Advisor + Bishop pair
    if (this.pos.countPiece(us, ADVISOR) + this.pos.countPiece(us, BISHOP) === 4)
      score = score + AdvisorBishopPair;

    // Crossed pawn (passed pawn)
    const crossedWithoutBottom = us === WHITE ? (Rank5BB | Rank6BB | Rank7BB | Rank8BB) : (Rank1BB | Rank2BB | Rank3BB | Rank4BB);
    const crossedPawnCnt = popcount(crossedWithoutBottom & this.pos.piecesByType(us, PAWN));
    const themAdvisorCnt = this.pos.countPiece(them, ADVISOR);
    const cpc = Math.min(crossedPawnCnt, 5);
    const tac = Math.min(themAdvisorCnt, 2);
    score = score + CrossedPawn[tac][cpc];

    // Connected pawn
    score = score + ConnectedPawn * Number(popcount(shiftE(this.pos.piecesByType(us, PAWN)) & this.pos.piecesByType(us, PAWN)));

    // Pieces on one side
    const crossed = us === WHITE ? (Rank5BB | Rank6BB | Rank7BB | Rank8BB | Rank9BB) : (Rank0BB | Rank1BB | Rank2BB | Rank3BB | Rank4BB);
    const left = (FileABB | FileBBB | FileCBB | FileDBB);
    const right = (FileFBB | FileGBB | FileHBB | FileIBB);
    const strongPieces = this.pos.piecesByType(us, ROOK) | this.pos.piecesByType(us, KNIGHT) | this.pos.piecesByType(us, CANNON);
    const attackedPieces = this.attackedBy[them][PAWN] | this.attackedBy[them][ADVISOR] | this.attackedBy[them][BISHOP] |
                           this.attackedBy[them][CANNON] | this.attackedBy[them][KNIGHT] |
                           (this.attackedBy[them][ROOK] & ~this.attackedBy[us][NO_PIECE_TYPE]);

    for (const side of [left, right]) {
      let cnt = popcount(strongPieces & side & crossed & (~attackedPieces));
      if (cnt >= 5) cnt = 4;
      score = score + PiecesOnOneSide[cnt];
    }

    return score;
  }

  // Adjust score by game phase
  winnable(score) {
    const gamePhase = this.me.gamePhase;
    const mg = mgValue(score), eg = egValue(score);
    let v = (mg * gamePhase + eg * (128 - gamePhase)) / 128;
    return Math.round(v);
  }

  // Main evaluation
  value() {
    // Check for check
    if (this.pos.inCheck()) {
      // Return material-only eval when in check
      let v = 0;
      for (let pt = ROOK; pt <= BISHOP; pt++) {
        v += this.pos.countPiece(WHITE, pt) * PieceValue[MG][pt] + this.pos.countPiece(WHITE, pt) * PieceValue[EG][pt];
        v -= this.pos.countPiece(BLACK, pt) * PieceValue[MG][pt] + this.pos.countPiece(BLACK, pt) * PieceValue[EG][pt];
      }
      return this.pos.sideToMove === WHITE ? v : -v;
    }

    // Probe material hash
    this.me = materialProbe(this.pos);

    if (this.me.evaluationFunction) {
      return this.me.evaluationFunction(this.pos);
    }

    // PSQT score + material imbalance
    let score = this.pos.psqScore() + this.me.imbalance();

    // Initialize attacks
    this.initialize(WHITE);
    this.initialize(BLACK);

    // Evaluate pieces
    const piecesWhite = this.piecesScore(WHITE, KNIGHT) +
                        this.piecesScore(WHITE, BISHOP) +
                        this.piecesScore(WHITE, ROOK) +
                        this.piecesScore(WHITE, ADVISOR) +
                        this.piecesScore(WHITE, CANNON);

    const piecesBlack = this.piecesScore(BLACK, KNIGHT) +
                        this.piecesScore(BLACK, BISHOP) +
                        this.piecesScore(BLACK, ROOK) +
                        this.piecesScore(BLACK, ADVISOR) +
                        this.piecesScore(BLACK, CANNON);

    score = score + piecesWhite - piecesBlack;

    // Threats
    score = score + this.threatScore(WHITE) - this.threatScore(BLACK);

    // Derive single value from mg and eg parts
    let v = this.winnable(score);

    // Side to move point of view
    v = (this.pos.sideToMove === WHITE ? v : -v);

    return v;
  }
}

// Helper: compute pawn attacks bitboard for a color from a pawn bb
function pawnAttacksBB(us, pawnBB) {
  let result = 0n;
  let b = pawnBB;
  while (b !== 0n) {
    const s = lsb(b);
    b = b & (b - 1n);
    // Pawn attacks: forward direction
    const r = rankOf(s);
    if (us === WHITE) {
      // White pawns move up (increasing rank)
      if (r < 9) {
        if (fileOf(s) > 0) result |= (1n << BigInt(makeSquare(fileOf(s) - 1, r + 1)));
        if (fileOf(s) < 8) result |= (1n << BigInt(makeSquare(fileOf(s) + 1, r + 1)));
      }
      // After crossing river, can also move forward
      if (r >= 5 && r < 9) {
        result |= (1n << BigInt(s + 9));
      }
    } else {
      if (r > 0) {
        if (fileOf(s) > 0) result |= (1n << BigInt(makeSquare(fileOf(s) - 1, r - 1)));
        if (fileOf(s) < 8) result |= (1n << BigInt(makeSquare(fileOf(s) + 1, r - 1)));
      }
      if (r <= 4 && r > 0) {
        result |= (1n << BigInt(s - 9));
      }
    }
  }
  return result;
}

function isOnSemiOpenFile(pos, c, sq) {
  const f = fileOf(sq);
  const fileMask = FileBB[f];
  return (pos.piecesByType(c, PAWN) & fileMask) === 0n;
}

// =============== Public API ===============

/**
 * evaluate(pos) - main evaluation function
 * Returns a static evaluation from the point of view of the side to move.
 */
export function evaluate(pos) {
  const evalState = new EvaluationState(pos);
  let v = evalState.value();

  // Dampen evaluation when shuffling (rule 60)
  v = v * (rule60_a - pos.rule60) / rule60_b;

  // Clamp to mate range
  if (v > VALUE_MATE_IN_MAX_PLY - 1) v = VALUE_MATE_IN_MAX_PLY - 1;
  if (v < VALUE_MATED_IN_MAX_PLY + 1) v = VALUE_MATED_IN_MAX_PLY + 1;

  return v;
}

/**
 * Get PSQT score for a piece at a square
 */
export function psqScore(pc, sq) {
  return psq[pc] ? psq[pc][sq] : 0;
}

export { psq, materialProbe };