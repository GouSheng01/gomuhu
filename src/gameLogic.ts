import type { CellState, GameState, Player, Position, GameMode } from './types';
import { BOARD_SIZE, WIN_LENGTH, SCORE_PER_WIN, MP_PER_WIN, WIN_LEAD, TURN_TIME, GAME_TIME, PLAYER_NAMES } from './constants';

export function createEmptyBoard(): CellState[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => 'empty' as CellState)
  );
}

export function createInitialState(mode: GameMode = 'pvp', aiPlayer: Player | null = null): GameState {
  return {
    board: createEmptyBoard(),
    currentPlayer: 'black',
    players: {
      black: { name: PLAYER_NAMES.black, score: 0, mp: 0, skipNextTurn: false, fallen: 0 },
      white: { name: PLAYER_NAMES.white, score: 0, mp: 0, skipNextTurn: false, fallen: 0 },
    },
    phase: 'playing',
    fivePositions: [],
    targetingSkill: null,
    targetingStep: 0,
    targetingFirst: null,
    turnTimeRemaining: TURN_TIME,
    gameTimeRemaining: GAME_TIME,
    winner: null,
    mode,
    aiPlayer,
  };
}

export function opponentOf(player: Player): Player {
  return player === 'black' ? 'white' : 'black';
}

/** Check all 5-in-a-rows passing through (row, col). Returns array of win lines (0-4). */
export function checkWin(board: CellState[][], row: number, col: number): Position[][] {
  const player = board[row][col];
  if (player === 'empty') return [];

  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal ↘
    [1, -1],  // diagonal ↙
  ];

  const results: Position[][] = [];

  for (const [dr, dc] of directions) {
    const line: Position[] = [{ row, col }];

    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
        line.push({ row: r, col: c });
      } else break;
    }

    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
        line.unshift({ row: r, col: c });
      } else break;
    }

    if (line.length >= WIN_LENGTH) {
      results.push(line.slice(0, WIN_LENGTH));
    }
  }
  return results;
}

/** Scan the entire board for ALL unique 5-in-a-rows of the given player. */
export function scanBoardForAllWins(board: CellState[][], player: Player): Position[][] {
  const seen = new Set<string>();
  const allWins: Position[][] = [];

  // Only check positions belonging to the player
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== player) continue;
      const results = checkWin(board, r, c);
      for (const line of results) {
        // Deduplicate: sort positions and create a unique key
        const sorted = [...line].sort((a, b) => a.row - b.row || a.col - b.col);
        const key = sorted.map(p => `${p.row},${p.col}`).join('|');
        if (!seen.has(key)) {
          seen.add(key);
          allWins.push(line);
        }
      }
    }
  }
  return allWins;
}

/** Place a piece and return all 5-in-a-rows formed. */
export function placePiece(state: GameState, row: number, col: number): { state: GameState; wins: Position[][] } {
  const board = state.board.map(r => [...r]);
  board[row][col] = state.currentPlayer;
  const wins = checkWin(board, row, col);

  return {
    state: {
      ...state,
      board,
      fivePositions: wins,
      phase: wins.length > 0 ? 'five_choice' : 'playing',
    },
    wins,
  };
}

/** Player chooses to take score (1 per 5-in-a-row).
 *  Opponent gains MP = floor(opponent piece count on board / 2). */
export function chooseScore(state: GameState): GameState {
  const multiplier = state.fivePositions.length;
  const player = state.currentPlayer;
  const opp = opponentOf(player);

  let oppBoardCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] === opp) oppBoardCount++;
    }
  }
  const oppMPGain = Math.floor(oppBoardCount / 2);

  const newScore = state.players[player].score + SCORE_PER_WIN * multiplier;
  const oppScore = state.players[opp].score;
  const won = newScore - oppScore >= WIN_LEAD;

  const players = {
    ...state.players,
    [player]: {
      ...state.players[player],
      score: newScore,
      skipNextTurn: false,
    },
    [opp]: {
      ...state.players[opp],
      mp: state.players[opp].mp + oppMPGain,
      skipNextTurn: false,
    },
  };

  return {
    ...state,
    board: won ? state.board : createEmptyBoard(),
    players,
    currentPlayer: won ? player : opp,
    phase: won ? 'game_over' : 'playing',
    fivePositions: [],
    winner: won ? player : null,
    turnTimeRemaining: TURN_TIME,
  };
}

/** Player chooses to take MP (3 per 5-in-a-row, remove all win-line pieces, continue). */
export function chooseMP(state: GameState): GameState {
  const multiplier = state.fivePositions.length;
  const player = state.currentPlayer;
  const players = {
    ...state.players,
    [player]: {
      ...state.players[player],
      mp: state.players[player].mp + MP_PER_WIN * multiplier,
    },
  };

  const board = state.board.map(r => [...r]);
  // deduplicate positions (intersection points appear in multiple lines)
  const seen = new Set<string>();
  for (const line of state.fivePositions) {
    for (const { row, col } of line) {
      const key = `${row},${col}`;
      if (!seen.has(key)) {
        seen.add(key);
        board[row][col] = 'empty';
      }
    }
  }

  return {
    ...state,
    board,
    players,
    currentPlayer: opponentOf(player),
    phase: 'playing',
    fivePositions: [],
  };
}

