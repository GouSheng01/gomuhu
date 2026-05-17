import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkillId, GameMode } from './types';
import { SKILLS, PLAYER_NAMES, TURN_TIME, GAME_TIME } from './constants';
import {
  createInitialState,
  opponentOf,
  placePiece,
  chooseScore,
  chooseMP,
  removePiece,
  applySkipTurn,
  swapPieces,
  heavenlyFlowers,
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

  // Start new game with given mode
  const startGame = useCallback((newMode: GameMode) => {
    setMode(newMode);
    setState(createInitialState(newMode, newMode === 'pve' ? 'white' : null));
  }, []);

  // Global timer: ticks every second
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

  // Turn timer: ticks every second, resets when turn changes
  useEffect(() => {
    if (state.phase === 'game_over') return;
    turnTimerRef.current = window.setInterval(() => {
      setState(prev => {
        if (prev.phase === 'game_over') return prev;
        const newTime = prev.turnTimeRemaining - 1;
        if (newTime <= 0) {
          // Timeout: forfeit turn or auto-choose
          if (prev.phase === 'five_choice') {
            return chooseScore({ ...prev, turnTimeRemaining: TURN_TIME });
          }
          if (prev.phase === 'skill_targeting') {
            return nextTurn({ ...prev, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null, turnTimeRemaining: 0 });
          }
          return nextTurn({ ...prev, turnTimeRemaining: 0 });
        }
        return { ...prev, turnTimeRemaining: newTime };
      });
    }, 1000);
    return () => { if (turnTimerRef.current) clearInterval(turnTimerRef.current); };
  }, [state.currentPlayer, state.phase]);

  // AI auto-play
  useEffect(() => {
    if (aiTimeoutRef.current) { clearTimeout(aiTimeoutRef.current); aiTimeoutRef.current = null; }
    if (state.phase === 'game_over') return;
    if (state.aiPlayer !== state.currentPlayer) return;

    // Delay AI move so it doesn't feel instant
    const delay = state.phase === 'five_choice' ? 600 : state.phase === 'skill_targeting' ? 400 : 300 + Math.random() * 500;
    aiTimeoutRef.current = window.setTimeout(() => {
      setState(prev => {
        if (prev.aiPlayer !== prev.currentPlayer || prev.phase === 'game_over') return prev;
        try {
          return aiDecide(prev);
        } catch (e) {
          console.error('AI error, forfeiting turn:', e);
          return nextTurn({ ...prev, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null });
        }
      });
    }, delay);

    return () => { if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current); };
  }, [state.currentPlayer, state.phase, state.targetingStep, state.aiPlayer]);

  const handleCellClick = useCallback((row: number, col: number) => {
    setState(prev => {
      if (prev.phase === 'game_over') return prev;
      // Don't allow clicks during AI's turn
      if (prev.aiPlayer === prev.currentPlayer) return prev;

      if (prev.phase === 'skill_targeting') {
        if (prev.targetingSkill === 'flying_sand') {
          const targetPlayer = opponentOf(prev.currentPlayer);
          if (prev.board[row][col] !== targetPlayer) return prev;
          let s = deductMP(prev, 2);
          s = removePiece(s, { row, col });
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }
        if (prev.targetingSkill === 'stealing_beams') {
          if (prev.board[row][col] === 'empty') return prev;
          if (prev.targetingStep === 0) {
            return { ...prev, targetingStep: 1, targetingFirst: { row, col } };
          }
          let s = deductMP(prev, 3);
          s = swapPieces(s, prev.targetingFirst!, { row, col });
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
        case 'flying_sand':
          return { ...prev, phase: 'skill_targeting', targetingSkill: 'flying_sand', targetingStep: 0, targetingFirst: null };
        case 'pacifying_needle': {
          let s = deductMP(prev, 4);
          s = applySkipTurn(s);
          return nextTurn(s);
        }
        case 'stealing_beams':
          return { ...prev, phase: 'skill_targeting', targetingSkill: 'stealing_beams', targetingStep: 0, targetingFirst: null };
        case 'heavenly_flowers': {
          let s = deductMP(prev, 5);
          s = heavenlyFlowers(s);
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }
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
    }));
  }, []);

  const handleRestart = useCallback(() => {
    startGame(mode);
  }, [mode, startGame]);

  const { board, currentPlayer, players, phase, fivePositions, targetingSkill, targetingStep, targetingFirst, turnTimeRemaining, gameTimeRemaining, winner } = state;
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
      if (targetingSkill === 'flying_sand' && board[r][c] === opponentOf(currentPlayer)) return 'targetable';
      if (targetingSkill === 'stealing_beams' && board[r][c] !== 'empty') return 'targetable';
    }
    return '';
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
        <div className={`player-info black ${currentPlayer === 'black' ? 'active' : ''} ${players.black.skipNextTurn ? 'frozen' : ''}`}>
          <span className="player-name">{players.black.name}{state.aiPlayer === 'black' ? ' (AI)' : ''}</span>
          <span>积分: {players.black.score}</span>
          <span>MP: {players.black.mp}</span>
          <span className="fallen-stat">弃子: {players.black.fallen}</span>
          {players.black.skipNextTurn && <span className="frozen-tag">冻结</span>}
        </div>
        <div className="center-info">
          <div className="timer-label">全局剩余</div>
          <div className={`timer global ${globalTimeDanger ? 'danger' : ''}`}>{formatTime(gameTimeRemaining)}</div>
          <div className="turn-info">
            {phase === 'game_over'
              ? '游戏结束'
              : phase === 'five_choice'
                ? `${PLAYER_NAMES[currentPlayer]} 五连！请选择${isAI ? ' (AI思考中...)' : ''}`
                : phase === 'skill_targeting'
                  ? targetingSkill === 'stealing_beams'
                    ? `选择棋子交换 (${targetingStep === 0 ? '第一颗' : '第二颗'})`
                    : '点击敌方棋子移除'
                  : `当前回合: ${PLAYER_NAMES[currentPlayer]}${isAI ? ' (AI思考中...)' : ''}`}
          </div>
          <div className="timer-label mt">回合剩余</div>
          <div className={`timer ${turnTimeRemaining <= 30 ? 'danger' : ''}`}>{formatTime(turnTimeRemaining)}</div>
        </div>
        <div className={`player-info white ${currentPlayer === 'white' ? 'active' : ''} ${players.white.skipNextTurn ? 'frozen' : ''}`}>
          <span className="player-name">{players.white.name}{state.aiPlayer === 'white' ? ' (AI)' : ''}</span>
          <span>积分: {players.white.score}</span>
          <span>MP: {players.white.mp}</span>
          <span className="fallen-stat">弃子: {players.white.fallen}</span>
          {players.white.skipNextTurn && <span className="frozen-tag">冻结</span>}
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
                />
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
