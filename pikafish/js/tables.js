"use strict";

// ============================================================
// Pikafish JS - Tables
// Transposition Table, History Table, Killer Table
// ============================================================

const T = require('./types');

// Transposition Table Entry
class TTEntry {
  constructor() {
    this.key = 0;
    this.depth = 0;
    this.flag = T.BOUND_NONE;
    this.value = T.VALUE_NONE;
    this.eval = T.VALUE_NONE;
    this.move = T.MOVE_NONE;
    this.age = 0;
  }

  save(key, depth, flag, value, eval_, move, age) {
    if (this.key !== key || flag === T.BOUND_EXACT || depth >= this.depth - 3) {
      this.key = key;
      this.depth = depth;
      this.flag = flag;
      this.value = value;
      this.eval = eval_;
      this.move = move;
      this.age = age;
    }
  }
}

// Transposition Table
class TranspositionTable {
  constructor(size = 1 << 18) { // ~256K entries
    this.size = size;
    this.mask = this.size - 1;
    this.entries = [];
    for (let i = 0; i < this.size; i++) {
      this.entries.push(new TTEntry());
    }
    this.age = 0;
  }

  probe(key) {
    const entry = this.entries[key & this.mask];
    if (entry.key === (key & 0xFFFFFFFF) && entry.depth > 0) {
      return entry;
    }
    return null;
  }

  store(key, depth, flag, value, eval_, move) {
    const entry = this.entries[key & this.mask];
    entry.save(key & 0xFFFFFFFF, depth, flag, value, eval_, move, this.age);
  }

  newSearch() {
    this.age++;
  }
}

// History Table (Butterfly history)
class HistoryTable {
  constructor() {
    this.table = new Int32Array(2 * T.SQUARE_NB * T.SQUARE_NB);
    this.max = 1000000;
  }

  get(color, from, to) {
    return this.table[color * T.SQUARE_NB * T.SQUARE_NB + from * T.SQUARE_NB + to];
  }

  update(color, from, to, bonus) {
    const idx = color * T.SQUARE_NB * T.SQUARE_NB + from * T.SQUARE_NB + to;
    const current = this.table[idx];
    const scaled = bonus - (current * Math.abs(bonus)) / this.max;
    this.table[idx] = this.table[idx] + scaled;
  }
}

// Killer Table
class KillerTable {
  constructor(maxPly = T.MAX_PLY) {
    this.table = [];
    for (let i = 0; i < maxPly; i++) {
      this.table.push([T.MOVE_NONE, T.MOVE_NONE]);
    }
  }

  get(ply) {
    return this.table[ply];
  }

  set(ply, move) {
    const killers = this.table[ply];
    if (killers[0] !== move) {
      killers[1] = killers[0];
      killers[0] = move;
    }
  }

  clear() {
    for (let i = 0; i < this.table.length; i++) {
      this.table[i] = [T.MOVE_NONE, T.MOVE_NONE];
    }
  }
}

// Counter-move table
class CounterMoveTable {
  constructor() {
    this.table = new Int32Array(T.SQUARE_NB * T.SQUARE_NB);
  }

  get(from, to) {
    return this.table[from * T.SQUARE_NB + to];
  }

  set(from, to, move) {
    this.table[from * T.SQUARE_NB + to] = move;
  }
}

// Continuation history
class ContinuationHistory {
  constructor() {
    this.table = new Int32Array(32 * T.SQUARE_NB * T.SQUARE_NB);
  }

  get(pc, sq, contPc, contSq) {
    return this.table[pc * T.SQUARE_NB * T.SQUARE_NB + sq * T.SQUARE_NB + contSq];
  }

  update(pc, sq, contPc, contSq, bonus) {
    const idx = pc * T.SQUARE_NB * T.SQUARE_NB + sq * T.SQUARE_NB + contSq;
    const current = this.table[idx];
    const scaled = bonus - (current * Math.abs(bonus)) / 1000000;
    this.table[idx] = this.table[idx] + scaled;
  }
}

// Capture history
class CaptureHistory {
  constructor() {
    this.table = new Int32Array(32 * T.SQUARE_NB * 8);
  }

  get(pc, to, captPt) {
    return this.table[pc * T.SQUARE_NB * 8 + to * 8 + captPt];
  }

  update(pc, to, captPt, bonus) {
    const idx = pc * T.SQUARE_NB * 8 + to * 8 + captPt;
    const current = this.table[idx];
    const scaled = bonus - (current * Math.abs(bonus)) / 1000000;
    this.table[idx] = this.table[idx] + scaled;
  }
}

module.exports = {
  TranspositionTable,
  HistoryTable,
  KillerTable,
  CounterMoveTable,
  ContinuationHistory,
  CaptureHistory
};
