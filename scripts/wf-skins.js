export const meta = {
  name: 'pazoru-skins',
  description: 'Implement the Retro (Lixie) and Pastel (split-flap) skins following the Futuristic template',
  phases: [{ title: 'Implement', detail: 'one agent per skin mirrors the futuristic adapter against its display module' }],
};

const TEMPLATE = `
PazoruKore is a vanilla-ES-module, no-build puzzle engine. You are adding ONE skin bundle that wraps a
vendored dexipurei display module to the GlyphRenderer contract. A COMPLETE reference skin already exists —
mirror it exactly so the board/admin/engine work with zero changes.

READ FIRST (do not skip):
  - src/skins/_contract.js                  (the Skin + GlyphRenderer interfaces + the offscreen render model)
  - src/skins/futuristic/skin.js            (the bundle shape to mirror)
  - src/skins/futuristic/glyph-16seg.js     (THE ADAPTER PATTERN: reused offscreen canvas with p.transparent=true, blit to board)
  - src/skins/futuristic/region-neon.js
  - src/skins/futuristic/transitions.js
  - src/skins/futuristic/palette.css
  - src/ui/board.js                          (how glyph.paint(ctx, box, cell, view, anim) is called; how region.paint(ctx, geom) is called)
  - src/display/displays/<MODULE>.js         (YOUR display module — its render(ctx,p,t,rng), params schema, and presets)
  - src/display/core.js                      (makeRng is exported here)

HARD CONTRACT — your skin's GlyphRenderer MUST expose exactly (same names as glyph-16seg.js):
  id, params (= the display module's params array), measure()->{aspect}, getParams(), setParams(ov),
  setColors(pal), transitionFor(event)-> {duration,kind}|null, and
  paint(ctx, box, cell, view, anim):
    • box={x,y,w,h} logical px; cell={value,role,given}; view={selected,conflict,validated,pencil[],dim}; anim=null|{event,progress,elapsed,payload}
    • render the single glyph for cell.value (a string, or null) into a REUSED offscreen canvas sized box.w*dpr × box.h*dpr with
      offscreen._dpr=dpr and offscreen._transparent=true, calling <module>.render(offCtx, {...p, transparent:true, text: ch}, t, makeRng(p.seed)),
      then ctx.drawImage(off, box.x, box.y, box.w, box.h). value===null → renderOff (feed text ' ').
    • view.conflict → use the error color; cell.given → the given color; else the on color. Map anim.event→envelope like glyph-16seg withAnim.
  The skin bundle (default export) MUST expose: meta{id,name,description,capabilities{glyphSet:'digits',supportsOffState:true,supportsRegionFill:true}},
  glyph, region (with paint(ctx,geom)), renderPolicy(role)->'device'|'plain' (given/fillable/clue→device else plain),
  applyPalette(rootEl) (set the §8.3 OKLCH tokens on rootEl + add class skin-<id>), background(boardEl).

Write files under src/skins/<id>/: skin.js, glyph-<tech>.js, region-<name>.js, transitions.js, palette.css.
VERIFY before returning: run \`node --check\` on every file you wrote (copy to a .mjs first since they're ESM), and confirm imports
resolve relative to the file. Paste the check results. Do NOT edit anything outside src/skins/<id>/.
`;

const RETRO = `${TEMPLATE}
SKIN = RETRO (§9.2). id:'retro', name:'Retro'. MODULE = src/display/displays/lixie.js (edge-lit stacked-acrylic Lixie tube; reads
as Nixie warmth). interaction-agnostic.
  • Default to a WARM-AMBER look that reads as Nixie (use lixie's 'Amberglass' preset direction): glow color ~#ffc24a, warm-black bg.
    Also keep the on/given/error colors warm (given = brighter warm white, error = warm red).
  • renderOff: lixie with text ' ' already shows the faint always-visible ghost panels = an unlit tube. Good off-state — keep ghost modest.
  • transitions.js: cellPlaced → 'warmGlow' (ramp glow + bloomInt over the envelope), regionValidated → warm flush, conflictDetected →
    tube flicker (jitter brightness), solved → synchronized glow swell. Tune durations like futuristic.
  • region-warm.js: warm panel divisions (soft amber gridlines, less neon than futuristic) + a soft amber flush on validated regions.
  • palette.css + applyPalette: warm OKLCH tokens (amber/orange hues). Deep warm-black board background with a vignette feel.
Default seed constant for uniform tubes.`;

const PASTEL = `${TEMPLATE}
SKIN = PASTEL (§9.3). id:'pastel', name:'Pastel'. MODULE = src/display/displays/splitflap.js (electromechanical split-flap cards).
  • Soft pastel palette (cream card, dark ink, light background; cream/rose/sky/mint accents). LIGHT board background (not dark!).
  • THE HARD PART — one-shot flip, NOT the module's infinite t-driven cycle:
      - At REST (anim===null): show the SETTLED card for cell.value. Feed the module a t value PAST the cascade so it renders the
        flap flat/settled on the target (e.g. t = (cascade*flipMs + holdMs*0.5)), with text=value. For value===null feed text ' ' (blank card).
      - On cellPlaced (anim!=null): drive the flip ONCE. Map anim.progress→ a t that sweeps from 0 through the cascade so the card flips and
        lands on cell.value by progress=1 (e.g. t = anim.progress * cascade*flipMs). Keep flipMs/cascade modest so a single cell flip feels tactile.
      - transitionFor: cellPlaced/regionValidated → flap settle (duration ~420–600), conflictDetected → card jitter, solved → board flap cascade.
  • region-soft.js: soft colored panels with rounded corners; validated region tints the card field. Gridlines are gentle/light, not neon.
  • palette.css + applyPalette: pastel OKLCH tokens; light surface-bg.
Default seed constant.`;

const skins = [
  { id: 'retro', prompt: RETRO },
  { id: 'pastel', prompt: PASTEL },
];

const results = await parallel(skins.map((s) => () =>
  agent(s.prompt, { label: `skin:${s.id}`, phase: 'Implement', agentType: 'general-purpose' })
    .then((report) => ({ id: s.id, report }))));

return { skins: results.filter(Boolean) };
