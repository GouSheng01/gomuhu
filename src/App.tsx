import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkillId, GameMode } from './types';
import { SKILLS, PLAYER_NAMES, TURN_TIME, GAME_TIME } from './constants';
import {
  createInitialState,
  opponentOf,
  placePiece,
  chooseScore,
  chooseMP,
  eliminatePiece,
  swapPieces,
  breedPieces,
  deductMP,
  nextTurn,
  tickGameTime,
} from './gameLogic';
import { aiDecide } from './aiService';
import './App.css';

export default function App() {
  const [mode, setMode] = useState<GameMode>('pvp');
  const [state, setState] = useState(() => createInitialState('pvp', null));
  const turnTimerRef = useRef<number | null>(null);
  const gameTimerRef = useRef<number | null>(null);
  const aiTimeoutRef = useRef<number | null>(null);
  const aiSafetyRef = useRef<number | null>(null);

  const startGame = useCallback((newMode: GameMode) => {
    setMode(newMode);
    setState(createInitialState(newMode, newMode === 'pve' ? 'white' : null));
  }, []);

  // Global timer
  useEffect(() => {
    if (state.phase === 'game_over') return;
    gameTimerRef.current = window.setInterval(() => {
      setState(prev => {
        if (prev.phase === 'game_over') return prev;
        return tickGameTime(prev);
      });
    }, 1000);
    return () => { if (gameTimerRef.current) clearInterval(gameTimerRef.current); };
  }, [state.phase]);

  // Turn timer
  useEffect(() => {
    if (state.phase === 'game_over') return;
    turnTimerRef.current = window.setInterval(() => {
      setState(prev => {
        if (prev.phase === 'game_over') return prev;
        const newTime = prev.turnTimeRemaining - 1;
        if (newTime <= 0) {
          if (prev.phase === 'five_choice') {
            return chooseScore({ ...prev, turnTimeRemaining: TURN_TIME });
          }
          if (prev.phase === 'skill_targeting') {
            return nextTurn(prev);
          }
          return nextTurn(prev);
        }
        return { ...prev, turnTimeRemaining: newTime };
      });
    }, 1000);
    return () => { if (turnTimerRef.current) clearInterval(turnTimerRef.current); };
  }, [state.currentPlayer, state.phase]);

  // AI auto-play
  useEffect(() => {
    if (aiTimeoutRef.current) { clearTimeout(aiTimeoutRef.current); aiTimeoutRef.current = null; }
    if (aiSafetyRef.current) { clearTimeout(aiSafetyRef.current); aiSafetyRef.current = null; }
    if (state.phase === 'game_over') return;
    if (state.aiPlayer !== state.currentPlayer) return;

    const delay = state.phase === 'five_choice' ? 600 : state.phase === 'skill_targeting' ? 400 : 300 + Math.random() * 500;
    aiTimeoutRef.current = window.setTimeout(() => {
      setState(prev => {
        if (prev.aiPlayer !== prev.currentPlayer || prev.phase === 'game_over') return prev;
        try {
          const result = aiDecide(prev);
          if (result.currentPlayer === prev.currentPlayer && result.phase === prev.phase && result.phase === 'playing') {
            console.warn('[AI] returned state with no visible change, forcing next turn');
            return nextTurn(result);
          }
          return result;
        } catch (e) {
          console.error('[AI] error, forfeiting turn:', e);
          return nextTurn(prev);
        }
      });
    }, delay);

    aiSafetyRef.current = window.setTimeout(() => {
      console.warn('[AI] safety timeout (8s), forcing next turn');
      setState(prev => {
        if (prev.aiPlayer !== prev.currentPlayer || prev.phase === 'game_over') return prev;
        return nextTurn(prev);
      });
    }, 8000);

    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
      if (aiSafetyRef.current) clearTimeout(aiSafetyRef.current);
    };
  }, [state.currentPlayer, state.phase, state.targetingStep, state.aiPlayer]);

  const handleCellClick = useCallback((row: number, col: number) => {
    setState(prev => {
      if (prev.phase === 'game_over') return prev;
      if (prev.aiPlayer === prev.currentPlayer) return prev;

      if (prev.phase === 'skill_targeting') {
        // --- Eliminate (2-step: pick 2 enemy pieces) ---
        if (prev.targetingSkill === 'eliminate') {
          const targetPlayer = opponentOf(prev.currentPlayer);
          if (prev.board[row][col] !== targetPlayer) return prev;
          // Deduct MP only on first pick
          const s = prev.eliminatedCount === 0 ? deductMP(prev, 4) : prev;
          const afterElim = eliminatePiece(s, { row, col });
          // If five formed, show choice; if still need second pick, stay in targeting
          if (afterElim.phase === 'five_choice') return afterElim;
          if (afterElim.eliminatedCount >= 2) return nextTurn(afterElim);
          return afterElim; // stay in targeting for second pick
        }

        // --- Swap (2-step: pick 2 pieces to swap) ---
        if (prev.targetingSkill === 'swap') {
          if (prev.board[row][col] === 'empty') return prev;
          if (prev.targetingStep === 0) {
            return { ...prev, targetingStep: 1, targetingFirst: { row, col } };
          }
          let s = deductMP(prev, 3);
          s = swapPieces(s, prev.targetingFirst!, { row, col });
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }

        // --- Breed (1-step: pick friendly piece, auto-spawn) ---
        if (prev.targetingSkill === 'breed') {
          if (prev.board[row][col] !== prev.currentPlayer) return prev;
          let s = deductMP(prev, 5);
          s = breedPieces(s, { row, col });
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }

        return prev;
      }

      if (prev.phase !== 'playing') return prev;
      if (prev.board[row][col] !== 'empty') return prev;

      const { state: newState, wins } = placePiece(prev, row, col);
      if (wins.length === 0) {
        return nextTurn(newState);
      }
      return newState;
    });
  }, []);

  const handleChooseScore = useCallback(() => {
    setState(prev => chooseScore(prev));
  }, []);

  const handleChooseMP = useCallback(() => {
    setState(prev => chooseMP(prev));
  }, []);

  const handleSkillClick = useCallback((skillId: SkillId) => {
    setState(prev => {
      if (prev.phase !== 'playing') return prev;
      if (prev.aiPlayer === prev.currentPlayer) return prev;
      const player = prev.currentPlayer;
      const skill = SKILLS.find(s => s.id === skillId)!;
      if (prev.players[player].mp < skill.mpCost) return prev;

      switch (skillId) {
        case 'eliminate':
          return { ...prev, phase: 'skill_targeting', targetingSkill: 'eliminate', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
        case 'swap':
          return { ...prev, phase: 'skill_targeting', targetingSkill: 'swap', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
        case 'breed':
          return { ...prev, phase: 'skill_targeting', targetingSkill: 'breed', targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
        default:
          return prev;
      }
    });
  }, []);

  const handleCancelSkill = useCallback(() => {
    setState(prev => ({
      ...prev,
      phase: 'playing',
      targetingSkill: null,
      targetingStep: 0,
      targetingFirst: null,
      eliminatedCount: 0,
    }));
  }, []);

  const handleRestart = useCallback(() => {
    startGame(mode);
  }, [mode, startGame]);

  const { board, currentPlayer, players, phase, fivePositions, targetingSkill, targetingStep, targetingFirst, eliminatedCount, turnTimeRemaining, gameTimeRemaining, winner } = state;
  const curPlayer = players[currentPlayer];
  const isAI = state.aiPlayer === currentPlayer;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const isFivePos = (r: number, c: number) =>
    fivePositions.some(line => line.some(p => p.row === r && p.col === c));

  const isTargetFirst = (r: number, c: number) =>
    targetingFirst?.row === r && targetingFirst.col === c;

  const getCellHint = (r: number, c: number): string => {
    if (phase === 'skill_targeting') {
      if (targetingSkill === 'eliminate' && board[r][c] === opponentOf(currentPlayer)) return 'targetable';
      if (targetingSkill === 'swap' && board[r][c] !== 'empty') return 'targetable';
      if (targetingSkill === 'breed' && board[r][c] === currentPlayer) return 'targetable';
    }
    return '';
  };

  const getTurnInfo = () => {
    if (phase === 'game_over') return '游戏结束';
    if (phase === 'five_choice') return `${PLAYER_NAMES[currentPlayer]} 五连！请选择${isAI ? ' (AI思考中...)' : ''}`;
    if (phase === 'skill_targeting') {
      if (targetingSkill === 'eliminate') return `剔除: 点击敌方棋子 (${eliminatedCount}/2)`;
      if (targetingSkill === 'swap') return `交换: 选第${targetingStep === 0 ? '一' : '二'}颗棋子`;
      if (targetingSkill === 'breed') return '繁殖: 点击己方棋子作为种子';
    }
    return `当前回合: ${PLAYER_NAMES[currentPlayer]}${isAI ? ' (AI思考中...)' : ''}`;
  };

  const globalTimeDanger = gameTimeRemaining <= 60;

  return (
    <div className="app">
      <div className="top-bar">
        <button className={`mode-btn ${mode === 'pvp' ? 'active' : ''}`} onClick={() => startGame('pvp')}>双人对战</button>
        <button className={`mode-btn ${mode === 'pve' ? 'active' : ''}`} onClick={() => startGame('pve')}>人机对战</button>
        <button className="mode-btn restart" onClick={handleRestart}>重新开始</button>
      </div>

      <div className="header">
        <div className={`player-info black ${currentPlayer === 'black' ? 'active' : ''}`}>
          <span className="player-name">{players.black.name}{state.aiPlayer === 'black' ? ' (AI)' : ''}</span>
          <span>积分: {players.black.score}</span>
          <span>MP: {players.black.mp}</span>
          <span className="fallen-stat">弃子: {players.black.fallen}</span>
        </div>
        <div className="center-info">
          <div className="timer-label">全局剩余</div>
          <div className={`timer global ${globalTimeDanger ? 'danger' : ''}`}>{formatTime(gameTimeRemaining)}</div>
          <div className="turn-info">{getTurnInfo()}</div>
          <div className="timer-label mt">回合剩余</div>
          <div className={`timer ${turnTimeRemaining <= 30 ? 'danger' : ''}`}>{formatTime(turnTimeRemaining)}</div>
        </div>
        <div className={`player-info white ${currentPlayer === 'white' ? 'active' : ''}`}>
          <span className="player-name">{players.white.name}{state.aiPlayer === 'white' ? ' (AI)' : ''}</span>
          <span>积分: {players.white.score}</span>
          <span>MP: {players.white.mp}</span>
          <span className="fallen-stat">弃子: {players.white.fallen}</span>
        </div>
      </div>

      <div className="board-container">
        <div className="board">
          {board.map((row, r) => (
            <div key={r} className="board-row">
              {row.map((cell, c) => (
                <div
                  key={c}
                  className={`cell ${cell} ${isFivePos(r, c) ? 'five' : ''} ${isTargetFirst(r, c) ? 'target-first' : ''} ${getCellHint(r, c)}`}
                  onClick={() => handleCellClick(r, c)}
                >
                  {cell !== 'empty' && <div className="stone" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="skills-bar">
        <span className="skills-label">{curPlayer.name} 技能:</span>
        {SKILLS.map(skill => {
          const canAfford = curPlayer.mp >= skill.mpCost;
          const canUse = phase === 'playing' && canAfford && !isAI;
          return (
            <button
              key={skill.id}
              className={`skill-btn ${skill.id} ${!canUse ? 'disabled' : ''}`}
              disabled={!canUse}
              onClick={() => handleSkillClick(skill.id)}
              title={skill.description}
            >
              {skill.name} ({skill.mpCost}MP)
            </button>
          );
        })}
        {phase === 'skill_targeting' && !isAI && (
          <button className="skill-btn cancel" onClick={handleCancelSkill}>取消</button>
        )}
      </div>

      {phase === 'five_choice' && !isAI && (() => {
        const multi = fivePositions.length;
        const opp = opponentOf(currentPlayer);
        let oppBoardCount = 0;
        for (let r = 0; r < 15; r++) {
          for (let c = 0; c < 15; c++) {
            if (board[r][c] === opp) oppBoardCount++;
          }
        }
        const oppMP = Math.floor(oppBoardCount / 2);
        return (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{PLAYER_NAMES[currentPlayer]} 形成五连！{multi > 1 && ` ×${multi}`}</h2>
            <p>请选择奖励方式：</p>
            <div className="modal-buttons">
              <button className="modal-btn score" onClick={handleChooseScore}>
                获得胜利积分 (+{multi})<br />
                <small>棋盘清空 · {PLAYER_NAMES[opp]}获得 {oppMP} MP（{oppBoardCount}子 ÷ 2）</small>
              </button>
              <button className="modal-btn mp" onClick={handleChooseMP}>
                获得 MP (+{multi * 3})<br /><small>五连棋子消失，继续对局</small>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {phase === 'game_over' && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>游戏结束</h2>
            <p className="result">
              {winner
                ? `${PLAYER_NAMES[winner]} 获胜！`
                : `平局！ (${players.black.score} : ${players.white.score})`}
            </p>
            {!winner && <p className="result-sub">分数持平，{players.black.mp > players.white.mp ? '黑方' : players.white.mp > players.black.mp ? '白方' : '双方'} MP领先</p>}
            {winner && <p className="result-sub">
              {players[winner].score - players[opponentOf(winner)].score >= 3
                ? '领先 3 分提前结束'
                : gameTimeRemaining <= 0 ? '时间结束，比分领先' : ''}
            </p>}
            <div className="final-scores">
              <div>黑方 — 积分: {players.black.score} | MP: {players.black.mp}</div>
              <div>白方 — 积分: {players.white.score} | MP: {players.white.mp}</div>
            </div>
            <button className="modal-btn restart" onClick={handleRestart}>再来一局</button>
          </div>
        </div>
      )}
    </div>
  );
}
