export const meta = {
  name: 'pazoru-games',
  description: 'Implement + adversarially verify the Sudoku and Shikaku game modules (unique-solution guarantee)',
  phases: [
    { title: 'Implement', detail: 'one agent per game writes the module + a headless test and runs it' },
    { title: 'Verify', detail: 'independent solution-counter proves each generated puzzle is unique' },
  ],
};

const CONTRACT = `
PazoruKore is a vanilla-ES-module, no-build puzzle engine. You are writing ONE game back-end module.
Read these existing files FIRST to match conventions exactly:
  - HANDOVER-PazoruKore.md  (§5 game contract, §12 generation/solving)  — the spec
  - src/core/grid.js        (the grid API you MUST use)
  - src/core/events.js      (EVENTS names)
  - src/core/rng.js         (makeGenRng)
  - tests/fake-game.js      (a tiny CONFORMANT example game — mirror its shape)
  - tests/engine.test.mjs   (how the engine drives a game)

HARD CONTRACT (must hold or the engine breaks):
  • playState shape = { grid, pencil }. grid is built by makeGrid(rows,cols,(r,c)=>({role,value,regionId,given}))
    from src/core/grid.js. value is ALWAYS a string ("1".."9") or null. pencil is a plain object {cellId:[sortedDigitStrings]}.
  • Roles come from ROLES in grid.js: given, fillable, clue, member, blank.
  • applyMove(state, move) is PURE — returns a NEW state via withCells(grid, patches); NEVER mutate. Return the same
    state object (===) for a no-op so the engine can skip it.
  • Use makeGenRng(seed) for ALL randomness so a gameId reproduces the puzzle. NEVER use Math.random in generation.
  • The module is the default export of src/games/<name>/index.js. Split heavy logic into generator.js + solver.js
    in the same folder and import them. No DOM, no rendering, no input handling — pure logic only.

REQUIRED module surface (exact names, per §5):
  meta:{ id, name, interaction, requirements:{glyphSet:'digits',needsOffState,needsRegionFill} }
  defaultParams(): Params (Params.seed is set by the engine if absent; include your gen knobs)
  newPuzzle(params, rng): { params, playState, solution }   // solution is a fully-solved playState
  validateMove(playState, move): boolean
  applyMove(playState, move): playState                      // PURE
  isSolved(playState): boolean
  findConflicts(playState): cellId[]                         // live error highlighting
  solve(playState): playState | null                         // self-solve (uniqueness + hints)
  hint(playState, solution): { ...descriptor } | null        // reveal ONE next forced step, not the whole solution
  eventsFor(prev, move, next): [{name, payload}]             // map your move types to EVENTS (optional but provide it)
  encodeParams(params, full): string                         // full=false omits gen-only fields (e.g. difficulty)
  decodeParams(string): Params
  encodeDesc(playState): string                              // the specific instance (clue layout)
  decodeDesc(params, string): playState

VERIFICATION YOU MUST DO before returning:
  Write tests/<name>.test.mjs using node:test. It must: build several puzzles across seeds, assert solve() returns a
  solution, assert isSolved(solution) is true, assert the puzzle has EXACTLY ONE solution (write an independent
  solution-counter in the test that counts up to 2 and asserts it stops at 1), and round-trip encodeDesc→decodeDesc.
  Run it with:  node --test tests/<name>.test.mjs   and paste the PASSING output into your final answer.
  Do NOT claim success unless the test actually passed. If generation is slow, cap it and report the timing.
`;

const SUDOKU = `${CONTRACT}
GAME = SUDOKU (§12.1). interaction:'digit-entry'. requirements:{glyphSet:'digits',needsOffState:true,needsRegionFill:false}.
  • 9×9 with 3×3 boxes (default). Generate a complete valid solution by randomized backtracking; then DIG HOLES while a
    solver confirms the solution stays UNIQUE; stop at the difficulty's target clue count.
  • Roles: givens → ROLES.given (value set, given:true); holes → ROLES.fillable (value:null, given:false).
  • Move types: {type:'place',id,value} (value 1..9), {type:'clear',id}, {type:'pencil',id,value} (toggle a candidate in
    state.pencil). validateMove rejects edits to given cells.
  • findConflicts: ids of cells that duplicate a value within their row, column, or 3×3 box.
  • Difficulty (gen-only param, omit from non-full game id): grade by hardest technique the solver needs (singles→pairs→…);
    expose presets easy/medium/hard via clue-count + technique tier. Keep it pragmatic; uniqueness is the must-have.
  • hint(state,solution): pick an empty, currently-correct cell and return {type:'place',id,value} from the solution.
  • encodeDesc: an 81-char givens string (digits, '.' = blank) is fine. decodeDesc rebuilds the grid (givens given:true/role given,
    blanks fillable).
Default params: { seed, size:9, box:3, difficulty:'easy' }.`;

