import type { GameState, Player, Position, SkillId } from './types';
import { BOARD_SIZE, WIN_LENGTH, SKILLS, BREED_RANGE } from './constants';
import {
  placePiece, chooseScore, chooseMP, eliminatePiece, swapPieces, breedPieces, deductMP, nextTurn,
  opponentOf, checkWin,
} from './gameLogic';
import type { CellState } from './types';

const DEBUG = true;
function log(msg: string, data?: unknown) { if (DEBUG) console.log(`[AI] ${msg}`, data ?? ''); }

/** Score an empty cell for the given player: max consecutive length if placed there. */
function cellScore(board: CellState[][], row: number, col: number, player: Player): number {
  const copy = board.map(r => [...r]);
  copy[row][col] = player;
  const wins = checkWin(copy, row, col);
  if (wins.length > 0) return WIN_LENGTH + wins.length;
  let maxLen = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let len = 1;
    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && copy[r][c] === player) len++;
      else break;
    }
    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && copy[r][c] === player) len++;
      else break;
    }
    if (len > maxLen) maxLen = len;
  }
  return maxLen;
}

/** Find best move for the AI player. */
function findBestMove(board: CellState[][], ai: Player): Position | null {
  const opp = opponentOf(ai);
  let bestPos: Position | null = null;
  let bestScore = -1;

  const candidateSet = new Set<string>();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 'empty') {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 'empty') {
              candidateSet.add(`${nr},${nc}`);
            }
          }
        }
      }
    }
  }

  if (candidateSet.size === 0) {
    log('board empty, playing center');
    return { row: 7, col: 7 };
  }

  for (const key of candidateSet) {
    const [r, c] = key.split(',').map(Number);
    const aiScore = cellScore(board, r, c, ai);
    const oppScore = cellScore(board, r, c, opp);

    if (aiScore >= WIN_LENGTH) {
      log(`winning move at ${r},${c}`);
      return { row: r, col: c };
    }
    if (oppScore >= WIN_LENGTH && bestScore < 1000) {
      bestScore = 1000;
      bestPos = { row: r, col: c };
      continue;
    }
    // Base score with ±15% jitter so AI varies between similarly-scored moves
    const base = Math.pow(aiScore, 3) + Math.pow(oppScore, 2) * 2;
    const score = base * (0.85 + Math.random() * 0.3);
    if (score > bestScore && bestScore < 1000) {
      bestScore = score;
      bestPos = { row: r, col: c };
    }
  }

  if (!bestPos) {
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++)
        if (board[r][c] === 'empty') return { row: r, col: c };
  }
  return bestPos;
}

/** Pick best opponent piece to remove (highest cellScore = most threatening). */
function findTopOppPiece(board: CellState[][], opp: Player): Position | null {
  let best: Position | null = null;
  let bestScore = -1;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === opp) {
        const score = cellScore(board, r, c, opp);
        if (score > bestScore) { bestScore = score; best = { row: r, col: c }; }
      }
    }
  }
  return best;
}

/** Find a friendly piece with at least 2 empty cells in its 3x3 range. */
function findBreedSeed(board: CellState[][], ai: Player): Position | null {
  const half = Math.floor(BREED_RANGE / 2);
  const candidates: { pos: Position; empty: number }[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== ai) continue;
      let empty = 0;
      for (let dr = -half; dr <= half; dr++) {
        for (let dc = -half; dc <= half; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === 'empty') empty++;
        }
      }
      if (empty >= 2) candidates.push({ pos: { row: r, col: c }, empty });
    }
  }

  if (candidates.length === 0) return null;
  // Prefer pieces with more empty space around them
  candidates.sort((a, b) => b.empty - a.empty);
  return candidates[0].pos;
}

