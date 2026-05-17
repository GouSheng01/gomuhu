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

export type SkillId = 'flying_sand' | 'pacifying_needle' | 'stealing_beams' | 'heavenly_flowers';

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
  targetingStep: number;             // for multi-step targeting (stealing_beams)
  targetingFirst: Position | null;   // first selected position for swap
  turnTimeRemaining: number;         // seconds remaining for current turn
  gameTimeRemaining: number;         // seconds remaining for whole game (10 min)
  winner: Player | null;
  mode: GameMode;
  aiPlayer: Player | null;           // which player is AI (null in PvP)
}
