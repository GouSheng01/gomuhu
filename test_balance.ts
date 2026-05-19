import { createInitialState, nextTurn, opponentOf } from './src/gameLogic';
import { aiDecide } from './src/aiService';
import type { GameState, Player, SkillId } from './src/types';
import { SKILLS } from './src/constants';

const GAMES = 50;

interface Stats {
  games: number;
  blackWins: number;
  whiteWins: number;
  draws: number;
  totalTurns: number;
  avgScoreBlack: number;
  avgScoreWhite: number;
  avgMpBlack: number;
  avgMpWhite: number;
  avgFallenBlack: number;
  avgFallenWhite: number;
  skillUse: Record<string, number>;
  totalGameTime: number;
}

const stats: Stats = {
  games: 0, blackWins: 0, whiteWins: 0, draws: 0,
  totalTurns: 0, avgScoreBlack: 0, avgScoreWhite: 0,
  avgMpBlack: 0, avgMpWhite: 0, avgFallenBlack: 0, avgFallenWhite: 0,
  skillUse: {}, totalGameTime: 0,
};
for (const s of SKILLS) stats.skillUse[s.id] = 0;

function runGame(): void {
  let state = createInitialState('pvp', null);

  // Track skill usage by detecting phase changes
  let prevSkill: SkillId | null = null;

  while (state.phase !== 'game_over') {
    const player = state.currentPlayer;
    const beforeSkill = state.targetingSkill;

    // Limit turns to prevent infinite games
    if (state.turnCount > 300) {
      // Force end
      const bs = state.players.black.score;
      const ws = state.players.white.score;
      state = {
        ...state, phase: 'game_over',
        winner: bs > ws ? 'black' : ws > bs ? 'white' : null,
      } as GameState;
      break;
    }

    try {
      state = aiDecide(state);

      // Detect skill usage
      if (state.targetingSkill && !beforeSkill) {
        prevSkill = state.targetingSkill;
      }
      if (!state.targetingSkill && beforeSkill && prevSkill) {
        stats.skillUse[prevSkill] = (stats.skillUse[prevSkill] || 0) + 1;
        prevSkill = null;
      }
      // Detect skill used without targeting phase (ember)
      if (state.phase === 'playing' && state.currentPlayer !== player) {
        // turn ended, skill was used
        if (prevSkill) {
          stats.skillUse[prevSkill] = (stats.skillUse[prevSkill] || 0) + 1;
          prevSkill = null;
        }
      }
    } catch (e) {
      console.error(`Error in AI turn (${player}):`, e);
      state = nextTurn(state);
    }
  }

  // Collect stats
  stats.games++;
  stats.totalTurns += state.turnCount;
  stats.avgScoreBlack += state.players.black.score;
  stats.avgScoreWhite += state.players.white.score;
  stats.avgMpBlack += state.players.black.mp;
  stats.avgMpWhite += state.players.white.mp;
  stats.avgFallenBlack += state.players.black.fallen;
  stats.avgFallenWhite += state.players.white.fallen;
  stats.totalGameTime += (600 - state.gameTimeRemaining);

  if (state.winner === 'black') stats.blackWins++;
  else if (state.winner === 'white') stats.whiteWins++;
  else stats.draws++;
}

console.log(`Running ${GAMES} AI vs AI games...\n`);

const startTime = Date.now();
for (let i = 0; i < GAMES; i++) {
  runGame();
  if ((i + 1) % 10 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ${i + 1}/${GAMES} games (${elapsed}s)`);
  }
}

const total = stats.games;
console.log('\n========== BALANCE REPORT ==========');
console.log(`Games:       ${total}`);
console.log(`Black wins:  ${stats.blackWins} (${(stats.blackWins / total * 100).toFixed(1)}%)`);
console.log(`White wins:  ${stats.whiteWins} (${(stats.whiteWins / total * 100).toFixed(1)}%)`);
console.log(`Draws:       ${stats.draws} (${(stats.draws / total * 100).toFixed(1)}%)`);
console.log(`Avg turns:   ${(stats.totalTurns / total).toFixed(1)}`);
console.log(`Avg time:    ${(stats.totalGameTime / total).toFixed(0)}s`);
console.log('');
console.log('--- Averages ---');
console.log(`Black score:  ${(stats.avgScoreBlack / total).toFixed(2)}`);
console.log(`White score:  ${(stats.avgScoreWhite / total).toFixed(2)}`);
console.log(`Black MP:     ${(stats.avgMpBlack / total).toFixed(1)}`);
console.log(`White MP:     ${(stats.avgMpWhite / total).toFixed(1)}`);
console.log(`Black fallen: ${(stats.avgFallenBlack / total).toFixed(1)}`);
console.log(`White fallen: ${(stats.avgFallenWhite / total).toFixed(1)}`);
console.log('');
console.log('--- Skill usage ---');
const skillTotal = Object.values(stats.skillUse).reduce((a, b) => a + b, 0);
for (const s of SKILLS) {
  const count = stats.skillUse[s.id] || 0;
  console.log(`  ${s.name} (${s.mpCost}MP): ${count} (${skillTotal > 0 ? (count / skillTotal * 100).toFixed(1) : 0}%)`);
}
console.log(`  Total skills used: ${skillTotal}`);
console.log('====================================');