/** Remove one opponent piece (flying_sand). */
export function removePiece(state: GameState, pos: Position): GameState {
  const board = state.board.map(r => [...r]);
  const removedPlayer = board[pos.row][pos.col] as Player;
  board[pos.row][pos.col] = 'empty';
  const fives = scanBoardForAllWins(board, state.currentPlayer);

  return {
    ...state,
    board,
    players: {
      ...state.players,
      [removedPlayer]: {
        ...state.players[removedPlayer],
        fallen: state.players[removedPlayer].fallen + 1,
      },
    },
    fivePositions: fives,
    phase: fives.length > 0 ? 'five_choice' : 'playing',
    targetingSkill: null,
    targetingStep: 0,
    targetingFirst: null,
  };
}

/** Skip opponent's next turn (pacifying_needle). */
export function applySkipTurn(state: GameState): GameState {
  const target = opponentOf(state.currentPlayer);
  return {
    ...state,
    players: {
      ...state.players,
      [target]: {
        ...state.players[target],
        skipNextTurn: true,
      },
    },
    phase: 'playing',
    targetingSkill: null,
  };
}

/** Swap two pieces on the board (stealing_beams). */
export function swapPieces(state: GameState, pos1: Position, pos2: Position): GameState {
  const board = state.board.map(r => [...r]);
  const tmp = board[pos1.row][pos1.col];
  board[pos1.row][pos1.col] = board[pos2.row][pos2.col];
  board[pos2.row][pos2.col] = tmp;
  const fives = scanBoardForAllWins(board, state.currentPlayer);

  return {
    ...state,
    board,
    fivePositions: fives,
    phase: fives.length > 0 ? 'five_choice' : 'playing',
    targetingSkill: null,
    targetingStep: 0,
    targetingFirst: null,
  };
}

/** Randomly place 2 of own pieces on empty spots (heavenly_flowers). */
export function heavenlyFlowers(state: GameState): GameState {
  const emptySpots: Position[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] === 'empty') {
        emptySpots.push({ row: r, col: c });
      }
    }
  }

  if (emptySpots.length === 0) {
    return { ...state, phase: 'playing', targetingSkill: null };
  }

  const board = state.board.map(r => [...r]);
  const shuffled = emptySpots.sort(() => Math.random() - 0.5);
  const count = Math.min(2, shuffled.length);
  for (let i = 0; i < count; i++) {
    const { row, col } = shuffled[i];
    board[row][col] = state.currentPlayer;
  }

  const fives = scanBoardForAllWins(board, state.currentPlayer);

  return {
    ...state,
    board,
    fivePositions: fives,
    phase: fives.length > 0 ? 'five_choice' : 'playing',
    targetingSkill: null,
  };
}

/** Deduct MP for using a skill. */
export function deductMP(state: GameState, cost: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [state.currentPlayer]: {
        ...state.players[state.currentPlayer],
        mp: state.players[state.currentPlayer].mp - cost,
      },
    },
  };
}

/** Resolve winner by score then MP when global time runs out. */
export function endGameByTime(state: GameState): GameState {
  const { black, white } = state.players;
  let winner: Player | null = null;
  if (black.score > white.score) winner = 'black';
  else if (white.score > black.score) winner = 'white';
  else if (black.mp > white.mp) winner = 'black';
  else if (white.mp > black.mp) winner = 'white';
  return { ...state, phase: 'game_over', winner };
}

/** Tick the global game timer. Returns new state; if time hits 0, ends the game. */
export function tickGameTime(state: GameState): GameState {
  if (state.phase === 'game_over' || state.gameTimeRemaining <= 0) return state;
  const newTime = state.gameTimeRemaining - 1;
  if (newTime <= 0) {
    return endGameByTime({ ...state, gameTimeRemaining: 0 });
  }
  return { ...state, gameTimeRemaining: newTime };
}

/** Switch to the next player's turn, handling skip logic. Resets turn timer. */
export function nextTurn(state: GameState): GameState {
  const next = opponentOf(state.currentPlayer);
  if (state.players[next].skipNextTurn) {
    const players = {
      ...state.players,
      [next]: { ...state.players[next], skipNextTurn: false },
    };
    return {
      ...state,
      currentPlayer: state.currentPlayer,
      players,
      turnTimeRemaining: TURN_TIME,
    };
  }
  return {
    ...state,
    currentPlayer: next,
    turnTimeRemaining: TURN_TIME,
  };
}
