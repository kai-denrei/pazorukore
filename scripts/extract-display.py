#!/usr/bin/env python3
"""Extract the shared dexipurei display core + the three renderer modules from the
reference standalone HTMLs into ES modules under src/display/.

The references embed one <script> whose body is divided by `// --- path ---` markers
into core utils (identical across all three files) and one display module each. We:
  - take the 6 core sections from one reference, concat them, append a public `export {}`.
  - take each display module section, prepend an `import {...} from '../core.js'`, strip the
    trailing standalone IIFE, and append `export default __MOD__`.
No code inside the verbatim sections is altered — only module plumbing is added.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DISP = ROOT / "src" / "display"
(DISP / "displays").mkdir(parents=True, exist_ok=True)

def script_body(html: str) -> str:
    m = re.search(r"<script>\s*\"use strict\";(.*?)</script>", html, re.S)
    if not m:
        raise SystemExit("no <script> body found")
    return m.group(1)

def split_sections(body: str) -> dict:
    parts = re.split(r"\n// --- (.+?) ---\n", body)
    out = {}
    for i in range(1, len(parts), 2):
        out[parts[i].strip()] = parts[i + 1]
    return out

def strip_iife(section: str) -> str:
    # the standalone bootstrap IIFE is the last top-level `(function () {` block.
    idx = section.rfind("(function () {")
    return section[:idx].rstrip() if idx != -1 else section.rstrip()

refs = {
    "starburst16": ROOT / "starburst16-standalone.html",
    "lixie": ROOT / "lixie-standalone-2.html",
    "splitflap": ROOT / "splitflap-standalone.html",
}

# --- core.js (from starburst16; the 6 core sections are byte-identical across refs) ---
star_sec = split_sections(script_body(refs["starburst16"].read_text()))
core_order = ["core/rng.js", "core/color.js", "core/contract.js",
              "core/text-raster.js", "core/wear.js", "core/fx.js"]
core_public = [
    "mulberry32", "hash", "makeRng",                                  # rng
    "hex2rgb", "rgb2hex", "mix", "rgba", "oklch",                     # color
    "stageSize", "resolveParams",                                    # contract
    "textGrid", "builtinGrid", "rasterGrid", "trim",                 # text-raster
    "vary", "isWeak", "dust", "scratches", "grain",                  # wear
    "bloom", "vignette", "scanlines", "ambientGradient", "chromaticOffset",  # fx
]
core_header = (
    "// src/display/core.js — VENDORED from dexipurei-galore (do not edit; regenerate via\n"
    "// scripts/extract-display.py). The single seeded-PRNG + color + contract + text-raster\n"
    "// + wear + fx toolkit every renderer module shares. Adapters import named helpers from here.\n"
)
core_src = core_header + "".join(star_sec[k] for k in core_order)
core_src += "\nexport {\n  " + ",\n  ".join(core_public) + ",\n};\n"
(DISP / "core.js").write_text(core_src)
print("wrote src/display/core.js  (%d bytes)" % len(core_src))

# --- each display module ---
# imports = the helpers each module actually references (its USES array).
USES = {
    "starburst16": ["stageSize", "vignette", "hex2rgb", "rgba"],
    "lixie": ["stageSize", "bloom", "vignette", "hex2rgb", "mix", "rgba", "dust", "scratches"],
    "splitflap": ["stageSize", "hex2rgb", "mix", "rgba", "dust"],
}
for mod_id, path in refs.items():
    sec = split_sections(script_body(path.read_text()))
    key = "displays/%s.js" % mod_id
    body = strip_iife(sec[key])
    imp = "import { %s } from '../core.js';\n" % ", ".join(USES[mod_id])
    header = "// src/display/displays/%s.js — VENDORED renderer module (dexipurei-galore).\n" % mod_id
    out = header + imp + "\n" + body.lstrip("\n") + "\n\nexport default __MOD__;\n"
    (DISP / "displays" / ("%s.js" % mod_id)).write_text(out)
    print("wrote src/display/displays/%s.js  (%d bytes)" % (mod_id, len(out)))

print("done.")
