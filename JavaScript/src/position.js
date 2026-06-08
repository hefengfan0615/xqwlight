/*
 * position.js - 局面 (Position) 模块
 * 参考 Pikafish (Stockfish 衍生) 的 position.h / position.cpp 思路
 * 实现了中国象棋的：FEN 解析、棋子摆放、吃子/走子/悔棋、将军判定、
 *               重复局面判定、生成所有合法走法、静态评估
 */

"use strict";

import {
  RANK_TOP, RANK_BOTTOM, FILE_LEFT, FILE_RIGHT,
  ADD_PIECE, DEL_PIECE,
  PIECE_KING, PIECE_ADVISOR, PIECE_BISHOP, PIECE_KNIGHT,
  PIECE_ROOK, PIECE_CANNON, PIECE_PAWN,
  IN_BOARD, IN_FORT, RANK_Y, FILE_X, COORD_XY,
  SQUARE_FLIP, SQUARE_FORWARD, KING_SPAN, ADVISOR_SPAN,
  BISHOP_SPAN, BISHOP_PIN, KNIGHT_PIN,
  HOME_HALF, AWAY_HALF, SAME_HALF, SAME_RANK, SAME_FILE,
  SIDE_TAG, OPP_SIDE_TAG, SRC, DST, MOVE, MIRROR_SQUARE, MIRROR_MOVE,
  MVV_LVA, CHR, ASC,
  FEN_PIECE, CHAR_TO_PIECE,
  MATE_VALUE, BAN_VALUE, DRAW_VALUE, ADVANCED_VALUE,
  NULL_SAFE_MARGIN, NULL_OKAY_MARGIN,
  KING_DELTA, ADVISOR_DELTA, KNIGHT_DELTA, KNIGHT_CHECK_DELTA,
  PIECE_VALUE,
  PreGen_zobristKeyTable, PreGen_zobristLockTable,
  PreGen_zobristKeyPlayer, PreGen_zobristLockPlayer,
} from "./types.js";

// ---------- 二分搜索（用于开局库） ----------
export function binarySearch(vlss, vl) {
  let low = 0;
  let high = vlss.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (vlss[mid][0] < vl) low = mid + 1;
    else if (vlss[mid][0] > vl) high = mid - 1;
    else return mid;
  }
  return -1;
}

export class Position {
  constructor() {
    this.sdPlayer = 0;
    this.squares = new Array(256).fill(0);
    this.zobristKey = 0;
    this.zobristLock = 0;
    this.vlWhite = 0;
    this.vlBlack = 0;
    this.mvList = [0];
    this.pcList = [0];
    this.keyList = [0];
    this.chkList = [false];
    this.distance = 0;
  }

  clearBoard() {
    this.sdPlayer = 0;
    this.squares = new Array(256).fill(0);
    this.zobristKey = this.zobristLock = 0;
    this.vlWhite = this.vlBlack = 0;
  }

  setIrrev() {
    this.mvList = [0];
    this.pcList = [0];
    this.keyList = [0];
    this.chkList = [this.checked()];
    this.distance = 0;
  }

  addPiece(sq, pc, bDel) {
    let pcAdjust;
    this.squares[sq] = bDel ? 0 : pc;
    if (pc < 16) {
      pcAdjust = pc - 8;
      this.vlWhite += bDel ? -PIECE_VALUE[pcAdjust][sq] : PIECE_VALUE[pcAdjust][sq];
    } else {
      pcAdjust = pc - 16;
      this.vlBlack += bDel
        ? -PIECE_VALUE[pcAdjust][SQUARE_FLIP(sq)]
        : PIECE_VALUE[pcAdjust][SQUARE_FLIP(sq)];
      pcAdjust += 7;
    }
    this.zobristKey ^= PreGen_zobristKeyTable[pcAdjust][sq];
    this.zobristLock ^= PreGen_zobristLockTable[pcAdjust][sq];
  }

  movePiece(mv) {
    const sqSrc = SRC(mv);
    const sqDst = DST(mv);
    let pc = this.squares[sqDst];
    this.pcList.push(pc);
    if (pc > 0) this.addPiece(sqDst, pc, DEL_PIECE);
    pc = this.squares[sqSrc];
    this.addPiece(sqSrc, pc, DEL_PIECE);
    this.addPiece(sqDst, pc, ADD_PIECE);
    this.mvList.push(mv);
  }

