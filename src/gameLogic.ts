import type { CellState, GameState, Player, Position, GameMode } from './types';
import { BOARD_SIZE, WIN_LENGTH, SCORE_PER_WIN, MP_PER_WIN, WIN_LEAD, TURN_TIME, GAME_TIME, BREED_RANGE, PLAYER_NAMES } from './constants';

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
    eliminatedCount: 0,
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
    [0, 1], [1, 0], [1, 1], [1, -1],
  ];

  const results: Position[][] = [];

  for (const [dr, dc] of directions) {
    const line: Position[] = [{ row, col }];

    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) line.push({ row: r, col: c });
      else break;
    }
    for (let i = 1; i < WIN_LENGTH; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) line.unshift({ row: r, col: c });
      else break;
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

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== player) continue;
      const results = checkWin(board, r, c);
      for (const line of results) {
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
    [player]: { ...state.players[player], score: newScore },
    [opp]:   { ...state.players[opp], mp: state.players[opp].mp + oppMPGain },
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

/** Remove one opponent piece (eliminate skill step). */
export function eliminatePiece(state: GameState, pos: Position): GameState {
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
    eliminatedCount: state.eliminatedCount + 1,
    targetingStep: 0,
    targetingSkill: fives.length > 0 ? null : state.targetingSkill,
    targetingFirst: null,
  };
}

/** Swap two pieces on the board (swap skill). */
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

/** Spawn 2 friendly pieces in 3x3 area around the seed piece (breed skill).
 *  If forcedSpawns is provided, uses those exact positions (for network sync).
 *  Returns state and the actual spawn positions used. */
export function breedPieces(
  state: GameState,
  seed: Position,
  forcedSpawns?: [Position, Position]
): { state: GameState; spawns: [Position, Position] | null } {
  const board = state.board.map(r => [...r]);
  const player = state.currentPlayer;
  const half = Math.floor(BREED_RANGE / 2);
  const emptySpots: Position[] = [];

  for (let dr = -half; dr <= half; dr++) {
    for (let dc = -half; dc <= half; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = seed.row + dr, c = seed.col + dc;
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === 'empty') {
        emptySpots.push({ row: r, col: c });
      }
    }
  }

  if (emptySpots.length < 2) {
    console.warn('[breed] not enough space in 3x3 area');
    return { state: { ...state, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null }, spawns: null };
  }

  // Use forced spawn positions (from network sync) or pick 2 random
  let spawns: [Position, Position];
  if (forcedSpawns) {
    spawns = forcedSpawns;
  } else {
    const shuffled = emptySpots.sort(() => Math.random() - 0.5);
    spawns = [{ row: shuffled[0].row, col: shuffled[0].col }, { row: shuffled[1].row, col: shuffled[1].col }];
  }

  board[spawns[0].row][spawns[0].col] = player;
  board[spawns[1].row][spawns[1].col] = player;

  const fives = scanBoardForAllWins(board, player);

  return {
    state: {
      ...state,
      board,
      fivePositions: fives,
      phase: fives.length > 0 ? 'five_choice' : 'playing',
      targetingSkill: null,
      targetingStep: 0,
      targetingFirst: null,
    },
    spawns,
  };
}

/** Bombard skill: place piece, destroy all adjacent pieces (enemy + friendly). */
export function placeBomb(
  state: GameState,
  pos: Position,
): { state: GameState; eliminated: Position[]; eliminatedPlayers: ('black' | 'white')[] } {
  const board = state.board.map(r => [...r]);
  const player = state.currentPlayer;

  board[pos.row][pos.col] = player;

  const eliminated: Position[] = [];
  const eliminatedPlayers: ('black' | 'white')[] = [];
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const r = pos.row + dr;
    const c = pos.col + dc;
    if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] !== 'empty') {
      eliminatedPlayers.push(board[r][c] as 'black' | 'white');
      board[r][c] = 'empty';
      eliminated.push({ row: r, col: c });
    }
  }

  // Count fallen per player
  const fallenByPlayer: Record<string, number> = { black: 0, white: 0 };
  for (const ep of eliminatedPlayers) fallenByPlayer[ep]++;

  const newPlayers = {
    ...state.players,
    black: {
      ...state.players.black,
      fallen: state.players.black.fallen + (fallenByPlayer.black || 0),
    },
    white: {
      ...state.players.white,
      fallen: state.players.white.fallen + (fallenByPlayer.white || 0),
    },
  };

  const fives = scanBoardForAllWins(board, player);

  return {
    state: {
      ...state,
      board,
      players: newPlayers,
      fivePositions: fives,
      phase: fives.length > 0 ? 'five_choice' : 'playing',
      targetingSkill: null,
      targetingStep: 0,
      targetingFirst: null,
    },
    eliminated,
    eliminatedPlayers,
  };
}

/** Ember skill: convert half of fallen pieces to MP. */
export function useEmber(state: GameState): GameState {
  const player = state.currentPlayer;
  const p = state.players[player];
  const converted = Math.floor(p.fallen / 2);
  if (converted === 0) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [player]: {
        ...p,
        fallen: p.fallen - converted,
        mp: p.mp + converted,
      },
    },
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

/** Tick the global game timer. */
export function tickGameTime(state: GameState): GameState {
  if (state.phase === 'game_over' || state.gameTimeRemaining <= 0) return state;
  const newTime = state.gameTimeRemaining - 1;
  if (newTime <= 0) {
    return endGameByTime({ ...state, gameTimeRemaining: 0 });
  }
  return { ...state, gameTimeRemaining: newTime };
}

/** Switch to the next player's turn. Resets turn timer. */
export function nextTurn(state: GameState): GameState {
  return {
    ...state,
    currentPlayer: opponentOf(state.currentPlayer),
    turnTimeRemaining: TURN_TIME,
    targetingSkill: null,
    targetingStep: 0,
    targetingFirst: null,
    eliminatedCount: 0,
  };
}