/** Find swap positions: AI's worst piece swapped with opponent's best. */
function findSwapPositions(board: CellState[][], ai: Player): { pos1: Position; pos2: Position } | null {
  const opp = opponentOf(ai);
  let bestOpp: Position | null = null, bestOppScore = -1;
  let worstAi: Position | null = null, worstAiScore = Infinity;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === opp) {
        const s = cellScore(board, r, c, opp);
        if (s > bestOppScore) { bestOppScore = s; bestOpp = { row: r, col: c }; }
      } else if (board[r][c] === ai) {
        const s = cellScore(board, r, c, ai);
        if (s < worstAiScore) { worstAiScore = s; worstAi = { row: r, col: c }; }
      }
    }
  }
  if (bestOpp && worstAi) return { pos1: worstAi, pos2: bestOpp };
  return null;
}

/** Decide whether to use a skill. */
function shouldUseSkill(state: GameState, ai: Player): SkillId | null {
  const mp = state.players[ai].mp;
  const opp = opponentOf(ai);
  const board = state.board;

  // Higher base chance to use skills overall
  if (Math.random() > 0.35) return null;

  let oppCount = 0;
  let aiCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === opp) oppCount++;
      else if (board[r][c] === ai) aiCount++;
    }
  }

  // Check if opponent has a near-win (4-in-a-row) anywhere
  let oppHasNearWin = false;
  if (mp >= 4 && oppCount >= 4) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === 'empty' && cellScore(board, r, c, opp) >= 4) {
          oppHasNearWin = true; break;
        }
      }
      if (oppHasNearWin) break;
    }
  }

  // === Priority 1: 交换 (3MP) — cheapest, most versatile ===
  // Use proactively when MP is moderate and board has pieces to work with
  if (mp >= 3 && oppCount >= 3 && aiCount >= 3) {
    if (Math.random() < 0.5) { log('using swap'); return 'swap'; }
  }

  // === Priority 2: 剔除 (4MP) — break opponent near-win ===
  if (oppHasNearWin) {
    log('using eliminate to break opponent threat');
    return 'eliminate';
  }

  // === Priority 3: 繁殖 (5MP) — expand when safe ===
  if (mp >= 5 && !oppHasNearWin) {
    const seed = findBreedSeed(board, ai);
    if (seed && Math.random() < 0.5) {
      log(`using breed at seed ${seed.row},${seed.col}`);
      return 'breed';
    }
  }

  // === Priority 4: 剔除 (4MP) — aggressive removal when MP is plentiful ===
  if (mp >= 5 && oppCount > 4 && Math.random() < 0.4) {
    log('using eliminate aggressively');
    return 'eliminate';
  }

  // === Fallback: 交换 as cheap option when nothing else fires ===
  if (mp >= 3 && oppCount >= 2 && aiCount >= 2 && Math.random() < 0.4) {
    log('using swap as fallback');
    return 'swap';
  }

  return null;
}

/** AI five-in-a-row decision. */
function aiFiveChoice(state: GameState): GameState {
  const ai = state.currentPlayer;
  const opp = opponentOf(ai);
  const aiScore = state.players[ai].score;
  const oppScore = state.players[opp].score;
  const multiplier = state.fivePositions.length;
  const timeLeft = state.gameTimeRemaining;
  const newScore = aiScore + multiplier;

  if (newScore - oppScore >= WIN_LENGTH) {
    log('five_choice: SCORE (win outright)');
    return chooseScore(state);
  }
  if (newScore >= 2 && newScore > oppScore && timeLeft < 420) {
    if (Math.random() < 0.7) { log('five_choice: SCORE (close to winning)'); return chooseScore(state); }
  }
  if (aiScore < oppScore && timeLeft < 300) {
    log('five_choice: SCORE (behind, time pressure)');
    return chooseScore(state);
  }
  if (timeLeft < 120) {
    const pick = Math.random() < 0.85 ? 'score' : 'mp';
    log(`five_choice: time low, ${pick}`);
    return pick === 'score' ? chooseScore(state) : chooseMP(state);
  }
  if (timeLeft < 420) {
    const pick = Math.random() < 0.5 ? 'score' : 'mp';
    log(`five_choice: mid-game, ${pick}`);
    return pick === 'score' ? chooseScore(state) : chooseMP(state);
  }
  const pick = Math.random() < 0.35 ? 'score' : 'mp';
  log(`five_choice: early, ${pick}`);
  return pick === 'score' ? chooseScore(state) : chooseMP(state);
}

