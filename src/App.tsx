import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// ── Types ────────────────────────────────────────────────────────────
type Choice = 'C' | 'D';
type Phase = 'choose' | 'reveal' | 'done';
type PayoffKey = 'CC' | 'CD' | 'DC' | 'DD';

interface Player {
  name: string;
  strategy: string;
  persona: string;
}

interface GameConfig {
  p1: Player;
  p2: Player;
  totalRounds: number;
  apiKey: string;
}

interface HistoryEntry {
  c1: Choice;
  c2: Choice;
  pts1: number;
  pts2: number;
  r1?: string;
  r2?: string;
}

interface LLMResult {
  choice: Choice;
  reasoning: string;
}

// ── Constants ────────────────────────────────────────────────────────
const PAYOFF: Record<PayoffKey, [number, number]> = {
  CC: [3, 3], CD: [0, 5], DC: [5, 0], DD: [1, 1],
};

const STRATEGIES: Record<string, { label: string; desc: string; isLLM: boolean }> = {
  human:         { label: 'Human (manual)',    desc: 'You choose each round',                        isLLM: false },
  llm_claude:    { label: 'AI — Claude (LLM)', desc: 'Claude decides based on persona & history',    isLLM: true  },
  tit_for_tat:   { label: 'Tit for Tat',       desc: 'Cooperates first, then mirrors opponent',      isLLM: false },
  always_coop:   { label: 'Always Cooperate',  desc: 'Cooperates every round',                       isLLM: false },
  always_defect: { label: 'Always Defect',     desc: 'Defects every round',                          isLLM: false },
  grudger:       { label: 'Grudger',           desc: 'Cooperates until betrayed, then defects forever', isLLM: false },
  random:        { label: 'Random',            desc: '50/50 each round',                             isLLM: false },
  detective:     { label: 'Detective',         desc: 'Probes first 4 rounds then exploits',          isLLM: false },
};

const DEFAULT_PERSONAS = [
  'A pragmatic diplomat who values long-term alliances and mutual trust',
  'A cunning strategist who exploits patterns of trust for maximum personal gain',
  'A paranoid prisoner who always expects betrayal',
  'A ruthless merchant who maximises profit above all else',
  'A philosopher who believes in the golden rule: do unto others as you would have done to you',
];

// ── Utilities ────────────────────────────────────────────────────────
function outcomeKey(c1: Choice, c2: Choice): PayoffKey {
  return `${c1}${c2}` as PayoffKey;
}

function outcomeDescription(c1: Choice, c2: Choice, n1: string, n2: string): string {
  if (c1 === 'C' && c2 === 'C') return `Both cooperate — mutual reward (+3 each)`;
  if (c1 === 'D' && c2 === 'D') return `Both defect — mutual punishment (+1 each)`;
  if (c1 === 'D' && c2 === 'C') return `${n1} betrays ${n2} — ${n1} +5, ${n2} +0`;
  return `${n2} betrays ${n1} — ${n2} +5, ${n1} +0`;
}

function outcomeBannerClass(c1: Choice, c2: Choice): string {
  if (c1 === 'C' && c2 === 'C') return 'outcome-both-coop';
  if (c1 === 'D' && c2 === 'D') return 'outcome-both-def';
  if (c1 === 'D' && c2 === 'C') return 'outcome-p1-betrays';
  return 'outcome-p2-betrays';
}

function aiDecide(strategy: string, history: [Choice, Choice][], playerIndex: number): Choice {
  const opp = playerIndex === 0 ? 1 : 0;
  switch (strategy) {
    case 'always_coop':   return 'C';
    case 'always_defect': return 'D';
    case 'random':        return Math.random() < 0.5 ? 'C' : 'D';
    case 'tit_for_tat':   return history.length === 0 ? 'C' : history[history.length - 1][opp];
    case 'grudger':       return history.some(r => r[opp] === 'D') ? 'D' : 'C';
    case 'detective': {
      const script: Choice[] = ['C', 'D', 'C', 'C'];
      if (history.length < 4) return script[history.length];
      return history.slice(0, 4).some(r => r[opp] === 'D')
        ? history[history.length - 1][opp]
        : 'D';
    }
    default: return 'C';
  }
}

