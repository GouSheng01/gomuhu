import type { GameState, Player, Position, SkillId } from './types';
import { BOARD_SIZE, WIN_LENGTH, SKILLS } from './constants';
import {
  placePiece, chooseScore, chooseMP, removePiece, applySkipTurn, swapPieces, heavenlyFlowers, deductMP, nextTurn,
  opponentOf, checkWin,
} from './gameLogic';
import type { CellState } from './types';

/** Score an empty cell for the given player: max consecutive length if placed there. */
function cellScore(board: CellState[][], row: number, col: number, player: Player): number {
  const copy = board.map(r => [...r]);
  copy[row][col] = player;
  const wins = checkWin(copy, row, col);
  if (wins.length > 0) return WIN_LENGTH + wins.length; // 5 + extra for multi-line
  // Count max consecutive in each direction
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

/** Find best move for the given player. Returns null if board full. */
function findBestMove(board: CellState[][], ai: Player): Position | null {
  const opp = opponentOf(ai);
  let bestPos: Position | null = null;
  let bestScore = -1;

  // Only consider cells near existing pieces (within 2)
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

  // If board is empty, play center
  if (candidateSet.size === 0) {
    return { row: 7, col: 7 };
  }

  for (const key of candidateSet) {
    const [r, c] = key.split(',').map(Number);
    const aiScore = cellScore(board, r, c, ai);
    const oppScore = cellScore(board, r, c, opp);

    // Winning move = top priority
    if (aiScore >= WIN_LENGTH) return { row: r, col: c };

    // Block opponent's winning move
    if (oppScore >= WIN_LENGTH && bestScore < 1000) {
      bestScore = 1000;
      bestPos = { row: r, col: c };
      continue;
    }

    // Score: heavily weight own threats and opponent threats
    const score = Math.pow(aiScore, 3) + Math.pow(oppScore, 2) * 2;
    if (score > bestScore && bestScore < 1000) {
      bestScore = score;
      bestPos = { row: r, col: c };
    }
  }

  return bestPos;
}

/** Check if AI should use a skill. Returns skill id or null. */
function shouldUseSkill(state: GameState, ai: Player): SkillId | null {
  const mp = state.players[ai].mp;
  const opp = opponentOf(ai);
  const board = state.board;

  // Don't use skills too aggressively - 30% base chance
  if (Math.random() > 0.3) return null;

  const affordable = SKILLS.filter(s => mp >= s.mpCost);
  if (affordable.length === 0) return null;

  // Count opponent pieces (for evaluating board state)
  let oppCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === opp) oppCount++;

  // Check if opponent has a near-win threat (4 in a row anywhere)
  const oppNearWin = findBestMove(board, opp);
  const oppThreatLevel = oppNearWin ? cellScore(board, oppNearWin.row, oppNearWin.col, opp) : 0;

  // Priority: if opponent is about to win and we can afford 飞沙走石 to break it
  if (oppThreatLevel >= 4 && mp >= 2) {
    return 'flying_sand';
  }

  // If opponent is threatening and we can freeze them
  if (oppThreatLevel >= 3 && mp >= 4 && Math.random() < 0.5) {
    return 'pacifying_needle';
  }

  // If we have decent MP and board has empty space, consider 天女散花
  const emptyCount = board.flat().filter(c => c === 'empty').length;
  if (mp >= 5 && emptyCount > 50 && Math.random() < 0.3) {
    return 'heavenly_flowers';
  }

  // Swap pieces occasionally if MP is high
  if (mp >= 5 && oppCount > 5 && Math.random() < 0.2) {
    return 'stealing_beams';
  }

  // Default: 飞沙走石 to harass
  if (mp >= 2 && oppCount > 3 && Math.random() < 0.25) {
    return 'flying_sand';
  }

  return null;
}

/** Find a good opponent piece to remove with 飞沙走石. */
function findTargetPiece(board: CellState[][], opp: Player): Position | null {
  // Prefer removing pieces that are part of long chains
  let best: Position | null = null;
  let bestScore = -1;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === opp) {
        const score = cellScore(board, r, c, opp);
        if (score > bestScore) {
          bestScore = score;
          best = { row: r, col: c };
        }
      }
    }
  }
  return best;
}

