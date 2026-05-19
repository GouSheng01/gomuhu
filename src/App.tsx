import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkillId, GameMode, PeerAction, OnlinePhase, Player } from './types';
import { SKILLS, PLAYER_NAMES, TURN_TIME } from './constants';
import {
  createInitialState, opponentOf, placePiece, chooseScore, chooseMP,
  eliminatePiece, swapPieces, breedPieces, deductMP, nextTurn, tickGameTime,
} from './gameLogic';
import { aiDecide } from './aiService';
import { createRoom, joinRoom, sendAction, onRemoteAction, onStatusChange, disconnect } from './peerService';
import './App.css';

function isMyTurn(state: { currentPlayer: Player; aiPlayer: Player | null; mode: GameMode; phase: string }, myColor: Player | null): boolean {
  if (state.mode !== 'online' || !myColor) return true;
  return state.currentPlayer === myColor && state.phase !== 'game_over';
}

export default function App() {
  const [mode, setMode] = useState<GameMode>('pvp');
  const [state, setState] = useState(() => createInitialState('pvp', null));
  const turnTimerRef = useRef<number | null>(null);
  const gameTimerRef = useRef<number | null>(null);
  const aiTimeoutRef = useRef<number | null>(null);
  const aiSafetyRef = useRef<number | null>(null);

  // Online state
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>('idle');
  const [roomId, setRoomId] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [myColor, setMyColor] = useState<Player | null>(null);
  const [onlineError, setOnlineError] = useState('');
  const sendRef = useRef<PeerAction | null>(null);

  function applyRemoteAction(state: ReturnType<typeof createInitialState>, action: PeerAction): ReturnType<typeof createInitialState> {
    switch (action.type) {
      case 'place': {
        const { state: ns, wins } = placePiece(state, action.row, action.col);
        if (wins.length === 0) return nextTurn(ns);
        return ns;
      }
      case 'skill_eliminate': {
        let s = deductMP(state, 4);
        s = eliminatePiece(s, action.targets[0]);
        if (s.phase === 'five_choice') return s;
        s = eliminatePiece(s, action.targets[1]);
        if (s.phase === 'five_choice') return s;
        return nextTurn(s);
      }
      case 'skill_swap': {
        let s = deductMP(state, 3);
        s = swapPieces(s, action.pos1, action.pos2);
        if (s.phase === 'five_choice') return s;
        return nextTurn(s);
      }
      case 'skill_breed': {
        let s = deductMP(state, 5);
        const r = breedPieces(s, action.seed, action.spawns);
        if (r.state.phase === 'five_choice') return r.state;
        return nextTurn(r.state);
      }
      case 'choose_score':
        return chooseScore(state);
      case 'choose_mp':
        return chooseMP(state);
      case 'cancel_skill':
        return { ...state, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
      default:
        return state;
    }
  }

  // Send queued action after state updates
  useEffect(() => {
    if (sendRef.current && mode === 'online') {
      sendAction(sendRef.current);
      sendRef.current = null;
    }
  });

  // Listen for remote actions
  useEffect(() => {
    if (mode !== 'online') return;
    onRemoteAction((action: PeerAction) => {
      setState(prev => applyRemoteAction(prev, action));
    });
    return () => { onRemoteAction(() => {}); };
  }, [mode]);

  // Connection status
  useEffect(() => {
    onStatusChange((s) => {
      setOnlinePhase(s);
      if (s === 'disconnected') setOnlineError('连接断开');
    });
    return () => { onStatusChange(() => {}); };
  }, []);

  const startGame = useCallback((newMode: GameMode) => {
    setMode(newMode);
    setOnlineError('');
    if (newMode !== 'online') {
      disconnect();
      setOnlinePhase('idle');
      setMyColor(null);
      setState(createInitialState(newMode, newMode === 'pve' ? 'white' : null));
    }
  }, []);

  const [hostInput, setHostInput] = useState('');

  const handleCreateRoom = useCallback(async () => {
    const code = hostInput.trim();
    if (!/^\d{5}$/.test(code)) {
      setOnlineError('房间号必须是5位数字');
      return;
    }
    try {
      setOnlineError('');
      const id = await createRoom(code);
      setRoomId(id);
      setMyColor('black');
      setState(createInitialState('online', null));
    } catch (e: any) {
      setOnlineError('创建房间失败: ' + (e.message || ''));
    }
  }, [hostInput]);

  const handleJoinRoom = useCallback(async () => {
    if (!joinInput.trim()) return;
    try {
      setOnlineError('');
      await joinRoom(joinInput.trim());
      setRoomId(joinInput.trim());
      setMyColor('white');
      setState(createInitialState('online', null));
    } catch (e: any) {
      setOnlineError('加入房间失败: ' + (e.message || ''));
    }
  }, [joinInput]);

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

  const localTurn = isMyTurn(state, myColor) && state.aiPlayer !== state.currentPlayer;

  const handleCellClick = useCallback((row: number, col: number) => {
    setState(prev => {
      if (prev.phase === 'game_over') return prev;
      if (!isMyTurn(prev, myColor)) return prev;
      if (prev.aiPlayer === prev.currentPlayer) return prev;

      if (prev.phase === 'skill_targeting') {
        // --- Eliminate ---
        if (prev.targetingSkill === 'eliminate') {
          const targetPlayer = opponentOf(prev.currentPlayer);
          if (prev.board[row][col] !== targetPlayer) return prev;
          const isFirst = prev.eliminatedCount === 0;
          const firstTarget = isFirst ? { row, col } : prev.targetingFirst;
          const s = isFirst ? deductMP(prev, 4) : prev;
          let afterElim = eliminatePiece(s, { row, col });
          // Preserve first target position (eliminatePiece clears it)
          afterElim = { ...afterElim, targetingFirst: firstTarget };

          if (afterElim.phase === 'five_choice') {
            if (prev.mode === 'online') sendRef.current = { type: 'skill_eliminate', targets: [firstTarget!, { row, col }] };
            return afterElim;
          }
          if (afterElim.eliminatedCount >= 2) {
            if (prev.mode === 'online') sendRef.current = { type: 'skill_eliminate', targets: [firstTarget!, { row, col }] };
            return nextTurn(afterElim);
          }
          return afterElim;
        }

        // --- Swap ---
        if (prev.targetingSkill === 'swap') {
          if (prev.board[row][col] === 'empty') return prev;
          if (prev.targetingStep === 0) {
            return { ...prev, targetingStep: 1, targetingFirst: { row, col } };
          }
          let s = deductMP(prev, 3);
          s = swapPieces(s, prev.targetingFirst!, { row, col });
          if (prev.mode === 'online') {
            sendRef.current = { type: 'skill_swap', pos1: prev.targetingFirst!, pos2: { row, col } };
          }
          return s.phase === 'five_choice' ? s : nextTurn(s);
        }

        // --- Breed ---
        if (prev.targetingSkill === 'breed') {
          if (prev.board[row][col] !== prev.currentPlayer) return prev;
          let s = deductMP(prev, 5);
          const r = breedPieces(s, { row, col });
          if (prev.mode === 'online' && r.spawns) {
            sendRef.current = { type: 'skill_breed', seed: { row, col }, spawns: r.spawns };
          }
          return r.state.phase === 'five_choice' ? r.state : nextTurn(r.state);
        }

        return prev;
      }

      if (prev.phase !== 'playing') return prev;
      if (prev.board[row][col] !== 'empty') return prev;

      const { state: newState, wins } = placePiece(prev, row, col);
      if (prev.mode === 'online') {
        sendRef.current = { type: 'place', row, col };
      }
      if (wins.length === 0) {
        return nextTurn(newState);
      }
      return newState;
    });
  }, [myColor]);

  const handleChooseScore = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'online') sendRef.current = { type: 'choose_score' };
      return chooseScore(prev);
    });
  }, []);

  const handleChooseMP = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'online') sendRef.current = { type: 'choose_mp' };
      return chooseMP(prev);
    });
  }, []);

  const handleSkillClick = useCallback((skillId: SkillId) => {
    setState(prev => {
      if (prev.phase !== 'playing') return prev;
      if (!isMyTurn(prev, myColor)) return prev;
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
  }, [myColor]);

  const handleCancelSkill = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'online') sendRef.current = { type: 'cancel_skill' };
      return { ...prev, phase: 'playing', targetingSkill: null, targetingStep: 0, targetingFirst: null, eliminatedCount: 0 };
    });
  }, []);

  const handleRestart = useCallback(() => {
    startGame(mode);
  }, [mode, startGame]);

  const { board, currentPlayer, players, phase, fivePositions, targetingSkill, targetingStep, targetingFirst, eliminatedCount, turnTimeRemaining, gameTimeRemaining, winner } = state;
  const curPlayer = players[currentPlayer];
  const isAI = state.aiPlayer === currentPlayer;
  const boardDisabled = (mode === 'online' && !localTurn) || phase === 'game_over';

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
    if (phase === 'skill_targeting' && localTurn) {
      if (targetingSkill === 'eliminate' && board[r][c] === opponentOf(currentPlayer)) return 'targetable';
      if (targetingSkill === 'swap' && board[r][c] !== 'empty') return 'targetable';
      if (targetingSkill === 'breed' && board[r][c] === currentPlayer) return 'targetable';
    }
    return '';
  };

  const getTurnInfo = () => {
    if (phase === 'game_over') return '游戏结束';
    if (mode === 'online' && !localTurn) return `等待对方操作...`;
    if (phase === 'five_choice') return `${PLAYER_NAMES[currentPlayer]} 五连！请选择${isAI ? ' (AI思考中...)' : ''}`;
    if (phase === 'skill_targeting') {
      if (targetingSkill === 'eliminate') return `剔除: 点击敌方棋子 (${eliminatedCount}/2)`;
      if (targetingSkill === 'swap') return `交换: 选第${targetingStep === 0 ? '一' : '二'}颗棋子`;
      if (targetingSkill === 'breed') return '繁殖: 点击己方棋子作为种子';
    }
    return `当前回合: ${PLAYER_NAMES[currentPlayer]}${isAI ? ' (AI思考中...)' : ''}`;
  };

  const globalTimeDanger = gameTimeRemaining <= 60;

  // --- ONLINE LOBBY ---
  if (mode === 'online' && onlinePhase !== 'connected') {
    return (
      <div className="app">
        <div className="top-bar">
          <button className="mode-btn" onClick={() => startGame('pvp')}>双人对战</button>
          <button className="mode-btn" onClick={() => startGame('pve')}>人机对战</button>
          <button className="mode-btn active" onClick={() => startGame('online')}>联机对战</button>
        </div>
        <div className="online-lobby">
          <h2>联机对战</h2>
          <div className="online-section">
            <input className="join-input" placeholder="设置5位房间号" value={hostInput} onChange={e => setHostInput(e.target.value)} maxLength={5} disabled={onlinePhase === 'connecting'} />
            <button className="mode-btn" onClick={handleCreateRoom} disabled={onlinePhase === 'connecting' || !hostInput.trim()}>
              {onlinePhase === 'connecting' ? '连接中...' : '创建房间'}
            </button>
          </div>
          {roomId && onlinePhase === 'connecting' && <p className="room-id-display">房间号: <strong>{roomId}</strong> (等待对手加入...)</p>}
          <div className="online-divider">或</div>
          <div className="online-section">
            <input
              className="join-input"
              placeholder="输入房间号"
              value={joinInput}
              onChange={e => setJoinInput(e.target.value)}
              disabled={onlinePhase === 'connecting'}
            />
            <button className="mode-btn" onClick={handleJoinRoom} disabled={onlinePhase === 'connecting' || !joinInput.trim()}>
              {onlinePhase === 'connecting' ? '连接中...' : '加入房间'}
            </button>
          </div>
          {onlineError && <p className="online-error">{onlineError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="top-bar">
        <button className={`mode-btn ${mode === 'pvp' ? 'active' : ''}`} onClick={() => startGame('pvp')}>双人对战</button>
        <button className={`mode-btn ${mode === 'pve' ? 'active' : ''}`} onClick={() => startGame('pve')}>人机对战</button>
        <button className={`mode-btn ${mode === 'online' ? 'active' : ''}`} onClick={() => startGame('online')}>联机对战</button>
        <button className="mode-btn restart" onClick={handleRestart}>重新开始</button>
        {mode === 'online' && <span className="room-badge">房间: {roomId}</span>}
      </div>

      <div className="header">
        <div className={`player-info black ${currentPlayer === 'black' ? 'active' : ''}`}>
          <span className="player-name">{players.black.name}{state.aiPlayer === 'black' ? ' (AI)' : myColor === 'black' ? ' (你)' : mode === 'online' ? ' (对手)' : ''}</span>
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
          <span className="player-name">{players.white.name}{state.aiPlayer === 'white' ? ' (AI)' : myColor === 'white' ? ' (你)' : mode === 'online' ? ' (对手)' : ''}</span>
          <span>积分: {players.white.score}</span>
          <span>MP: {players.white.mp}</span>
          <span className="fallen-stat">弃子: {players.white.fallen}</span>
        </div>
      </div>

      <div className="board-container">
        <div className={`board ${boardDisabled ? 'disabled' : ''}`}>
          {board.map((row, r) => (
            <div key={r} className="board-row">
              {row.map((cell, c) => (
                <div
                  key={c}
                  className={`cell ${cell} ${isFivePos(r, c) ? 'five' : ''} ${isTargetFirst(r, c) ? 'target-first' : ''} ${getCellHint(r, c)}`}
                  onClick={() => !boardDisabled && handleCellClick(r, c)}
                >
                  {cell !== 'empty' && <div className="stone" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="skills-bar">
        <span className="skills-label">{curPlayer.name} 技能</span>
        {SKILLS.map(skill => {
          const canAfford = curPlayer.mp >= skill.mpCost;
          const canUse = phase === 'playing' && canAfford && localTurn && !isAI;
          return (
            <div
              key={skill.id}
              className={`skill-card ${skill.id} ${!canUse ? 'disabled' : ''}`}
              onClick={() => canUse && handleSkillClick(skill.id)}
              role="button"
              tabIndex={canUse ? 0 : -1}
              onKeyDown={e => { if (canUse && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleSkillClick(skill.id); } }}
            >
              <span className="skill-card-corner top-left">{skill.mpCost}<small>MP</small></span>
              <span className="skill-card-name">{skill.name}</span>
              <span className="skill-card-corner bottom-right">{skill.mpCost}<small>MP</small></span>
              <span className="skill-card-desc">{skill.description}</span>
            </div>
          );
        })}
        {phase === 'skill_targeting' && localTurn && !isAI && (
          <div
            className="skill-card cancel"
            onClick={handleCancelSkill}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCancelSkill(); } }}
          >
            <span className="skill-card-name">取消</span>
          </div>
        )}
      </div>

      {phase === 'five_choice' && localTurn && !isAI && (() => {
        const multi = fivePositions.length;
        const opp = opponentOf(currentPlayer);
        let oppBoardCount = 0;
        for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (board[r][c] === opp) oppBoardCount++;
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
            <p className="result">{winner ? `${PLAYER_NAMES[winner]} 获胜！` : `平局！ (${players.black.score} : ${players.white.score})`}</p>
            {!winner && <p className="result-sub">分数持平，{players.black.mp > players.white.mp ? '黑方' : players.white.mp > players.black.mp ? '白方' : '双方'} MP领先</p>}
            {winner && <p className="result-sub">{players[winner].score - players[opponentOf(winner)].score >= 3 ? '领先 3 分提前结束' : gameTimeRemaining <= 0 ? '时间结束，比分领先' : ''}</p>}
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