  undoMovePiece() {
    const mv = this.mvList.pop();
    const sqSrc = SRC(mv);
    const sqDst = DST(mv);
    let pc = this.squares[sqDst];
    this.addPiece(sqDst, pc, DEL_PIECE);
    this.addPiece(sqSrc, pc, ADD_PIECE);
    pc = this.pcList.pop();
    if (pc > 0) this.addPiece(sqDst, pc, ADD_PIECE);
  }

  changeSide() {
    this.sdPlayer = 1 - this.sdPlayer;
    this.zobristKey ^= PreGen_zobristKeyPlayer;
    this.zobristLock ^= PreGen_zobristLockPlayer;
  }

  makeMove(mv) {
    const zobristKey = this.zobristKey;
    this.movePiece(mv);
    if (this.checked()) {
      this.undoMovePiece();
      return false;
    }
    this.keyList.push(zobristKey);
    this.changeSide();
    this.chkList.push(this.checked());
    this.distance++;
    return true;
  }

  undoMakeMove() {
    this.distance--;
    this.chkList.pop();
    this.changeSide();
    this.keyList.pop();
    this.undoMovePiece();
  }

  nullMove() {
    this.mvList.push(0);
    this.pcList.push(0);
    this.keyList.push(this.zobristKey);
    this.changeSide();
    this.chkList.push(false);
    this.distance++;
  }

  undoNullMove() {
    this.distance--;
    this.chkList.pop();
    this.changeSide();
    this.keyList.pop();
    this.pcList.pop();
    this.mvList.pop();
  }

  fromFen(fen) {
    this.clearBoard();
    let y = RANK_TOP;
    let x = FILE_LEFT;
    let index = 0;
    if (index === fen.length) {
      this.setIrrev();
      return;
    }
    let c = fen.charAt(index);
    while (c !== " ") {
      if (c === "/") {
        x = FILE_LEFT;
        y++;
        if (y > RANK_BOTTOM) break;
      } else if (c >= "1" && c <= "9") {
        x += (ASC(c) - ASC("0"));
      } else if (c >= "A" && c <= "Z") {
        if (x <= FILE_RIGHT) {
          const pt = CHAR_TO_PIECE(c);
          if (pt >= 0) this.addPiece(COORD_XY(x, y), pt + 8);
          x++;
        }
      } else if (c >= "a" && c <= "z") {
        if (x <= FILE_RIGHT) {
          const pt = CHAR_TO_PIECE(CHR(ASC(c) + ASC("A") - ASC("a")));
          if (pt >= 0) this.addPiece(COORD_XY(x, y), pt + 16);
          x++;
        }
      }
      index++;
      if (index === fen.length) {
        this.setIrrev();
        return;
      }
      c = fen.charAt(index);
    }
    index++;
    if (index === fen.length) {
      this.setIrrev();
      return;
    }
    if (this.sdPlayer === (fen.charAt(index) === "b" ? 0 : 1)) {
      this.changeSide();
    }
    this.setIrrev();
  }

  toFen() {
    let fen = "";
    for (let y = RANK_TOP; y <= RANK_BOTTOM; y++) {
      let k = 0;
      for (let x = FILE_LEFT; x <= FILE_RIGHT; x++) {
        const pc = this.squares[COORD_XY(x, y)];
        if (pc > 0) {
          if (k > 0) {
            fen += CHR(ASC("0") + k);
            k = 0;
          }
          fen += FEN_PIECE.charAt(pc);
        } else {
          k++;
        }
      }
      if (k > 0) fen += CHR(ASC("0") + k);
      fen += "/";
    }
    return fen.substring(0, fen.length - 1) +
      (this.sdPlayer === 0 ? " w" : " b");
  }

