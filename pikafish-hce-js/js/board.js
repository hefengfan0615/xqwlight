/*
 * board.js - UI Board Renderer
 */

"use strict";

var PIECE_IMG = {
  8:  "rk.gif",  9:  "ra.gif",  10: "rb.gif",  11: "rn.gif",
  12: "rr.gif",  13: "rc.gif",  14: "rp.gif",
  16: "bk.gif",  17: "ba.gif",  18: "bb.gif",  19: "bn.gif",
  20: "br.gif",  21: "bc.gif",  22: "bp.gif"
};

function Board(container, imagePath) {
  this.container = container;
  this.imagePath = imagePath || "";
  this.pos = new Position();
  this.sqSelected = -1;
  this.movelist = [];
  this.lastMove = 0;
  this.onSelect = null;
  this.images = {};
  this._build();
}

Board.prototype._build = function() {
  var self = this;
  this.container.innerHTML = "";
  this.container.style.position = "relative";
  this.container.style.width  = "527px";
  this.container.style.height = "567px";
  this.container.style.background = "#f3d18b";
  this.container.style.userSelect = "none";

  this.canvas = document.createElement("canvas");
  this.canvas.width  = 527;
  this.canvas.height = 567;
  this.canvas.style.position = "absolute";
  this.canvas.style.top  = "0";
  this.canvas.style.left = "0";
  this.canvas.style.zIndex = "0";
  this.container.appendChild(this.canvas);

  this.layerPieces = document.createElement("div");
  this.layerPieces.style.position = "absolute";
  this.layerPieces.style.top  = "0";
  this.layerPieces.style.left = "0";
  this.layerPieces.style.width  = "527px";
  this.layerPieces.style.height = "567px";
  this.layerPieces.style.zIndex = "1";
  this.container.appendChild(this.layerPieces);

  this.layerInfo = document.createElement("div");
  this.layerInfo.style.position = "absolute";
  this.layerInfo.style.top  = "0";
  this.layerInfo.style.left = "0";
  this.layerInfo.style.width  = "527px";
  this.layerInfo.style.height = "567px";
  this.layerInfo.style.zIndex = "2";
  this.layerInfo.style.pointerEvents = "none";
  this.container.appendChild(this.layerInfo);

  this.layerInfo.innerHTML =
    '<div style="position:absolute;left:6px;top:0;width:24px;height:567px;' +
    'display:flex;flex-direction:column;justify-content:space-between;' +
    'align-items:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;padding:6px 0;">' +
      '<span>9</span><span>8</span><span>7</span><span>6</span><span>5</span>' +
      '<span>4</span><span>3</span><span>2</span><span>1</span><span>0</span>' +
    '</div>' +
    '<div style="position:absolute;left:0;top:0;width:527px;height:567px;pointer-events:none;">' +
      '<div style="position:absolute;left:50px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">a</div>' +
      '<div style="position:absolute;left:100px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">b</div>' +
      '<div style="position:absolute;left:150px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">c</div>' +
      '<div style="position:absolute;left:200px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">d</div>' +
      '<div style="position:absolute;left:250px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">e</div>' +
      '<div style="position:absolute;left:300px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">f</div>' +
      '<div style="position:absolute;left:350px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">g</div>' +
      '<div style="position:absolute;left:400px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">h</div>' +
      '<div style="position:absolute;left:450px;top:553px;width:50px;text-align:center;font-family:Georgia,serif;font-size:13px;color:#4a2c14;">i</div>' +
    '</div>';

  this._drawBoard();

  for (var k in PIECE_IMG) {
    var img = new Image();
    img.src = this.imagePath + PIECE_IMG[k];
    this.images[k] = img;
  }

  this.layerPieces.addEventListener("click", function(e) {
    self._onClick(e);
  });
};

Board.prototype._drawBoard = function() {
  var ctx = this.canvas.getContext("2d");
  ctx.fillStyle = "#f3d18b";
  ctx.fillRect(0, 0, 527, 567);

  ctx.strokeStyle = "#3a2412";
  ctx.lineWidth = 1.4;
  for (var r = 0; r < 10; r++) {
    var y = 30 + r * 53;
    ctx.beginPath();
    ctx.moveTo(50, y);
    ctx.lineTo(476, y);
    ctx.stroke();
  }
  for (var f = 0; f < 9; f++) {
    var x = 50 + f * 53;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x, 543);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(50, 30 + 0*53); ctx.lineTo(50 + 4*53, 30 + 4*53);
  ctx.moveTo(50 + 8*53, 30 + 0*53); ctx.lineTo(50 + 4*53, 30 + 4*53);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(50, 30 + 5*53); ctx.lineTo(50 + 4*53, 30 + 9*53);
  ctx.moveTo(50 + 8*53, 30 + 5*53); ctx.lineTo(50 + 4*53, 30 + 9*53);
  ctx.stroke();

  ctx.fillStyle = "#3a2412";
  ctx.font = "italic 22px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("楚 河",  170, 30 + 4*53 + 25);
  ctx.fillText("漢 界",  356, 30 + 4*53 + 25);
};

