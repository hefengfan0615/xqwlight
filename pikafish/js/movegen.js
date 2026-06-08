"use strict";

// ============================================================
// Pikafish JS - Move Generator
// Generates pseudo-legal moves for Xiangqi
// ============================================================

const T = require('./types');
const BB = require('./bitboard');

// Generate all pseudo-legal moves (doesn't verify check legality)
function generateMoves(pos, onlyCaptures = false) {
  const moves = [];
  const us = pos.sideToMove;
  const them = 1 - us;
  const usTag = T.make_piece(us, 0);

  for (let sq = T.SQ_A0; sq <= T.SQ_I9; sq++) {
    const pc = pos.board[sq];
    if (pc === T.NO_PIECE || T.color_of(pc) !== us) continue;
    const pt = T.type_of_piece(pc);

    switch (pt) {
      case T.KING:
        for (const to of BB.kingAttacks[sq]) {
          const dest = pos.board[to];
          if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
            if (!onlyCaptures || dest !== T.NO_PIECE) {
              moves.push(T.make_move(sq, to));
            }
          }
        }
        break;

      case T.ADVISOR:
        for (const to of BB.advisorAttacks[sq]) {
          const dest = pos.board[to];
          if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
            if (!onlyCaptures || dest !== T.NO_PIECE) {
              moves.push(T.make_move(sq, to));
            }
          }
        }
        break;

      case T.BISHOP:
        for (let i = 0; i < BB.bishopAttacks[sq].length; i++) {
          const to = BB.bishopAttacks[sq][i];
          const eye = BB.bishopPins[sq][i];
          if (pos.board[eye] !== T.NO_PIECE) continue;
          const dest = pos.board[to];
          if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
            if (!onlyCaptures || dest !== T.NO_PIECE) {
              moves.push(T.make_move(sq, to));
            }
          }
        }
        break;

      case T.KNIGHT:
        for (let i = 0; i < BB.knightAttacks[sq].length; i++) {
          const to = BB.knightAttacks[sq][i];
          const pin = BB.knightPins[sq][i];
          if (pos.board[pin] !== T.NO_PIECE) continue;
          const dest = pos.board[to];
          if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
            if (!onlyCaptures || dest !== T.NO_PIECE) {
              moves.push(T.make_move(sq, to));
            }
          }
        }
        break;

      case T.ROOK:
        for (const dir of BB.lineDirs) {
          let s = sq;
          while (true) {
            const nf = T.file_of(s) + (dir === T.EAST ? 1 : dir === T.WEST ? -1 : 0);
            const nr = T.rank_of(s) + (dir === T.NORTH ? 1 : dir === T.SOUTH ? -1 : 0);
            if (nf < T.FILE_A || nf > T.FILE_I || nr < T.RANK_0 || nr > T.RANK_9) break;
            const to = T.make_square(nf, nr);
            const dest = pos.board[to];
            if (dest === T.NO_PIECE) {
              if (!onlyCaptures) moves.push(T.make_move(sq, to));
            } else {
              if (T.color_of(dest) !== us) {
                moves.push(T.make_move(sq, to));
              }
              break;
            }
            s = to;
          }
        }
        break;

      case T.CANNON:
        for (const dir of BB.lineDirs) {
          let s = sq;
          let screenFound = false;
          while (true) {
            const nf = T.file_of(s) + (dir === T.EAST ? 1 : dir === T.WEST ? -1 : 0);
            const nr = T.rank_of(s) + (dir === T.NORTH ? 1 : dir === T.SOUTH ? -1 : 0);
            if (nf < T.FILE_A || nf > T.FILE_I || nr < T.RANK_0 || nr > T.RANK_9) break;
            const to = T.make_square(nf, nr);
            const dest = pos.board[to];
            if (!screenFound) {
              if (dest === T.NO_PIECE) {
                if (!onlyCaptures) moves.push(T.make_move(sq, to));
              } else {
                screenFound = true;
              }
            } else {
              if (dest !== T.NO_PIECE) {
                if (T.color_of(dest) !== us) {
                  moves.push(T.make_move(sq, to));
                }
                break;
              }
            }
            s = to;
          }
        }
        break;

      case T.PAWN: {
        const forward = BB.pawnAttacksForward[sq];
        if (forward >= 0) {
          const dest = pos.board[forward];
          if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
            if (!onlyCaptures || dest !== T.NO_PIECE) {
              moves.push(T.make_move(sq, forward));
            }
          }
        }
        const crossed = us === T.WHITE ? T.rank_of(sq) >= T.RANK_5 : T.rank_of(sq) <= T.RANK_4;
        if (crossed) {
          const caps = us === T.WHITE ? BB.pawnCapturesWhite[sq] : BB.pawnCapturesBlack[sq];
          for (const to of caps) {
            const dest = pos.board[to];
            if (dest === T.NO_PIECE || T.color_of(dest) !== us) {
              if (!onlyCaptures || dest !== T.NO_PIECE) {
                moves.push(T.make_move(sq, to));
              }
            }
          }
        }
        break;
      }
    }
  }

  return moves;
}

// Generate legal moves (filter out moves that leave king in check)
function generateLegalMoves(pos, onlyCaptures = false) {
  const pseudoMoves = generateMoves(pos, onlyCaptures);
  const legalMoves = [];
  for (const m of pseudoMoves) {
    if (pos.legalMove(m)) {
      legalMoves.push(m);
    }
  }
  return legalMoves;
}

module.exports = { generateMoves, generateLegalMoves };