  // ---------- 生成所有走法（vls = null 时生成全部；否则只生成吃子走法并附 MVV-LVA 评分） ----------
  generateMoves(vls) {
    const mvs = [];
    const pcSelfSide = SIDE_TAG(this.sdPlayer);
    const pcOppSide = OPP_SIDE_TAG(this.sdPlayer);
    for (let sqSrc = 0; sqSrc < 256; sqSrc++) {
      const pcSrc = this.squares[sqSrc];
      if ((pcSrc & pcSelfSide) === 0) continue;
      switch (pcSrc - pcSelfSide) {
        case PIECE_KING:
          for (let i = 0; i < 4; i++) {
            const sqDst = sqSrc + KING_DELTA[i];
            if (!IN_FORT(sqDst)) continue;
            const pcDst = this.squares[sqDst];
            if (vls == null) {
              if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst));
            } else if ((pcDst & pcOppSide) !== 0) {
              mvs.push(MOVE(sqSrc, sqDst));
              vls.push(MVV_LVA(pcDst, 5));
            }
          }
          break;
        case PIECE_ADVISOR:
          for (let i = 0; i < 4; i++) {
            const sqDst = sqSrc + ADVISOR_DELTA[i];
            if (!IN_FORT(sqDst)) continue;
            const pcDst = this.squares[sqDst];
            if (vls == null) {
              if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst));
            } else if ((pcDst & pcOppSide) !== 0) {
              mvs.push(MOVE(sqSrc, sqDst));
              vls.push(MVV_LVA(pcDst, 1));
            }
          }
          break;
        case PIECE_BISHOP:
          for (let i = 0; i < 4; i++) {
            let sqDst = sqSrc + ADVISOR_DELTA[i];
            if (!(IN_BOARD(sqDst) && HOME_HALF(sqDst, this.sdPlayer) &&
              this.squares[sqDst] === 0)) continue;
            sqDst += ADVISOR_DELTA[i];
            const pcDst = this.squares[sqDst];
            if (vls == null) {
              if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst));
            } else if ((pcDst & pcOppSide) !== 0) {
              mvs.push(MOVE(sqSrc, sqDst));
              vls.push(MVV_LVA(pcDst, 1));
            }
          }
          break;
        case PIECE_KNIGHT:
          for (let i = 0; i < 4; i++) {
            const sqPin = sqSrc + KING_DELTA[i];
            if (this.squares[sqPin] > 0) continue;
            for (let j = 0; j < 2; j++) {
              const sqDst = sqSrc + KNIGHT_DELTA[i][j];
              if (!IN_BOARD(sqDst)) continue;
              const pcDst = this.squares[sqDst];
              if (vls == null) {
                if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst));
              } else if ((pcDst & pcOppSide) !== 0) {
                mvs.push(MOVE(sqSrc, sqDst));
                vls.push(MVV_LVA(pcDst, 1));
              }
            }
          }
          break;
        case PIECE_ROOK:
          for (let i = 0; i < 4; i++) {
            const delta = KING_DELTA[i];
            let sqDst = sqSrc + delta;
            while (IN_BOARD(sqDst)) {
              const pcDst = this.squares[sqDst];
              if (pcDst === 0) {
                if (vls == null) mvs.push(MOVE(sqSrc, sqDst));
              } else {
                if ((pcDst & pcOppSide) !== 0) {
                  mvs.push(MOVE(sqSrc, sqDst));
                  if (vls != null) vls.push(MVV_LVA(pcDst, 4));
                }
                break;
              }
              sqDst += delta;
            }
          }
          break;
        case PIECE_CANNON:
          for (let i = 0; i < 4; i++) {
            const delta = KING_DELTA[i];
            let sqDst = sqSrc + delta;
            while (IN_BOARD(sqDst)) {
              const pcDst = this.squares[sqDst];
              if (pcDst === 0) {
                if (vls == null) mvs.push(MOVE(sqSrc, sqDst));
              } else {
                break;
              }
              sqDst += delta;
            }
            sqDst += delta;
            while (IN_BOARD(sqDst)) {
              const pcDst = this.squares[sqDst];
              if (pcDst > 0) {
                if ((pcDst & pcOppSide) !== 0) {
                  mvs.push(MOVE(sqSrc, sqDst));
                  if (vls != null) vls.push(MVV_LVA(pcDst, 4));
                }
                break;
              }
              sqDst += delta;
            }
          }
          break;
        case PIECE_PAWN: {
          const sqDst = SQUARE_FORWARD(sqSrc, this.sdPlayer);
          if (IN_BOARD(sqDst)) {
            const pcDst = this.squares[sqDst];
            if (vls == null) {
              if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst));
            } else if ((pcDst & pcOppSide) !== 0) {
              mvs.push(MOVE(sqSrc, sqDst));
              vls.push(MVV_LVA(pcDst, 2));
            }
          }
          if (AWAY_HALF(sqSrc, this.sdPlayer)) {
            for (let delta = -1; delta <= 1; delta += 2) {
              const sqDst2 = sqSrc + delta;
              if (IN_BOARD(sqDst2)) {
                const pcDst = this.squares[sqDst2];
                if (vls == null) {
                  if ((pcDst & pcSelfSide) === 0) mvs.push(MOVE(sqSrc, sqDst2));
                } else if ((pcDst & pcOppSide) !== 0) {
                  mvs.push(MOVE(sqSrc, sqDst2));
                  vls.push(MVV_LVA(pcDst, 2));
                }
              }
            }
          }
          break;
        }
      }
    }
    return mvs;
  }

  // ---------- 单个走法合法性判定 ----------
  legalMove(mv) {
    const sqSrc = SRC(mv);
    const pcSrc = this.squares[sqSrc];
    const pcSelfSide = SIDE_TAG(this.sdPlayer);
    if ((pcSrc & pcSelfSide) === 0) return false;
    const sqDst = DST(mv);
    const pcDst = this.squares[sqDst];
    if ((pcDst & pcSelfSide) !== 0) return false;
    switch (pcSrc - pcSelfSide) {
      case PIECE_KING:
        return IN_FORT(sqDst) && KING_SPAN(sqSrc, sqDst);
      case PIECE_ADVISOR:
        return IN_FORT(sqDst) && ADVISOR_SPAN(sqSrc, sqDst);
      case PIECE_BISHOP:
        return SAME_HALF(sqSrc, sqDst) && BISHOP_SPAN(sqSrc, sqDst) &&
          this.squares[BISHOP_PIN(sqSrc, sqDst)] === 0;
      case PIECE_KNIGHT: {
        const sqPin = KNIGHT_PIN(sqSrc, sqDst);
        return sqPin !== sqSrc && this.squares[sqPin] === 0;
      }
      case PIECE_ROOK:
      case PIECE_CANNON: {
        let delta;
        if (SAME_RANK(sqSrc, sqDst)) delta = (sqDst < sqSrc ? -1 : 1);
        else if (SAME_FILE(sqSrc, sqDst)) delta = (sqDst < sqSrc ? -16 : 16);
        else return false;
        let sqPin = sqSrc + delta;
        while (sqPin !== sqDst && this.squares[sqPin] === 0) sqPin += delta;
        if (sqPin === sqDst) return pcDst === 0 || pcSrc - pcSelfSide === PIECE_ROOK;
        if (pcDst === 0 || pcSrc - pcSelfSide !== PIECE_CANNON) return false;
        sqPin += delta;
        while (sqPin !== sqDst && this.squares[sqPin] === 0) sqPin += delta;
        return sqPin === sqDst;
      }
      case PIECE_PAWN:
        if (AWAY_HALF(sqDst, this.sdPlayer) && (sqDst === sqSrc - 1 || sqDst === sqSrc + 1)) {
          return true;
        }
        return sqDst === SQUARE_FORWARD(sqSrc, this.sdPlayer);
      default:
        return false;
    }
  }

  // ---------- 是否被将军 ----------
  checked() {
    const pcSelfSide = SIDE_TAG(this.sdPlayer);
    const pcOppSide = OPP_SIDE_TAG(this.sdPlayer);
    for (let sqSrc = 0; sqSrc < 256; sqSrc++) {
      if (this.squares[sqSrc] !== pcSelfSide + PIECE_KING) continue;
      if (this.squares[SQUARE_FORWARD(sqSrc, this.sdPlayer)] === pcOppSide + PIECE_PAWN) {
        return true;
      }
      for (let delta = -1; delta <= 1; delta += 2) {
        if (this.squares[sqSrc + delta] === pcOppSide + PIECE_PAWN) return true;
      }
      for (let i = 0; i < 4; i++) {
        if (this.squares[sqSrc + ADVISOR_DELTA[i]] !== 0) continue;
        for (let j = 0; j < 2; j++) {
          const pcDst = this.squares[sqSrc + KNIGHT_CHECK_DELTA[i][j]];
          if (pcDst === pcOppSide + PIECE_KNIGHT) return true;
        }
      }
      for (let i = 0; i < 4; i++) {
        const delta = KING_DELTA[i];
        let sqDst = sqSrc + delta;
        while (IN_BOARD(sqDst)) {
          const pcDst = this.squares[sqDst];
          if (pcDst > 0) {
            if (pcDst === pcOppSide + PIECE_ROOK || pcDst === pcOppSide + PIECE_KING) {
              return true;
            }
            break;
          }
          sqDst += delta;
        }
        sqDst += delta;
        while (IN_BOARD(sqDst)) {
          const pcDst = this.squares[sqDst];
          if (pcDst > 0) {
            if (pcDst === pcOppSide + PIECE_CANNON) return true;
            break;
          }
          sqDst += delta;
        }
      }
      return false;
    }
    return false;
  }

  isMate() {
    const mvs = this.generateMoves(null);
    for (let i = 0; i < mvs.length; i++) {
      if (this.makeMove(mvs[i])) {
        this.undoMakeMove();
        return false;
      }
    }
    return true;
  }

  mateValue() { return this.distance - MATE_VALUE; }
  banValue() { return this.distance - BAN_VALUE; }
  drawValue() { return (this.distance & 1) === 0 ? -DRAW_VALUE : DRAW_VALUE; }

  evaluate() {
    const vl = (this.sdPlayer === 0
      ? this.vlWhite - this.vlBlack
      : this.vlBlack - this.vlWhite) + ADVANCED_VALUE;
    return vl === this.drawValue() ? vl - 1 : vl;
  }

  nullOkay() {
    return (this.sdPlayer === 0 ? this.vlWhite : this.vlBlack) > NULL_OKAY_MARGIN;
  }

  nullSafe() {
    return (this.sdPlayer === 0 ? this.vlWhite : this.vlBlack) > NULL_SAFE_MARGIN;
  }

  inCheck() { return this.chkList[this.chkList.length - 1]; }
  captured() { return this.pcList[this.pcList.length - 1] > 0; }

  repValue(vlRep) {
    const vlReturn = ((vlRep & 2) === 0 ? 0 : this.banValue()) +
      ((vlRep & 4) === 0 ? 0 : -this.banValue());
    return vlReturn === 0 ? this.drawValue() : vlReturn;
  }

  repStatus(recur_) {
    let recur = recur_;
    let selfSide = false;
    let perpCheck = true;
    let oppPerpCheck = true;
    let index = this.mvList.length - 1;
    while (this.mvList[index] > 0 && this.pcList[index] === 0) {
      if (selfSide) {
        perpCheck = perpCheck && this.chkList[index];
        if (this.keyList[index] === this.zobristKey) {
          recur--;
          if (recur === 0) {
            return 1 + (perpCheck ? 2 : 0) + (oppPerpCheck ? 4 : 0);
          }
        }
      } else {
        oppPerpCheck = oppPerpCheck && this.chkList[index];
      }
      selfSide = !selfSide;
      index--;
    }
    return 0;
  }

  mirror() {
    const pos = new Position();
    pos.clearBoard();
    for (let sq = 0; sq < 256; sq++) {
      const pc = this.squares[sq];
      if (pc > 0) pos.addPiece(MIRROR_SQUARE(sq), pc);
    }
    if (this.sdPlayer === 1) pos.changeSide();
    return pos;
  }

  // ---------- 开局库查询 ----------
  bookMove(bookDat) {
    if (typeof bookDat !== "object" || bookDat.length === 0) return 0;
    let mirror = false;
    let lock = this.zobristLock >>> 1;
    let index = binarySearch(bookDat, lock);
    if (index < 0) {
      mirror = true;
      lock = this.mirror().zobristLock >>> 1;
      index = binarySearch(bookDat, lock);
    }
    if (index < 0) return 0;
    index--;
    while (index >= 0 && bookDat[index][0] === lock) index--;
    const mvs = [], vls = [];
    let value = 0;
    index++;
    while (index < bookDat.length && bookDat[index][0] === lock) {
      let mv = bookDat[index][1];
      mv = (mirror ? MIRROR_MOVE(mv) : mv);
      if (this.legalMove(mv)) {
        mvs.push(mv);
        const vl = bookDat[index][2];
        vls.push(vl);
        value += vl;
      }
      index++;
    }
    if (value === 0) return 0;
    value = Math.floor(Math.random() * value);
    for (index = 0; index < mvs.length; index++) {
      value -= vls[index];
      if (value < 0) break;
    }
    return mvs[index];
  }

  historyIndex(mv) {
    return ((this.squares[SRC(mv)] - 8) << 8) + DST(mv);
  }
}
