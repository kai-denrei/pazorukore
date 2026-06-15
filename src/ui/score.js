// src/ui/score.js — the timer-linked scoring + combo engine. Rewards speed (continuous), sub-15s
// solves, and "perfect" solves (sub-15s AND no undo). Consecutive perfects build a combo that
// multiplies the whole game score and fires escalating callouts (PĀFEKUTO → Daburu → Toripuru → …).
// A "run" is 10 solved games; a flawless run (10/10 perfect) pays a big bonus + the perfect overlay.

export const SCORE = {
  base: 100,
  speedCap: 60,     // seconds beyond which the speed bonus is 0
  speedMax: 700,    // speed points at an instant solve
  fastUnder: 15,    // the "under 15 seconds" threshold
  fastBonus: 250,
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
    this.streak = 0;          // continuous consecutive perfects (persists across runs)
    this.best = this._loadBest();
  }

  // record a solved game (seconds elapsed + whether undo/redo was used). Returns a rich result.
  record(seconds, undoUsed) {
    if (this.gameInRun >= SCORE.runLen) this._newRun();   // previous run finished → fresh run

    const t = Math.max(0, seconds);
    const speed = Math.round(Math.max(0, SCORE.speedCap - t) / SCORE.speedCap * SCORE.speedMax);
    const fast = t < SCORE.fastUnder ? SCORE.fastBonus : 0;
    const raw = SCORE.base + speed + fast;
    const perfect = t < SCORE.fastUnder && !undoUsed;

    if (perfect) this.streak += 1; else this.streak = 0;
    const mult = perfect ? (1 + SCORE.comboStep * (this.streak - 1)) : 1;
    const points = Math.round(raw * mult);

    this.gameInRun += 1;
    this.runTotal += points;
    if (perfect) this.perfectsInRun += 1;

    const runComplete = this.gameInRun >= SCORE.runLen;
    let flawless = false, runBonus = 0, summary = null;
    if (runComplete) {
      flawless = this.perfectsInRun >= SCORE.runLen;
      runBonus = flawless ? SCORE.flawlessBonus : this.perfectsInRun * SCORE.perfectRunStep;
      this.runTotal += runBonus;
      summary = { total: this.runTotal, perfects: this.perfectsInRun, flawless, bonus: runBonus, best: this.best.runScore || 0 };
    }

    if (this.streak > (this.best.streak || 0)) this.best.streak = this.streak;
    if (runComplete && this.runTotal > (this.best.runScore || 0)) this.best.runScore = this.runTotal;
    this._saveBest();

    const tier = perfect ? Math.min(this.streak, HYPE.length - 1) : 0;
    return {
      t, points, perfect, mult, streak: this.streak,
      runTotal: this.runTotal, gameInRun: this.gameInRun, perfectsInRun: this.perfectsInRun,
      tier, callout: perfect ? { tier, label: HYPE[tier].label } : null,
      overlay: (perfect && this.streak >= SCORE.runLen) || (runComplete && flawless),
      runComplete, flawless, runBonus, summary,
      parts: { base: SCORE.base, speed, fast },
    };
  }

  _newRun() { this.gameInRun = 0; this.runTotal = 0; this.perfectsInRun = 0; } // streak persists across runs

  _loadBest() { try { return JSON.parse(localStorage.getItem(LS) || 'null') || { runScore: 0, streak: 0 }; } catch (_) { return { runScore: 0, streak: 0 }; } }
  _saveBest() { try { localStorage.setItem(LS, JSON.stringify(this.best)); } catch (_) {} }
}

export default ScoreKeeper;
