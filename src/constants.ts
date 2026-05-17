import type { SkillDef } from './types';

export const BOARD_SIZE = 15;
export const WIN_LENGTH = 5;
export const TURN_TIME = 120;   // 2 minutes per turn
export const GAME_TIME = 600;   // 10 minutes total game time
export const WIN_LEAD = 3;      // win by leading 3 points
export const SCORE_PER_WIN = 1;
export const MP_PER_WIN = 3;

export const SKILLS: SkillDef[] = [
  { id: 'flying_sand',     name: '飞沙走石', description: '移除对方一颗棋子',           mpCost: 2 },
  { id: 'pacifying_needle', name: '定海神针', description: '让对方下一回合无法行动',     mpCost: 4 },
  { id: 'stealing_beams',  name: '偷梁换柱', description: '交换棋盘上任意两颗棋子位置',  mpCost: 3 },
  { id: 'heavenly_flowers', name: '天女散花', description: '随机在空白处生成2颗己方棋子', mpCost: 5 },
];

export const PLAYER_NAMES: Record<string, string> = {
  black: '黑方',
  white: '白方',
};
