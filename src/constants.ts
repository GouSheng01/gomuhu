import type { SkillDef } from './types';

export const BOARD_SIZE = 15;
export const WIN_LENGTH = 5;
export const TURN_TIME = 120;   // 2 minutes per turn
export const GAME_TIME = 600;   // 10 minutes total game time
export const WIN_LEAD = 3;      // win by leading 3 points
export const SCORE_PER_WIN = 1;
export const MP_PER_WIN = 3;

export const SKILLS: SkillDef[] = [
  { id: 'ember',     name: '馀烬', description: '弃子半数转化为MP',                       mpCost: 1 },
  { id: 'eliminate', name: '剔除', description: '剔除场上的一枚棋子',                   mpCost: 2 },
  { id: 'swap',      name: '交换', description: '交换棋盘任意两颗棋子',               mpCost: 3 },
  { id: 'bombard',   name: '轰炸', description: '落子时炸毁相邻四格所有棋子',             mpCost: 4 },
  { id: 'breed',     name: '繁殖', description: '选己方棋子，3×3范围生成2颗己方棋子', mpCost: 5 },
];

export const BREED_RANGE = 3; // 3×3 range for breed skill

export const PLAYER_NAMES: Record<string, string> = {
  black: '黑方',
  white: '白方',
};