/** Main AI entry point. */
export function aiDecide(state: GameState): GameState {
  const ai = state.currentPlayer;
  log(`turn: ${ai}, phase: ${state.phase}, mp: ${state.players[ai].mp}`);

  if (state.phase === 'five_choice') {
    log('resolving five_choice');
    return aiFiveChoice(state);
  }

  if (state.phase === 'skill_targeting') {
    const opp = opponentOf(ai);
    log(`resolving targeting: ${state.targetingSkill}, step ${state.targetingStep}`);

    // --- Eliminate (2-step targeting) ---
    if (state.targetingSkill === 'eliminate') {
      // Deduct MP on first pick
      const s = state.eliminatedCount === 0 ? deductMP(state, 4) : state;
      const target = findTopOppPiece(s.board, opp);
      if (target) {
        log(`eliminate target ${state.eliminatedCount + 1}/2: ${target.row},${target.col}`);
        const afterElim = eliminatePiece(s, target);
        if (afterElim.phase === 'five_choice') return afterElim;
        if (afterElim.eliminatedCount >= 2) return nextTurn(afterElim);
        return afterElim; // stay in targeting for second pick
      }
      log('eliminate: no target found, cancelling');
      return nextTurn(s);
    }

    // --- Swap (2-step targeting) ---
    if (state.targetingSkill === 'swap') {
      if (state.targetingStep === 0) {
        const target = findTopOppPiece(state.board, opp);
        if (target) {
          log(`swap first pick: ${target.row},${target.col}`);
          return { ...state, targetingStep: 1, targetingFirst: target };
        }
      } else {
        const swap = findSwapPositions(state.board, ai);
        if (swap) {
          log(`swap: (${swap.pos1.row},${swap.pos1.col}) <-> (${swap.pos2.row},${swap.pos2.col})`);
          let s = deductMP(state, 3);
          s = swapPieces(s, swap.pos1, swap.pos2);
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }
      }
      log('swap: fallback, cancelling');
      return nextTurn(state);
    }

    // --- Breed (1-step targeting: pick seed, auto-spawn) ---
    if (state.targetingSkill === 'breed') {
      const seed = findBreedSeed(state.board, ai);
      if (seed) {
        log(`breed seed: ${seed.row},${seed.col}`);
        let s = deductMP(state, 5);
        s = breedPieces(s, seed);
        return s.phase === 'five_choice' ? s : nextTurn(s);
      }
      log('breed: no valid seed found, cancelling');
      return nextTurn(state);
    }

    log('targeting fallback');
    return nextTurn(state);
  }

  // Decide: skill or place piece
  const skillChoice = shouldUseSkill(state, ai);

  if (skillChoice === 'breed') {
    return { ...state, phase: 'skill_targeting', targetingSkill: 'breed', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
  }
  if (skillChoice === 'swap') {
    return { ...state, phase: 'skill_targeting', targetingSkill: 'swap', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
  }
  if (skillChoice === 'eliminate') {
    return { ...state, phase: 'skill_targeting', targetingSkill: 'eliminate', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
  }

  // Place a piece
  const t0 = performance.now();
  const move = findBestMove(state.board, ai);
  const t1 = performance.now();
  log(`findBestMove took ${(t1 - t0).toFixed(1)}ms`);

  if (!move) {
    log('no move available, forfeiting turn');
    return nextTurn(state);
  }

  log(`placing piece at ${move.row},${move.col}`);
  const { state: newState, wins } = placePiece(state, move.row, move.col);
  if (wins.length > 0) {
    log(`formed ${wins.length} five-in-a-row(s)!`);
  }
  if (wins.length === 0) {
    return nextTurn(newState);
  }
  return newState;
}
