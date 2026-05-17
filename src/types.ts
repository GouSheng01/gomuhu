export type CellState = 'empty' | 'black' | 'white';
export type Player = 'black' | 'white';

export interface Position {
  row: number;
  col: number;
}

export interface PlayerState {
  name: string;
  score: number;
  mp: number;
  skipNextTurn: boolean;
  fallen: number;
}

export type SkillId = 'eliminate' | 'swap' | 'breed';

export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  mpCost: number;
}

export type GamePhase =
  | 'playing'           // normal play - place piece or use skill
  | 'five_choice'       // 5-in-a-row popup - choose score or MP
  | 'skill_targeting'   // skill requires selecting target(s) on board
  | 'game_over';        // time's up or win condition met

export type GameMode = 'pvp' | 'pve';

export interface GameState {
  board: CellState[][];            // 15x15
  currentPlayer: Player;
  players: Record<Player, PlayerState>;
  phase: GamePhase;
  fivePositions: Position[][];       // all 5-in-a-rows (usually 1, can be 2-4)
  targetingSkill: SkillId | null;    // which skill is waiting for target selection
  targetingStep: number;             // 0=first pick, 1=second pick (eliminate / swap)
  targetingFirst: Position | null;   // first selected position (swap) or seed piece (breed)
  eliminatedCount: number;           // how many pieces eliminated so far (eliminate)
  turnTimeRemaining: number;         // seconds remaining for current turn
  gameTimeRemaining: number;         // seconds remaining for whole game (10 min)
  winner: Player | null;
  mode: GameMode;
  aiPlayer: Player | null;           // which player is AI (null in PvP)
}