async function fetchLLMDecision(
  player: Player,
  opponentName: string,
  historyMoves: [Choice, Choice][],
  myIndex: number,
  round: number,
  totalRounds: number,
  myScore: number,
  oppScore: number,
  apiKey: string,
): Promise<LLMResult> {
  const histText = historyMoves.length === 0
    ? 'No rounds played yet — this is the opening move.'
    : historyMoves.map(([c1, c2], i) => {
        const mine = myIndex === 0 ? c1 : c2;
        const theirs = myIndex === 0 ? c2 : c1;
        return `  Round ${i + 1}: you ${mine === 'C' ? 'cooperated' : 'defected'}, ${opponentName} ${theirs === 'C' ? 'cooperated' : 'defected'}`;
      }).join('\n');

  const prompt = `You are playing an iterated Prisoner's Dilemma. Your character persona: "${player.persona}"

PAYOFF MATRIX:
- Both cooperate  → you +3, opponent +3
- You cooperate, they defect → you +0, opponent +5
- You defect, they cooperate → you +5, opponent +0
- Both defect → you +1, opponent +1

CURRENT STATE:
- Round ${round} of ${totalRounds}
- Your score: ${myScore} | ${opponentName}'s score: ${oppScore}

MOVE HISTORY:
${histText}

Make your move for round ${round}. Stay fully in character as "${player.persona}".
Respond ONLY with valid JSON — no other text before or after:
{"decision":"COOPERATE","reasoning":"one sentence in character (max 20 words)"}

"decision" must be exactly "COOPERATE" or "DEFECT".`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json() as any;
  const raw: string = data.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('Unexpected response: ' + raw.slice(0, 80));

  const parsed = JSON.parse(match[0]);
  return {
    choice: parsed.decision?.toUpperCase() === 'DEFECT' ? 'D' : 'C',
    reasoning: parsed.reasoning || '',
  };
}

// ── ApiKeyPanel ───────────────────────────────────────────────────────
function ApiKeyPanel({ apiKey, onChange }: { apiKey: string; onChange: (k: string) => void }) {
  const [show, setShow] = useState(false);
  const hasKey = apiKey.trim().length > 5;
  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>
          Anthropic API Key
        </span>
        <span className={`apikey-status ${hasKey ? 'set' : 'unset'}`}>
          {hasKey ? '✓ Set' : 'Not set'}
        </span>
      </div>
      <div className="apikey-row">
        <input
          type={show ? 'text' : 'password'}
          placeholder="sk-ant-api03-..."
          value={apiKey}
          onChange={e => onChange(e.target.value)}
        />
        <button className="btn btn-secondary" style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
          onClick={() => setShow(s => !s)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <p style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.5rem' }}>
        Required for AI (Claude) strategy. Key is stored only in your browser's localStorage.
      </p>
    </div>
  );
}

