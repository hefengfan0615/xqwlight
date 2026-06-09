/*
 * Chinese Chess - Opening Book (Simplified)
 * Provides basic opening moves for low depth search
 */

// Opening book entries: FEN fragment (first 20 chars) → [good moves]
// Using simplified representation
const BookData = {
  // Initial position
  "rnbakabnr/9/1c5c1/p": ["b2b0", "h2h0", "b0a2", "h0g2", "a0a1", "i0i1", "b2e2", "h2e2"],
  // After 炮二平五 (central cannon)
  "rnbakabnr/9/1c5c1/p": ["b2e2", "h2e2"],
};

// Simple opening book: maps key (FEN without side) to array of move strings
const book = new Map();

function initBook() {
  for (const [fenPart, moves] of Object.entries(BookData)) {
    book.set(fenPart, moves);
  }
}

initBook();

/**
 * Probe opening book for the given position
 * @param {string} fen - FEN string of current position
 * @returns {string|null} - UCI move string or null
 */
export function probeBook(fen) {
  // Try to find partial match
  for (const [key, moves] of book) {
    if (fen.startsWith(key)) {
      // Pick a random move from the book
      return moves[Math.floor(Math.random() * moves.length)];
    }
  }
  return null;
}

/**
 * Get all book moves for a position
 */
export function getBookMoves(fen) {
  for (const [key, moves] of book) {
    if (fen.startsWith(key)) {
      return moves;
    }
  }
  return [];
}