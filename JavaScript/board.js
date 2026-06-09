/*
 * Chinese Chess - Board Display (Canvas-based)
 * Renders the chess board and pieces using HTML5 Canvas
 */

import { Position } from './position.js';
import {
  NO_PIECE, WHITE, BLACK,
  colorOf, typeOf, fileOf, rankOf, makeSquare,
  FILE_NB, RANK_NB,
  fromSq, toSq, makeMove, MOVE_NONE,
  ROOK, ADVISOR, CANNON, PAWN, KNIGHT, BISHOP, KING,
  W_KING, W_ADVISOR, W_BISHOP, W_KNIGHT, W_ROOK, W_CANNON, W_PAWN,
  B_KING, B_ADVISOR, B_BISHOP, B_KNIGHT, B_ROOK, B_CANNON, B_PAWN,
} from './pikafish_types.js';

// Board rendering constants
const BOARD_SIZE = 520;        // Canvas size
// Chinese chess: 9 columns (8 gaps), 10 rows (9 gaps)
// Use the larger gap count for uniform square sizing to fit vertically
const MARGIN = 30;             // Margin from edge
const SQUARE_SIZE = Math.floor((BOARD_SIZE - 2 * MARGIN) / 9); // 51px for 10 ranks
const OFFSET_X = Math.floor((BOARD_SIZE - 8 * SQUARE_SIZE) / 2); // Center horizontally
const OFFSET_Y = MARGIN;       // Top margin for 10th rank

// Piece labels (Chinese characters)
const PIECE_LABELS = {
  [W_KING]: '帅', [W_ADVISOR]: '仕', [W_BISHOP]: '相', [W_KNIGHT]: '馬',
  [W_ROOK]: '車', [W_CANNON]: '炮', [W_PAWN]: '兵',
  [B_KING]: '将', [B_ADVISOR]: '士', [B_BISHOP]: '象', [B_KNIGHT]: '馬',
  [B_ROOK]: '車', [B_CANNON]: '砲', [B_PAWN]: '卒',
};

export class Board {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.squareSize = SQUARE_SIZE;
    this.offsetX = OFFSET_X;
    this.offsetY = OFFSET_Y;
    this.animated = true;
    this.soundEnabled = true;
    this.selectedSq = -1;
    this.legalMoves = [];
    this.lastMoveFrom = -1;
    this.lastMoveTo = -1;
    this.flipped = false;
    this.pieceImages = {};
    this.imagesLoaded = false;
    this.animFrame = null;