// ── SetupScreen ───────────────────────────────────────────────────────
function SetupScreen({ onStart }: { onStart: (c: GameConfig) => void }) {
  const [p1name,    setP1name]    = useState('Alice');
  const [p2name,    setP2name]    = useState('Bob');
  const [p1strat,   setP1strat]   = useState('llm_claude');
  const [p2strat,   setP2strat]   = useState('llm_claude');
  const [p1persona, setP1persona] = useState(DEFAULT_PERSONAS[0]);
  const [p2persona, setP2persona] = useState(DEFAULT_PERSONAS[1]);
  const [rounds,    setRounds]    = useState(8);
  const [apiKey,    setApiKeyState] = useState(() => localStorage.getItem('anthropic_api_key') || '');

  const saveKey = (k: string) => { setApiKeyState(k); localStorage.setItem('anthropic_api_key', k); };
  const needsKey = p1strat === 'llm_claude' || p2strat === 'llm_claude';

  function PlayerCol({ n, name, setName, strat, setStrat, persona, setPersona }: {
    n: number; name: string; setName: (v: string) => void;
    strat: string; setStrat: (v: string) => void;
    persona: string; setPersona: (v: string) => void;
  }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div className="field">
          <label>Player {n} Name</label>
          <input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Strategy</label>
          <select value={strat} onChange={e => setStrat(e.target.value)}>
            {Object.entries(STRATEGIES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {STRATEGIES[strat].isLLM
            ? <span className="llm-badge">✦ Powered by Claude</span>
            : <span className="strategy-badge">{STRATEGIES[strat].desc}</span>
          }
        </div>
        {STRATEGIES[strat].isLLM && (
          <div className="field">
            <label>Persona (guides Claude's decisions)</label>
            <textarea
              value={persona}
              onChange={e => setPersona(e.target.value)}
              placeholder="Describe this player's personality and decision-making style…"
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {DEFAULT_PERSONAS.map((p, i) => (
                <button key={i} onClick={() => setPersona(p)} style={{
                  fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px',
                  border: '1px solid #334155', background: 'transparent',
                  color: '#64748b', cursor: 'pointer',
                }}>
                  {p.split(' ').slice(0, 3).join(' ')}…
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="setup card">
      <h2 style={{ textAlign: 'center', marginBottom: '0.1rem' }}>Game Setup</h2>
      <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
        Assign strategies, set personas, pick round count
      </p>

      <div className="players-row">
        <PlayerCol n={1} name={p1name} setName={setP1name} strat={p1strat} setStrat={setP1strat}
          persona={p1persona} setPersona={setP1persona} />
        <PlayerCol n={2} name={p2name} setName={setP2name} strat={p2strat} setStrat={setP2strat}
          persona={p2persona} setPersona={setP2persona} />
      </div>

      <div className="field">
        <label>Number of Rounds (1–50)</label>
        <input type="number" min="1" max="50" value={rounds}
          onChange={e => setRounds(Number(e.target.value))} />
      </div>

      {needsKey && <ApiKeyPanel apiKey={apiKey} onChange={saveKey} />}

      <div className="card" style={{ padding: '1rem' }}>
        <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.5rem', textAlign: 'center' }}>
          Payoff Matrix (P1, P2)
        </p>
        <table className="payoff-table">
          <thead>
            <tr><th></th><th>P2 Cooperates</th><th>P2 Defects</th></tr>
          </thead>
          <tbody>
            <tr><th>P1 Cooperates</th><td className="cc">+3, +3</td><td className="cd">+0, +5</td></tr>
            <tr><th>P1 Defects</th>  <td className="dc">+5, +0</td><td className="dd">+1, +1</td></tr>
          </tbody>
        </table>
      </div>

      <button className="btn btn-primary" onClick={() => onStart({
        p1: { name: p1name.trim() || 'Player 1', strategy: p1strat, persona: p1persona },
        p2: { name: p2name.trim() || 'Player 2', strategy: p2strat, persona: p2persona },
        totalRounds: Math.max(1, Math.min(50, rounds)),
        apiKey,
      })}>
        Start Game
      </button>
    </div>
  );
}

// ── GameScreen ────────────────────────────────────────────────────────
function GameScreen({ config, onReset }: { config: GameConfig; onReset: () => void }) {
  const { p1, p2, totalRounds, apiKey } = config;

  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [score,      setScore]      = useState<[number, number]>([0, 0]);
  const [round,      setRound]      = useState(1);
  const [phase,      setPhase]      = useState<Phase>('choose');
  const [ch1,        setCh1]        = useState<Choice | null>(null);
  const [ch2,        setCh2]        = useState<Choice | null>(null);
  const [re1,        setRe1]        = useState('');
  const [re2,        setRe2]        = useState('');
  const [ld1,        setLd1]        = useState(false);
  const [ld2,        setLd2]        = useState(false);
  const [err,        setErr]        = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<HistoryEntry | null>(null);

  const p1LLM   = p1.strategy === 'llm_claude';
  const p2LLM   = p2.strategy === 'llm_claude';
  const p1Human = p1.strategy === 'human';
  const p2Human = p2.strategy === 'human';

  const histRef  = useRef<HistoryEntry[]>([]);
  const scoreRef = useRef<[number, number]>([0, 0]);
  useEffect(() => { histRef.current  = history; }, [history]);
  useEffect(() => { scoreRef.current = score;   }, [score]);

  // Kick off decisions on entering choose phase
  useEffect(() => {
    if (phase !== 'choose') return;

    const moves = histRef.current.map(h => [h.c1, h.c2] as [Choice, Choice]);

    if (!p1Human && !p1LLM) setCh1(aiDecide(p1.strategy, moves, 0));
    if (!p2Human && !p2LLM) setCh2(aiDecide(p2.strategy, moves, 1));

    if (p1LLM) {
      setLd1(true); setCh1(null); setRe1('');
      fetchLLMDecision(p1, p2.name, moves, 0, round, totalRounds, scoreRef.current[0], scoreRef.current[1], apiKey)
        .then(({ choice, reasoning }) => { setCh1(choice); setRe1(reasoning); setLd1(false); })
        .catch(e => { setErr(`${p1.name}: ${(e as Error).message} — using random`); setCh1(Math.random() < .5 ? 'C' : 'D'); setLd1(false); });
    }
    if (p2LLM) {
      setLd2(true); setCh2(null); setRe2('');
      fetchLLMDecision(p2, p1.name, moves, 1, round, totalRounds, scoreRef.current[1], scoreRef.current[0], apiKey)
        .then(({ choice, reasoning }) => { setCh2(choice); setRe2(reasoning); setLd2(false); })
        .catch(e => { setErr(`${p2.name}: ${(e as Error).message} — using random`); setCh2(Math.random() < .5 ? 'C' : 'D'); setLd2(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  // Auto-commit when both choices ready
  useEffect(() => {
    if (phase !== 'choose' || !ch1 || !ch2 || ld1 || ld2) return;
    const key = outcomeKey(ch1, ch2);
    const [pts1, pts2] = PAYOFF[key];
    const h = histRef.current;
    const s = scoreRef.current;
    const entry: HistoryEntry = { c1: ch1, c2: ch2, pts1, pts2, r1: re1, r2: re2 };
    setHistory([...h, entry]);
    setScore([s[0] + pts1, s[1] + pts2]);
    setLastResult(entry);
    setPhase(round >= totalRounds ? 'done' : 'reveal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ch1, ch2, ld1, ld2, re1, re2]);

  function nextRound() {
    setRound(r => r + 1);
    setCh1(null); setCh2(null);
    setRe1(''); setRe2('');
    setErr(null);
    setPhase('choose');
  }

  function simulateAll() {
    let moves = history.map(h => [h.c1, h.c2] as [Choice, Choice]);
    let s: [number, number] = [...score];
    let hist = [...history];
    for (let r = round; r <= totalRounds; r++) {
      const c1 = aiDecide(p1.strategy, moves, 0);
      const c2 = aiDecide(p2.strategy, moves, 1);
      const [pts1, pts2] = PAYOFF[outcomeKey(c1, c2)];
      const entry: HistoryEntry = { c1, c2, pts1, pts2 };
      hist.push(entry);
      moves.push([c1, c2]);
      s = [s[0] + pts1, s[1] + pts2];
    }
    setHistory(hist);
    setScore(s);
    setLastResult(hist[hist.length - 1]);
    setPhase('done');
  }

  const canSimulateAll = !p1Human && !p2Human && !p1LLM && !p2LLM;

  function PlayerChoiceSection({ player, isHuman, isLLM, loading, choice, onChoose }: {
    player: Player; isHuman: boolean; isLLM: boolean;
    loading: boolean; choice: Choice | null; onChoose: (c: Choice) => void;
  }) {
    if (isLLM && loading) {
      return (
        <div className="llm-thinking">
          <div className="spinner" />
          <div>
            <div>Claude is deciding as <strong>{player.name}</strong>…</div>
            <div className="persona-hint">"{player.persona.slice(0, 60)}{player.persona.length > 60 ? '…' : ''}"</div>
          </div>
        </div>
      );
    }
    if (isLLM && choice) {
      return (
        <div className="llm-done">
          {player.name} has decided{' '}
          <strong style={{ color: choice === 'C' ? '#4ade80' : '#f87171' }}>(locked)</strong>
          {' '}— revealing after both decide.
        </div>
      );
    }
    if (isHuman) {
      return (
        <div className="player-section">
          <div className="label">{player.name} — choose:</div>
          <div className="choice-buttons">
            <button className="btn btn-cooperate" disabled={!!choice} onClick={() => onChoose('C')}>
              {choice === 'C' ? '✓ Cooperate' : 'Cooperate'}
            </button>
            <button className="btn btn-defect" disabled={!!choice} onClick={() => onChoose('D')}>
              {choice === 'D' ? '✓ Defect' : 'Defect'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="locked-choice">
        {player.name} ({STRATEGIES[player.strategy].label}) — choosing automatically…
      </div>
    );
  }

  return (
    <div className="game">
      {/* Scoreboard */}
      <div className="card scoreboard">
        <div className="player-score">
          <div className="name">{p1.name}</div>
          <div className="score-num" style={{ color: '#60a5fa' }}>{score[0]}</div>
          <div className="strat-tag">{p1LLM ? '✦ Claude' : STRATEGIES[p1.strategy].label}</div>
        </div>
        <div className="vs-block">VS</div>
        <div className="player-score">
          <div className="name">{p2.name}</div>
          <div className="score-num" style={{ color: '#a78bfa' }}>{score[1]}</div>
          <div className="strat-tag">{p2LLM ? '✦ Claude' : STRATEGIES[p2.strategy].label}</div>
        </div>
      </div>

      {/* Round counter */}
      <div className="round-info">
        {phase !== 'done'
          ? <>Round <strong>{round}</strong> of <strong>{totalRounds}</strong></>
          : <>Game Over — <strong>{totalRounds}</strong> rounds completed</>}
      </div>

      {err && <div className="error-banner">⚠ {err}</div>}

      {/* Choose phase */}
      {phase === 'choose' && (
        <div className="card choice-phase">
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            {(ld1 || ld2) ? 'Waiting for Claude…' : 'Make your choice'}
          </p>
          <PlayerChoiceSection player={p1} isHuman={p1Human} isLLM={p1LLM}
            loading={ld1} choice={ch1} onChoose={c => setCh1(c)} />
          <div className="divider" />
          <PlayerChoiceSection player={p2} isHuman={p2Human} isLLM={p2LLM}
            loading={ld2} choice={ch2} onChoose={c => setCh2(c)} />
          {canSimulateAll && (
            <button className="btn btn-primary" style={{ marginTop: '0.5rem' }} onClick={simulateAll}>
              Simulate All {totalRounds - round + 1} Remaining Rounds
            </button>
          )}
        </div>
      )}

      {/* Reveal */}
      {(phase === 'reveal' || phase === 'done') && lastResult && (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.75rem', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Round {phase === 'done' ? totalRounds : round} Result
          </p>
          <div className="reveal-grid">
            <div className={`reveal-card ${lastResult.c1 === 'C' ? 'coop' : 'defect'}`}>
              <div className="player-name">{p1.name}</div>
              <div className="choice-label">{lastResult.c1 === 'C' ? 'COOPERATE' : 'DEFECT'}</div>
              <div className="points">+{lastResult.pts1} pts</div>
              {lastResult.r1 && <div className="reasoning-box">"{lastResult.r1}"</div>}
            </div>
            <div className={`reveal-card ${lastResult.c2 === 'C' ? 'coop' : 'defect'}`}>
              <div className="player-name">{p2.name}</div>
              <div className="choice-label">{lastResult.c2 === 'C' ? 'COOPERATE' : 'DEFECT'}</div>
              <div className="points">+{lastResult.pts2} pts</div>
              {lastResult.r2 && <div className="reasoning-box">"{lastResult.r2}"</div>}
            </div>
          </div>
          <div className={`outcome-banner ${outcomeBannerClass(lastResult.c1, lastResult.c2)}`} style={{ marginTop: '0.75rem' }}>
            {outcomeDescription(lastResult.c1, lastResult.c2, p1.name, p2.name)}
          </div>
          {phase === 'reveal' && (
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={nextRound}>
              Next Round →
            </button>
          )}
        </div>
      )}

      {/* Game over */}
      {phase === 'done' && (
        <div className="card game-over">
          <div className={`winner-text ${score[0] === score[1] ? 'tie-text' : 'win-text'}`}>
            {score[0] > score[1] ? `${p1.name} wins!` : score[1] > score[0] ? `${p2.name} wins!` : "It's a tie!"}
          </div>
          <div className="final-scores">
            <div className="final-score-item">
              <div className="fsname">{p1.name}</div>
              <div className="fsnum" style={{ color: '#60a5fa' }}>{score[0]}</div>
            </div>
            <div style={{ color: '#475569', fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}>vs</div>
            <div className="final-score-item">
              <div className="fsname">{p2.name}</div>
              <div className="fsnum" style={{ color: '#a78bfa' }}>{score[1]}</div>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn btn-secondary" onClick={onReset}>New Game</button>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Round History
          </p>
          <table className="history-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{p1.name}</th>
                <th>{p2.name}</th>
                <th>+{p1.name.split(' ')[0]}</th>
                <th>+{p2.name.split(' ')[0]}</th>
                <th>∑{p1.name.split(' ')[0]}</th>
                <th>∑{p2.name.split(' ')[0]}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => {
                const cum1 = history.slice(0, i + 1).reduce((s, h) => s + h.pts1, 0);
                const cum2 = history.slice(0, i + 1).reduce((s, h) => s + h.pts2, 0);
                return (
                  <tr key={i}>
                    <td style={{ color: '#64748b' }}>{i + 1}</td>
                    <td><span className={r.c1 === 'C' ? 'pill-c' : 'pill-d'}>{r.c1 === 'C' ? 'Coop' : 'Defect'}</span></td>
                    <td><span className={r.c2 === 'C' ? 'pill-c' : 'pill-d'}>{r.c2 === 'C' ? 'Coop' : 'Defect'}</span></td>
                    <td style={{ color: '#94a3b8' }}>+{r.pts1}</td>
                    <td style={{ color: '#94a3b8' }}>+{r.pts2}</td>
                    <td style={{ fontWeight: 600, color: '#60a5fa' }}>{cum1}</td>
                    <td style={{ fontWeight: 600, color: '#a78bfa' }}>{cum2}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  return (
    <>
      <h1>Prisoner's Dilemma</h1>
      <p className="subtitle">cooperate or betray — man vs machine vs machine</p>
      {config
        ? <GameScreen config={config} onReset={() => setConfig(null)} />
        : <SetupScreen onStart={setConfig} />
      }
    </>
  );
}