/** Find two pieces to swap for stealing_beams. Simple: swap AI's worst-positioned piece with opponent's best. */
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

/** Choose between score and MP when five-in-a-row. */
function aiFiveChoice(state: GameState): GameState {
  const ai = state.currentPlayer;
  const opp = opponentOf(ai);
  const aiScore = state.players[ai].score;
  const oppScore = state.players[opp].score;
  const multiplier = state.fivePositions.length;
  const timeLeft = state.gameTimeRemaining;
  const newScore = aiScore + multiplier;

  // If choosing score wins outright, always do it
  if (newScore - oppScore >= WIN_LENGTH) {
    return chooseScore(state);
  }

  // If this gets us to 2 points with decent lead, strongly consider it
  if (newScore >= 2 && newScore > oppScore && timeLeft < 420) {
    if (Math.random() < 0.7) return chooseScore(state);
  }

  // Behind on score and time is running out → grab points
  if (aiScore < oppScore && timeLeft < 300) {
    return chooseScore(state);
  }

  // Time pressure: last 2 minutes, prefer score
  if (timeLeft < 120) {
    return Math.random() < 0.85 ? chooseScore(state) : chooseMP(state);
  }

  // Mid-game (3-7 min remaining): 50/50
  if (timeLeft < 420) {
    return Math.random() < 0.5 ? chooseScore(state) : chooseMP(state);
  }

  // Early game: mostly MP but sometimes score to keep it interesting
  return Math.random() < 0.35 ? chooseScore(state) : chooseMP(state);
}

/** Main AI entry point. Applies the AI's decision to the state and returns new state. */
export function aiDecide(state: GameState): GameState {
  const ai = state.currentPlayer;

  if (state.phase === 'five_choice') {
    return aiFiveChoice(state);
  }

  if (state.phase === 'skill_targeting') {
    // Complete ongoing targeting
    if (state.targetingSkill === 'flying_sand') {
      const target = findTargetPiece(state.board, opponentOf(ai));
      if (target) {
        let s = deductMP(state, 2);
        s = removePiece(s, target);
        return s.phase === 'five_choice' ? s : nextTurn(s);
      }
    }
    if (state.targetingSkill === 'stealing_beams') {
      if (state.targetingStep === 0) {
        // Pick first piece: prefer opponent piece
        const target = findTargetPiece(state.board, opponentOf(ai));
        if (target) return { ...state, targetingStep: 1, targetingFirst: target };
      } else {
        const swap = findSwapPositions(state.board, ai);
        if (swap) {
          let s = deductMP(state, 3);
          s = swapPieces(s, swap.pos1, swap.pos2);
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }
      }
    }
    // Fallback: cancel skill
    return nextTurn({ ...state, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null });
  }

  // Decide: skill or place piece
  const skillChoice = shouldUseSkill(state, ai);

  if (skillChoice === 'pacifying_needle') {
    let s = deductMP(state, 4);
    s = applySkipTurn(s);
    return nextTurn(s);
  }
  if (skillChoice === 'heavenly_flowers') {
    let s = deductMP(state, 5);
    s = heavenlyFlowers(s);
    return s.phase === 'five_choice' ? s : nextTurn(s);
  }
  if (skillChoice === 'flying_sand') {
    return { ...state, phase: 'skill_targeting', targetingSkill: 'flying_sand', targetingStep: 0, targetingFirst: null };
  }
  if (skillChoice === 'stealing_beams') {
    return { ...state, phase: 'skill_targeting', targetingSkill: 'stealing_beams', targetingStep: 0, targetingFirst: null };
  }

  // Place a piece
  const move = findBestMove(state.board, ai);
  if (!move) return nextTurn(state); // board full, forfeit turn

  const { state: newState, wins } = placePiece(state, move.row, move.col);
  if (wins.length === 0) {
    return nextTurn(newState);
  }
  return newState;
}