const SHIKAKU = `${CONTRACT}
GAME = SHIKAKU (§12.2). interaction:'region-draw'. requirements:{glyphSet:'digits',needsOffState:false,needsRegionFill:true}.
  • Generate by randomly RECTANGULATING the whole grid into non-overlapping rectangles that tile it completely; place each
    rectangle's AREA as a clue digit in ONE chosen cell (the anchor).
  • UNIQUENESS IS THE HARD PART and is REQUIRED: a clue layout can admit multiple tilings. After generating, run a
    solver/uniqueness check (backtracking over candidate rectangles per clue, or exact-cover) that COUNTS solutions; if not
    unique, regenerate or move anchors. BUDGET this: cap attempts/time (e.g. ≤300ms or ≤200 attempts) and fall back to a
    smaller/known-good layout rather than hanging. Report the budget + typical generation time.
  • Default grid: 7×7 (proposed; provide easy/medium/hard as grid-size + clue-density presets). Anchors: ROLES.clue with
    value=String(area), given:true. Non-anchor cells: ROLES.blank initially; when assigned to a region they become ROLES.member
    with regionId set.
  • Move types: {type:'region-commit', clueId, cells:[cellId...]} → set regionId=clueId + role member on those cells (PURE).
    {type:'region-clear', clueId} → clear that region (cells back to blank, regionId null). validateMove: a committed rectangle
    must be axis-aligned, cover exactly one clue, area==clue, and not overlap an existing region.
  • findConflicts: ids in regions that overlap, or whose committed area ≠ its clue, or that cover 0 or >1 clue.
  • isSolved: every non-clue cell belongs to exactly one region and every clue's region is a rectangle with area==clue.
  • solve(state): return the unique tiling as a playState with every cell's regionId assigned. hint: reveal one correct region
    (return {type:'region-commit',clueId,cells:[...]}).
  • encodeDesc: the clue grid (area per anchor cell, 0/'.' elsewhere). decodeDesc rebuilds anchors.
Default params: { seed, size:7, difficulty:'easy' }.`;

const VERDICT = {
  type: 'object',
  properties: {
    game: { type: 'string' },
    testPassed: { type: 'boolean' },
    uniquenessConfirmed: { type: 'boolean' },
    solutionCountsSeen: { type: 'string', description: 'e.g. "all 1 across 12 seeds"' },
    typicalGenMs: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['game', 'testPassed', 'uniquenessConfirmed', 'summary'],
  additionalProperties: false,
};

const games = [
  { id: 'sudoku', prompt: SUDOKU },
  { id: 'shikaku', prompt: SHIKAKU },
];

const results = await pipeline(
  games,
  (g) => agent(g.prompt, { label: `implement:${g.id}`, phase: 'Implement', agentType: 'general-purpose' })
            .then((report) => ({ id: g.id, report })),
  (impl) => agent(
    `You are an ADVERSARIAL verifier for the PazoruKore ${impl.id} game module at src/games/${impl.id}/index.js.\n` +
    `Do NOT trust the module's own solver. Independently:\n` +
    `  1. Read src/games/${impl.id}/ and tests/${impl.id}.test.mjs.\n` +
    `  2. Run \`node --test tests/${impl.id}.test.mjs\` and capture the result.\n` +
    `  3. Write and run a SEPARATE throwaway script (in /tmp) that imports the module, generates puzzles across ~12 seeds,\n` +
    `     and for each counts solutions with YOUR OWN brute-force counter (stop at 2). Confirm every puzzle has exactly 1.\n` +
    `  4. Sanity-check applyMove purity (the prior snapshot is unchanged) and that isSolved(solution) is true.\n` +
    `Report the verdict. uniquenessConfirmed must be true ONLY if your independent counter saw exactly 1 for every puzzle.\n` +
    `Implementer's report follows for context:\n${impl.report}`,
    { label: `verify:${impl.id}`, phase: 'Verify', agentType: 'general-purpose', schema: VERDICT },
  ),
);

return { verdicts: results.filter(Boolean) };