Board.prototype._sqPixel = function(sq) {
  var f = FILE_X(sq) - 3;
  var r = RANK_Y(sq);
  return { x: 50 + f * 53, y: 30 + r * 53 };
};

Board.prototype._pixelToSq = function(px, py) {
  var f = Math.round((px - 50) / 53);
  var r = Math.round((py - 30) / 53);
  if (f < 0 || f > 8 || r < 0 || r > 9) return -1;
  return COORD_XY(f + 3, r);
};

Board.prototype._onClick = function(e) {
  var rect = this.layerPieces.getBoundingClientRect();
  var px = e.clientX - rect.left;
  var py = e.clientY - rect.top;
  var sq = this._pixelToSq(px, py);
  if (sq < 0) return;
  if (this.sqSelected < 0) {
    var pc = this.pos.squares[sq];
    if (pc === 0) return;
    var sd = pc < 16 ? 0 : 1;
    if (sd !== this.pos.sdPlayer) return;
    this.sqSelected = sq;
    this.movelist = this.pos.generateMoves(null).filter(function(m) {
      return SRC(m) === sq;
    });
    this._renderPieces();
  } else {
    if (sq === this.sqSelected) {
      this.sqSelected = -1; this.movelist = []; this._renderPieces(); return;
    }
    var found = null;
    for (var i = 0; i < this.movelist.length; i++) {
      if (DST(this.movelist[i]) === sq) { found = this.movelist[i]; break; }
    }
    if (found !== null) {
      var mv = found;
      this.sqSelected = -1; this.movelist = [];
      this.lastMove = mv;
      this.pos.makeMove(mv);
      this._renderPieces();
      if (this.onSelect) this.onSelect(mv);
    } else {
      var pc = this.pos.squares[sq];
      if (pc > 0) {
        var sd = pc < 16 ? 0 : 1;
        if (sd === this.pos.sdPlayer) {
          this.sqSelected = sq;
          this.movelist = this.pos.generateMoves(null).filter(function(m) { return SRC(m) === sq; });
          this._renderPieces();
        } else { this.sqSelected = -1; this.movelist = []; this._renderPieces(); }
      } else { this.sqSelected = -1; this.movelist = []; this._renderPieces(); }
    }
  }
};

Board.prototype._renderPieces = function() {
  while (this.layerPieces.firstChild) this.layerPieces.removeChild(this.layerPieces.firstChild);

  for (var sq = 0; sq < 256; sq++) {
    var pc = this.pos.squares[sq];
    if (pc === 0) continue;
    if (!IN_BOARD(sq)) continue;
    var p = this._sqPixel(sq);
    var img = this.images[pc];
    if (!img) continue;
    var div = document.createElement("div");
    div.style.position = "absolute";
    div.style.left = (p.x - 25) + "px";
    div.style.top  = (p.y - 25) + "px";
    div.style.width  = "50px";
    div.style.height = "50px";
    div.style.background = "url('" + img.src + "') center/contain no-repeat";
    div.style.cursor = "pointer";
    this.layerPieces.appendChild(div);
  }

  if (this.sqSelected >= 0) {
    var p = this._sqPixel(this.sqSelected);
    var hl = document.createElement("div");
    hl.style.position = "absolute";
    hl.style.left = (p.x - 24) + "px";
    hl.style.top  = (p.y - 24) + "px";
    hl.style.width  = "48px";
    hl.style.height = "48px";
    hl.style.border = "3px solid #ffb000";
    hl.style.borderRadius = "50%";
    hl.style.boxSizing = "border-box";
    hl.style.pointerEvents = "none";
    this.layerPieces.appendChild(hl);
  }
  for (var i = 0; i < this.movelist.length; i++) {
    var dst = DST(this.movelist[i]);
    var p = this._sqPixel(dst);
    var hl = document.createElement("div");
    hl.style.position = "absolute";
    hl.style.left = (p.x - 8) + "px";
    hl.style.top  = (p.y - 8) + "px";
    hl.style.width  = "16px";
    hl.style.height = "16px";
    hl.style.background = "rgba(0,180,0,0.55)";
    hl.style.borderRadius = "50%";
    hl.style.pointerEvents = "none";
    this.layerPieces.appendChild(hl);
  }
  if (this.lastMove) {
    var src = SRC(this.lastMove), dst = DST(this.lastMove);
    var p1 = this._sqPixel(src), p2 = this._sqPixel(dst);
    var ln = document.createElement("div");
    ln.style.position = "absolute";
    ln.style.left = Math.min(p1.x, p2.x) + "px";
    ln.style.top  = Math.min(p1.y, p2.y) + "px";
    ln.style.width  = Math.abs(p2.x - p1.x) + "px";
    ln.style.height = Math.abs(p2.y - p1.y) + "px";
    ln.style.borderLeft = "3px solid #c83838";
    ln.style.borderTop  = "3px solid #c83838";
    ln.style.boxSizing = "border-box";
    ln.style.pointerEvents = "none";
    this.layerPieces.appendChild(ln);
  }
};

Board.prototype.setPosition = function(pos) { this.pos = pos; this._renderPieces(); };
Board.prototype.setLastMove = function(mv) { this.lastMove = mv; this._renderPieces(); };
Board.prototype.refresh = function() { this._renderPieces(); };