    this.initCanvas();
    this.loadImages();
  }

  initCanvas() {
    this.canvas.width = BOARD_SIZE;
    this.canvas.height = BOARD_SIZE;
  }

  loadImages() {
    // Use canvas for drawing instead of images for portability
    this.imagesLoaded = true;
  }

  /**
   * Convert board coordinates to canvas coordinates
   */
  boardToCanvas(sq) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    let x, y;

    if (this.flipped) {
      x = this.offsetX + (FILE_NB - 1 - f) * this.squareSize;
      y = this.offsetY + r * this.squareSize;
    } else {
      x = this.offsetX + f * this.squareSize;
      y = this.offsetY + (RANK_NB - 1 - r) * this.squareSize;
    }
    return { x, y };
  }

  canvasToBoard(cx, cy) {
    const x = cx - this.offsetX;
    const y = cy - this.offsetY;
    let f = Math.round(x / this.squareSize);
    let r = Math.round(y / this.squareSize);

    if (this.flipped) {
      f = FILE_NB - 1 - f;
    } else {
      r = RANK_NB - 1 - r;
    }

    if (f < 0 || f >= FILE_NB || r < 0 || r >= RANK_NB) return -1;
    return makeSquare(f, r);
  }

  /**
   * Draw the full board
   */
  draw(pos, lastMove = null) {
    const ctx = this.ctx;

    // Clear
    ctx.fillStyle = '#f0d9b5';
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      this.offsetX - 2, this.offsetY - 2,
      (FILE_NB - 1) * this.squareSize + 4,
      (RANK_NB - 1) * this.squareSize + 4
    );

    // Draw grid
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;

    for (let f = 0; f < FILE_NB; f++) {
      const x = this.offsetX + f * this.squareSize;
      ctx.beginPath();
      ctx.moveTo(x, this.offsetY);
      ctx.lineTo(x, this.offsetY + (RANK_NB - 1) * this.squareSize);
      ctx.stroke();
    }

    for (let r = 0; r < RANK_NB; r++) {
      const y = this.offsetY + r * this.squareSize;
      ctx.beginPath();
      ctx.moveTo(this.offsetX, y);
      ctx.lineTo(this.offsetX + (FILE_NB - 1) * this.squareSize, y);
      ctx.stroke();
    }

    // Draw palace diagonals
    this.drawPalaceDiagonals(ctx, 0); // Top palace (black)
    this.drawPalaceDiagonals(ctx, 7); // Bottom palace (white)

    // Draw river text
    ctx.fillStyle = '#000';
    ctx.font = 'bold 18px serif';
    ctx.textAlign = 'center';
    const riverY = this.offsetY + 4.5 * this.squareSize;
    ctx.fillText('楚  河', this.offsetX + 1.5 * this.squareSize, riverY + 6);
    ctx.fillText('汉  界', this.offsetX + 6.5 * this.squareSize, riverY + 6);

    // Highlight last move
    if (lastMove) {
      this.highlightSquare(ctx, fromSq(lastMove), 'rgba(255,255,0,0.4)');
      this.highlightSquare(ctx, toSq(lastMove), 'rgba(255,255,0,0.4)');
    }

    // Highlight selected square
    if (this.selectedSq >= 0) {
      this.highlightSquare(ctx, this.selectedSq, 'rgba(0,200,0,0.3)');
    }

    // Highlight legal move destinations
    for (const m of this.legalMoves) {
      const to = toSq(m);
      const { x, y } = this.boardToCanvas(to);
      const pc = pos.board[to];
      if (pc !== NO_PIECE) {
        // Capture hint
        ctx.strokeStyle = 'rgba(255,0,0,0.6)';
        ctx.lineWidth = 3;
        const r = this.squareSize / 2 - 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Move hint
        ctx.fillStyle = 'rgba(0,150,0,0.4)';
        const r = 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw pieces
    for (let sq = 0; sq < 90; sq++) {
      const pc = pos.board[sq];
      if (pc === NO_PIECE) continue;
      this.drawPiece(ctx, sq, pc);
    }
  }

  drawPalaceDiagonals(ctx, startRank) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    const x1 = this.offsetX + 3 * this.squareSize;
    const y1 = this.offsetY + startRank * this.squareSize;
    const x2 = this.offsetX + 5 * this.squareSize;
    const y2 = this.offsetY + (startRank + 2) * this.squareSize;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y1);
    ctx.lineTo(x1, y2);
    ctx.stroke();
  }

  highlightSquare(ctx, sq, color) {
    const { x, y } = this.boardToCanvas(sq);
    ctx.fillStyle = color;
    ctx.fillRect(
      x - this.squareSize / 2 + 1,
      y - this.squareSize / 2 + 1,
      this.squareSize - 2,
      this.squareSize - 2
    );
  }

  drawPiece(ctx, sq, pc) {
    const { x, y } = this.boardToCanvas(sq);
    const radius = this.squareSize / 2 - 3;

    // Piece circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fce4c8';
    ctx.fill();
    ctx.strokeStyle = colorOf(pc) === WHITE ? '#c00' : '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(x, y, radius - 3, 0, Math.PI * 2);
    ctx.strokeStyle = colorOf(pc) === WHITE ? '#c00' : '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Piece character
    const label = PIECE_LABELS[pc] || '?';
    ctx.fillStyle = colorOf(pc) === WHITE ? '#c00' : '#000';
    ctx.font = `bold ${radius}px "楷体", "KaiTi", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 1);
  }

  /**
   * Set selected square and legal destinations
   */
  selectSquare(sq, legalMoves) {
    this.selectedSq = sq;
    this.legalMoves = legalMoves || [];
  }

  clearSelection() {
    this.selectedSq = -1;
    this.legalMoves = [];
  }

  setSound(enabled) {
    this.soundEnabled = enabled;
  }
}