// src/ui/score.js — the timer-linked scoring + combo engine. Rewards speed (continuous), sub-15s
// solves, and "perfect" solves (sub-15s AND no undo). Consecutive perfects build a combo that
// multiplies the whole game score and fires escalating callouts (PĀFEKUTO → Daburu → Toripuru → …).
// A "run" is 10 solved games; a flawless run (10/10 perfect) pays a big bonus + the perfect overlay.

export const SCORE = {
  base: 100,
  speedCap: 60,     // seconds beyond which the speed bonus is 0 (legacy path)
  speedMax: 700,    // speed points at an instant solve (legacy path)
  fastUnder: 15,    // the "under 15 seconds" threshold (legacy path)
  fastBonus: 250,
  clockPts: 50,     // staged path: score points per second of clock remaining/over
  comboStep: 0.5,   // multiplier gained per consecutive perfect (1.0, 1.5, 2.0, …)
  flawlessBonus: 5000,
  perfectRunStep: 250,
  runLen: 10,
};

// callout ladder, indexed by streak (1-based). 10+ caps at 完璧.
export const HYPE = [
  null,
  { label: 'PĀFEKUTO!' },   // 1 — sub-15s + no undo
  { label: 'DABURU!' },     // 2
  { label: 'TORIPURU!' },   // 3
  { label: '四連続!' },      // 4
  { label: 'ペンタキル!' },   // 5
  { label: 'SEXTUPLE!' },   // 6
  { label: 'HEPTAPOD!' },   // 7
  { label: 'OCTOPUS!' },    // 8
  { label: 'PENULTIMATE!' },// 9
  { label: '完璧!' },        // 10+ — flawless / overlay tier
];

const LS = 'pazoru.score.best';

export class ScoreKeeper {
  constructor() {
    this.runTotal = 0;
    this.gameInRun = 0;       // 0 before the first solve; 1..10 within a run
    this.perfectsInRun = 0;
    this.rounds = [];         // per-round detail for the end-of-run recap dashboard
    this.streak = 0;          // continuous consecutive perfects (persists across runs)
    this.best = this._loadBest();
  }

  // record a solved game. Legacy signature record(seconds, undoUsed) keeps the speed/fast formula.
  // Staged signature record(seconds, undoUsed, { budget }) uses the countdown clock as the modifier.
  record(seconds, undoUsed, opts = {}) {
    if (this.gameInRun >= SCORE.runLen) this._newRun();   // previous run finished → fresh run

    const t = Math.max(0, seconds);
    const staged = typeof opts.budget === 'number';

    let raw, perfect, overBy = 0, parts;
    if (staged) {
      const timeLeft = opts.budget - t;                   // may be negative
      const clock = Math.max(timeLeft, -SCORE.base / SCORE.clockPts); // clamp so raw floors at 0
      raw = SCORE.base + clock * SCORE.clockPts;          // ≥ 0
      perfect = timeLeft > 0 && !undoUsed;
      overBy = Math.max(0, -timeLeft);
      parts = { base: SCORE.base, clock: Math.round(clock * SCORE.clockPts) };
    } else {
      const speed = Math.round(Math.max(0, SCORE.speedCap - t) / SCORE.speedCap * SCORE.speedMax);
      const fast = t < SCORE.fastUnder ? SCORE.fastBonus : 0;
      raw = SCORE.base + speed + fast;
      perfect = t < SCORE.fastUnder && !undoUsed;
      parts = { base: SCORE.base, speed, fast };
    }

    if (perfect) this.streak += 1; else this.streak = 0;
    const mult = perfect ? (1 + SCORE.comboStep * (this.streak - 1)) : 1;
    const points = Math.max(0, Math.round(raw * mult));

    // session high-score: fastest round ever (a real solve only — t > 0)
    if (t > 0) this.best.fastestRound = this.best.fastestRound == null ? t : Math.min(this.best.fastestRound, t);

    this.gameInRun += 1;
    this.runTotal += points;
    if (perfect) this.perfectsInRun += 1;
    const roundTier = perfect ? Math.min(this.streak, HYPE.length - 1) : 0;
    this.rounds.push({ n: this.gameInRun, t, perfect, points, overBy, label: perfect ? HYPE[roundTier].label : null });

    const runComplete = this.gameInRun >= SCORE.runLen;
    let flawless = false, runBonus = 0, summary = null;
    if (runComplete) {
      flawless = this.perfectsInRun >= SCORE.runLen;
      runBonus = flawless ? SCORE.flawlessBonus : this.perfectsInRun * SCORE.perfectRunStep;
      this.runTotal += runBonus;
      // session high-score: keep the top-3 run totals, descending
      this.best.topRuns = [...(this.best.topRuns || []), this.runTotal].sort((a, b) => b - a).slice(0, 3);
      summary = {
        total: this.runTotal, perfects: this.perfectsInRun, flawless, bonus: runBonus,
        best: this.best.runScore || 0, rounds: this.rounds.slice(),
        fastestRound: this.best.fastestRound != null ? this.best.fastestRound : null,
        topRuns: this.best.topRuns.slice(),
      };
    }

    if (this.streak > (this.best.streak || 0)) this.best.streak = this.streak;
    if (runComplete && this.runTotal > (this.best.runScore || 0)) this.best.runScore = this.runTotal;
    this._saveBest();

    const tier = perfect ? Math.min(this.streak, HYPE.length - 1) : 0;
    return {
      t, points, perfect, mult, streak: this.streak, overBy,
      runTotal: this.runTotal, gameInRun: this.gameInRun, perfectsInRun: this.perfectsInRun,
      tier, callout: perfect ? { tier, label: HYPE[tier].label } : null,
      overlay: (perfect && this.streak >= SCORE.runLen) || (runComplete && flawless),
      runComplete, flawless, runBonus, summary,
      parts,
    };
  }

  _newRun() { this.gameInRun = 0; this.runTotal = 0; this.perfectsInRun = 0; this.rounds = []; } // streak persists across runs

  _loadBest() {
    const def = { runScore: 0, streak: 0, fastestRound: null, topRuns: [] };
    try { return { ...def, ...(JSON.parse(localStorage.getItem(LS) || 'null') || {}) }; } catch (_) { return { ...def }; }
  }
  _saveBest() { try { localStorage.setItem(LS, JSON.stringify(this.best)); } catch (_) {} }
}

export default ScoreKeeper;
