export const meta = {
  name: 'bridges-ui-review',
  description: 'Adversarially review the Bridges UI (interaction, rendering, integration) for real bugs',
  phases: [
    { title: 'Find', detail: 'one reviewer per dimension reads the code and lists candidate bugs' },
    { title: 'Verify', detail: 'an independent skeptic confirms each finding is a REAL bug' },
  ],
};

const CONTEXT = `
PazoruKore (vanilla ES modules, /Users/minikai/Dev/pazorukore) just gained a new game, BRIDGES
(Hashiwokakero). The LOGIC (src/games/bridges/{index,generator,solver}.js) is already verified by
tests/bridges.test.mjs (12/12 pass) — do NOT re-review the pure logic. Review the new UI integration.
Read these to ground every claim:
  - src/interaction/bridge-draw.js   (the new interaction: drag island→island, cycle 0→1→2)
  - src/skins/_bridge.js             (the shared island/bridge renderer)
  - src/ui/board.js                  (repaintGrid bridge call, _bridgeSums, the EVENTS.moved handler, pulse loop)
  - src/games/bridges/index.js       (the contract: playState={grid,bridges}, move {type:'bridge',a,b}, validateMove/applyMove/findConflicts/eventsFor)
  - src/ui/app.js                    (GAME_LOADERS bridges, bindInteraction routing, runDemo/solveFromSolution bridge branches, the scoring onSolved + undo tracking)
  - src/core/engine.js + src/core/events.js  (how moves/events/undo work)
Report ONLY real correctness/robustness bugs (with file:line, what breaks, and a concrete repro). Ignore
style/naming. Severity: high (broken/crash/wrong result) | med (edge case) | low (polish).
`;

const DIMS = [
  { key: 'interaction', prompt: `${CONTEXT}\nDIMENSION = the bridge-draw INTERACTION (src/interaction/bridge-draw.js). Hunt for: target-island selection wrong (non-collinear, blocked-by-third-island, crossing — does it defer correctly to validateMove?); the dominant-axis scan picking the wrong/far island; pointer cleanup leaks (window listeners, the preview div, highlight classes) on destroy or interrupted drags; multi-pointer / pointer-capture issues; a 1-cell-jitter drag mis-firing; releasing off-board; the preview line geometry for horizontal vs vertical; whether _legal() is called with a stale this.drag. Does cycling 2→0 work via the same gesture? Does it ever leave .is-bridge-* classes stuck?` },
  { key: 'rendering', prompt: `${CONTEXT}\nDIMENSION = the RENDERING + board integration (src/skins/_bridge.js + board.js repaintGrid/_bridgeSums + region-neon ghost-grid-for-bridges). Hunt for: bridges not repainting after a move on retro/pastel (no pulse loop) — is the EVENTS.moved 'do' branch correct and does it fire for bridge moves?; double-bridge parallel-line offset for vertical vs horizontal; island disc covering the number vs leaving it readable; conflict/satisfied colour using the right sets (engine.ui.conflicts vs sums); the pulse loop repainting bridges every frame (perf / does skin.bridge exist for all skins?); layering (lines under discs under numbers); the geom passed to bridge.paint having boxes for every island.` },
  { key: 'integration', prompt: `${CONTEXT}\nDIMENSION = GAME-FLOW integration (app.js + engine + scoring). Hunt for: UNDO/REDO with bridges — the engine snapshots playState incl. bridges (immutable?), does undo restore bridges and does the board repaint them (the moved dir!=='do' → repaintAll path)?; the scoring onSolved firing for bridges + undo-tracking (does an undo set app.undoUsed so a bridge solve isn't falsely "perfect"?); capability negotiation for bridges×each skin; bindInteraction routing 'bridge-draw'; the picker now listing bridges; runDemo/solveFromSolution bridge branches applying counts correctly (cycle count times — any off-by-one or crossing-order failure?); hint() for bridges via the controls '?' button; conflict events repainting island colour.` },
];

const FINDING = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' }, file: { type: 'string' }, severity: { type: 'string' },
          whatBreaks: { type: 'string' }, repro: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'whatBreaks'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'], additionalProperties: false,
};

const VERDICT = {
  type: 'object',
  properties: { title: { type: 'string' }, real: { type: 'boolean' }, severity: { type: 'string' }, fix: { type: 'string' }, note: { type: 'string' } },
  required: ['title', 'real', 'fix'], additionalProperties: false,
};

const results = await pipeline(
  DIMS,
  (d) => agent(d.prompt, { label: `find:${d.key}`, phase: 'Find', schema: FINDING, agentType: 'general-purpose' })
            .then((r) => ({ key: d.key, findings: (r && r.findings) || [] })),
  (r) => parallel((r.findings || []).map((f) => () =>
    agent(`You are a SKEPTIC. Independently confirm whether this is a REAL bug in the PazoruKore Bridges UI. Read the cited file(s) yourself; default to real=false unless you can show the concrete failure. Finding: ${JSON.stringify(f)}`,
      { label: `verify:${r.key}`, phase: 'Verify', schema: VERDICT, agentType: 'general-purpose' })
      .then((v) => ({ ...f, verdict: v })))),
);

const confirmed = results.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.real);
return { confirmed, total: results.flat().length };
