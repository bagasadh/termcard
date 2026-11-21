// Infinite pan-anywhere tile field rendered via WebGL with a 2D canvas fallback.
// Uses a wrapped 7-column layout, inertia physics, SDF rounded corners, and pure-math hit testing.

const CFG = {
  colWidth: 420,
  gap: 36,
  columns: 7,
  zoomRef: 1840,
  minZoom: 0.46,
  heroFill: 0.84,
  heroFillBelow: 700,
  friction: 0.928,
  touchFriction: 0.954,
  wheel: 7,
  keySpeed: 1500,
  drift: 20,
  idleDelay: 1.8,
  bend: 0.11,
  maxBend: 0.2,
  speedTau: 0.12,
  flingWindow: 110,
  speedZoom: 0.045,
  radius: 10,
  segments: 20,
  flyDuration: 1.5,
  flyMaxDuration: 2.4,
  cullMargin: 0.25,
};

const C = CFG.colWidth;
const G = CFG.gap;
const C2 = C * 2 + G;
const PAD = 32;
const CAP_PAD = 4;
const MARKETPLACE = "https://github.com/marketplace/actions/termcard-profile-svg-generator";
const REPO = "https://github.com/bagasadh/termcard";

const PALETTES = {
  dark: {
    clear: [0, 0, 0],
    bg: "#000000",
    surface: "#202020",
    hairline: "#333333",
    border: "#808080",
    text: "#ffffff",
    muted: "#b8b8b8",
    bone: "#ffffff",
    boneInk: "#000000",
    boneMuted: "#525252",
    boneBorder: "#767676",
    dim: "rgba(255,255,255,0.24)",
  },
  light: {
    clear: [1, 1, 1],
    bg: "#ffffff",
    surface: "#f4f4f4",
    hairline: "#d6d6d6",
    border: "#767676",
    text: "#000000",
    muted: "#525252",
    bone: "#202020",
    boneInk: "#ffffff",
    boneMuted: "#c2c2c2",
    boneBorder: "#8a8a8a",
    dim: "rgba(0,0,0,0.22)",
  },
};

const FONTS = {
  sans: '"IBM Plex Sans", system-ui, -apple-system, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const SPECS = [
  { key: "typing-dark", n: "01", title: "Typing banner", tag: "dashed-dark", preset: "dashed-dark", stage: "dark" },
  { key: "info-dark", n: "02", title: "Info specs", tag: "dashed-dark", preset: "dashed-dark", stage: "dark" },
  { key: "streak-green", n: "03", title: "Live streak", tag: "terminal-green", preset: "terminal-green", stage: "dark" },
  { key: "light-pair", n: "04", title: "Light theme", tag: "dashed-light", preset: "dashed-light", stage: "light" },
  { key: "solid-dark-streak", n: "05", title: "Solid dark", tag: "solid-dark", preset: "solid-dark", stage: "dark" },
  { key: "solid-light-link", n: "06", title: "Clickable links", tag: "solid-light", preset: "solid-light", stage: "light" },
];
const LIVE_SPEC = { key: "live", n: "LIVE", title: "Your README stack", tag: "your config", preset: null, stage: "dark" };
const SPEC_BY_KEY = Object.fromEntries([...SPECS, LIVE_SPEC].map((s) => [s.key, s]));

const STEPS = [
  { n: "01", dark: true, h: "Open your profile repo", p: "Go to github.com/username/username. Create a public repo named like your username if needed." },
  { n: "02", dark: true, h: "Add termcard.json", p: "Click Add file then Create new file, name it termcard.json, paste your config, and commit." },
  { n: "03", dark: false, h: "Workflow and markers", p: "Create .github/workflows/termcard.yml from the builder, then add the two TERMCARD comment lines to README.md." },
  { n: "04", dark: false, h: "Run the Action once", p: "Open the Actions tab, select Update termcard, and click Run workflow. Your SVGs update daily after that." },
];

const wrapD = (d, size) => d - size * Math.round(d / size);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2);
const easeOut = (k) => 1 - (1 - k) ** 2;

const VS_BODY = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uOffset;
uniform vec2 uSize;
uniform vec2 uView;
uniform float uBend;
uniform float uReveal;
varying vec2 vUv;
void main() {
  vUv = aUv;
  float s = mix(0.92, 1.0, uReveal);
  vec2 rel = uOffset + aPos * uSize * s;
  vec2 ndc = rel / uView;
  float r2 = dot(ndc, ndc);
  ndc *= 1.0 - 2.0 * uBend * r2 / (1.0 + r2);
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const FS_BODY = `
uniform sampler2D uMap;
uniform sampler2D uMap2;
uniform vec2 uSize;
uniform float uRadius;
uniform float uHover;
uniform float uReveal;
uniform float uZoom;
uniform float uAlt;
varying vec2 vUv;
void main() {
  vec2 uv = (vUv - 0.5) * (1.0 - 0.04 * uHover * uZoom) + 0.5;
  vec3 col = texture2D(uMap, uv).rgb;
  if (uAlt > 0.5) {
    col = mix(col, texture2D(uMap2, uv).rgb, uHover);
  } else {
    col = mix(col, col * 1.05 + 0.014, uHover);
  }
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - uSize * 0.5 + uRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = 1.0 - smoothstep(-1.0, 0.5, d);
  gl_FragColor = vec4(col, a * uReveal);
}
`;

function createGL(canvasEl, segCount = CFG.segments) {
  const opts = { antialias: true, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" };
  let isWebGL2 = true;
  let gl = canvasEl.getContext("webgl2", opts);
  if (!gl) {
    isWebGL2 = false;
    gl = canvasEl.getContext("webgl", opts);
  }
  if (!gl) return null;

  const highp = gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision > 0;
  const prec = highp ? "precision highp float;\n" : "precision mediump float;\n";

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("termcard shader compile error:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, prec + VS_BODY);
  const fs = compile(gl.FRAGMENT_SHADER, prec + FS_BODY);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("termcard shader link error:", gl.getProgramInfoLog(prog));
    return null;
  }

  // Build subdivided unit quad (segCount x segCount) so barrel bend curves smoothly.
  const seg = segCount;
  const cols = seg + 1;
  const verts = new Float32Array(cols * cols * 4);
  let vi = 0;
  for (let iy = 0; iy <= seg; iy += 1) {
    const v = iy / seg;
    const py = v - 0.5;
    for (let ix = 0; ix <= seg; ix += 1) {
      const u = ix / seg;
      verts[vi++] = u - 0.5;
      verts[vi++] = py;
      verts[vi++] = u;
      verts[vi++] = v;
    }
  }
  const indices = new Uint16Array(seg * seg * 6);
  let ii = 0;
  for (let iy = 0; iy < seg; iy += 1) {
    for (let ix = 0; ix < seg; ix += 1) {
      const a = iy * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[ii++] = a;
      indices[ii++] = c;
      indices[ii++] = b;
      indices[ii++] = b;
      indices[ii++] = c;
      indices[ii++] = d;
    }
  }

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aUv = gl.getAttribLocation(prog, "aUv");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

  const u = {};
  for (const name of ["uOffset", "uSize", "uView", "uBend", "uReveal", "uMap", "uMap2", "uRadius", "uHover", "uZoom", "uAlt"]) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  gl.uniform1i(u.uMap, 0);
  gl.uniform1i(u.uMap2, 1);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const anisoExt =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  const maxAniso = anisoExt ? Math.min(4, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;

  const textures = [];
  function createTexture(sourceCanvas) {
    const tex = gl.createTexture();
    textures.push(tex);
    uploadTexture(tex, sourceCanvas);
    return tex;
  }

  function uploadTexture(tex, sourceCanvas) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    if (isWebGL2) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (anisoExt && maxAniso > 1) {
        gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  return {
    gl,
    u,
    indexCount: indices.length,
    createTexture,
    uploadTexture,
    setClear(rgb) {
      gl.clearColor(rgb[0], rgb[1], rgb[2], 1);
    },
    resize(pw, ph) {
      gl.viewport(0, 0, pw, ph);
    },
    destroy() {
      for (const tex of textures) gl.deleteTexture(tex);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

function buildUnits() {
  const one = (kind, h, cols = 1, extra = {}) => ({
    cols,
    items: [{ kind, x: 0, y: 0, w: cols === 2 ? C2 : C, h, ...extra }],
  });
  const spec = (key, cols, h) => {
    const w = cols === 2 ? C2 : C;
    const sh = h ?? (cols === 2 ? Math.round((w * 9) / 16) : 420);
    const s = SPEC_BY_KEY[key];
    return {
      cols,
      items: [
        { kind: "specimen", spec: s, x: 0, y: 0, w, h: sh },
        { kind: "caption", spec: s, x: 0, y: sh + 6, w, h: 58 },
      ],
    };
  };
  const setupBlock = {
    cols: 2,
    anchor: "setup",
    items: [
      { kind: "setupHead", x: 0, y: 0, w: C, h: 240 },
      { kind: "step", step: STEPS[0], x: 0, y: 240 + G, w: C, h: 430 },
      { kind: "step", step: STEPS[2], x: 0, y: 670 + G * 2, w: C, h: 430 },
      { kind: "step", step: STEPS[1], x: C + G, y: 0, w: C, h: 600 },
      { kind: "step", step: STEPS[3], x: C + G, y: 600 + G, w: C, h: 500 + G },
    ],
  };
  const pin = (u, col) => ({ ...u, col });
  return [
    pin({ ...one("hero", 600, 2), anchor: "hero" }, 0),
    pin(one("intro", 557), 2),
    pin(spec("streak-green", 2), 3),
    pin(one("clock", 230), 5),
    pin(spec("info-dark", 1, 540), 6),
    pin(spec("typing-dark", 2), 0),
    setupBlock,
    one("presetsHead", 291),
    { ...one("cta", 440, 2), anchor: "cta" },
    spec("light-pair", 2),
    spec("solid-dark-streak", 2),
    spec("solid-light-link", 1, 500),
    spec("live", 1, 560),
    spec("typing-dark", 1),
    one("hello", 200),
    spec("streak-green", 1),
    spec("solid-light-link", 2),
    spec("info-dark", 1),
    spec("light-pair", 1),
    spec("solid-dark-streak", 1),
  ];
}

function pack(units) {
  const n = CFG.columns;
  const heights = new Array(n).fill(0);
  const placed = [];
  const holes = [];
  units.forEach((u, unitId) => {
    const uh = Math.max(...u.items.map((i) => i.y + i.h)) + G;
    const yAt = (c) => (u.cols === 2 ? Math.max(heights[c], heights[(c + 1) % n]) : heights[c]);
    let best = 0;
    let bestY = Infinity;
    if (u.col !== undefined) {
      best = u.col % n;
      bestY = yAt(best);
    } else {
      for (let c = 0; c < n; c += 1) {
        const y = yAt(c);
        if (y < bestY - 1) {
          bestY = y;
          best = c;
        }
      }
    }
    for (let k = 0; k < u.cols; k += 1) {
      const c = (best + k) % n;
      if (bestY - heights[c] >= 140 + G) holes.push({ c, y: heights[c], h: bestY - heights[c] - G });
      heights[c] = bestY + uh;
    }
    for (const it of u.items) {
      placed.push({ ...it, x: best * (C + G) + it.x, y: bestY + it.y, anchor: u.anchor, unit: unitId });
    }
  });
  const H = Math.max(...heights);
  const W = n * (C + G);
  for (let c = 0; c < n; c += 1) {
    const rest = H - heights[c] - G;
    if (rest >= 140) holes.push({ c, y: heights[c], h: rest });
  }
  let f = 0;
  for (const hole of holes) {
    placed.push({ kind: "filler", n: f, x: hole.c * (C + G), y: hole.y, w: C, h: hole.h, unit: null });
    f += 1;
  }
  return { placed, W, H };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function parseSvgDimensions(svgStr) {
  const wM = String(svgStr || "").match(/\bwidth="([\d.]+)"/);
  const hM = String(svgStr || "").match(/\bheight="([\d.]+)"/);
  return {
    w: wM ? parseFloat(wM[1]) : 466,
    h: hM ? parseFloat(hM[1]) : 100,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgStr || ""))}`,
  };
}

function parseDash(str) {
  if (!str) return [];
  return String(str)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

function buildTypingFrames(words) {
  const list = (Array.isArray(words) ? words : String(words || "Hi, fastfetch").split(","))
    .map((w) => String(w).trim())
    .filter(Boolean);
  if (!list.length) list.push("Hi");
  const frames = [];
  for (const word of list) {
    frames.push(["", true], ["", false]);
    for (let c = 1; c <= word.length; c += 1) {
      frames.push([word.slice(0, c), true]);
    }
    for (let h = 0; h < 8; h += 1) {
      frames.push([word, Math.floor(h / 2) % 2 === 0]);
    }
    for (let c = word.length - 1; c >= 0; c -= 1) {
      frames.push([word.slice(0, c), true]);
    }
    frames.push(["", true], ["", false]);
  }
  return { frames, firstWord: list[0] };
}

function typingStepIndex(item, timeSec) {
  const dur = Math.max(2, Number(item.duration) || 8);
  const frac = (((timeSec % dur) + dur) % dur) / dur;
  return Math.min(item.frames.length - 1, Math.floor(frac * item.frames.length));
}

function drawTypingCard(ctx, item, x, y, dw, dh, timeSec, paused) {
  const t = item.theme;
  const w = t.width || 460;
  const h = 68;
  const rx = Number(t.radius ?? 6);
  const innerW = w - 2;
  const promptTop = item.card.prompt_top ?? "\u250c your-username";
  const promptBottom = item.card.prompt_bottom ?? "\u2514\u203a";

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dw / item.w, dh / item.h);
  ctx.translate(3, 3);

  if (t.outline) {
    ctx.save();
    ctx.globalAlpha = Number(t.outline_opacity ?? 0.8);
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = 3.5;
    ctx.setLineDash(parseDash(t.outline_dasharray));
    ctx.lineDashOffset = 1;
    ctx.beginPath();
    ctx.roundRect(1, 1, innerW, h, rx);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = Number(t.bg_opacity ?? 0.5);
  ctx.fillStyle = t.bg;
  ctx.beginPath();
  ctx.roundRect(1, 1, innerW, h, rx);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = t.stroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(parseDash(t.dasharray));
  ctx.beginPath();
  ctx.roundRect(1, 1, innerW, h, rx);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(12, 4, w - 24, h - 6);
  ctx.clip();

  ctx.font = fnt(400, 14, FONTS.mono);
  ctx.fillStyle = t.text;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(promptTop, 24, 30);
  ctx.fillText(promptBottom, 24, 54);

  const stepIdx = typingStepIndex(item, timeSec);
  let [typedText, cursorOn] = item.frames[stepIdx] || [item.firstWord, true];
  if (paused && !typedText) {
    typedText = item.firstWord;
    cursorOn = true;
  }

  const startX = 24 + (promptBottom.length + 1) * 8.4;
  if (typedText) {
    ctx.fillText(typedText, startX, 54);
  }
  if (cursorOn) {
    const cursorX = startX + (typedText ? ctx.measureText(typedText).width : 0);
    ctx.fillRect(cursorX, 41, 1.5, 16);
  }
  ctx.restore();

  ctx.restore();
}

const clockFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const clockSecFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const fmtCoord = (v) => (v < 0 ? "\u2212" : "+") + String(Math.abs(Math.round(v)) % 10000).padStart(4, "0");

const fnt = (weight, size, fam, style = "") => `${style ? `${style} ` : ""}${weight} ${size}px ${fam}`;
function setSpacing(ctx, px) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}
function inkWidth(ctx, text) {
  const m = ctx.measureText(text);
  const w = (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0);
  return Math.max(m.width, w);
}
function fitText(ctx, text, weight, size, fam, maxW, style = "") {
  let s = size;
  ctx.font = fnt(weight, s, fam, style);
  let tw = inkWidth(ctx, text);
  for (let k = 0; k < 4 && tw > maxW; k += 1) {
    s *= (maxW / tw) * 0.99;
    ctx.font = fnt(weight, s, fam, style);
    tw = inkWidth(ctx, text);
  }
  return s;
}
function drawMono(ctx, text, x, y, color, align = "left", size = 14, maxW = Infinity) {
  const t = String(text).toUpperCase();
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = align;
  setSpacing(ctx, 1.4);
  fitText(ctx, t, 500, size, FONTS.mono, maxW);
  ctx.fillText(t, x, y);
  const w = inkWidth(ctx, t);
  setSpacing(ctx, 0);
  ctx.textAlign = "left";
  return w;
}
function drawWrap(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (inkWidth(ctx, test) > maxW && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
  return cy + lh;
}
function drawPill(ctx, text, x, y, fillBg, textColor, strokeColor) {
  ctx.font = fnt(600, 18, FONTS.sans);
  const tw = ctx.measureText(text).width;
  const pw = Math.ceil(tw + 44);
  const ph = 46;
  ctx.beginPath();
  ctx.roundRect(x, y, pw, ph, ph / 2);
  if (fillBg) {
    ctx.fillStyle = fillBg;
    ctx.fill();
  }
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = textColor;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, x + pw / 2, y + ph / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return { x, y, w: pw, h: ph };
}

export function initCanvas(o) {
  const { stage } = o;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const canAim = matchMedia("(any-pointer: fine)").matches;
  o.hint.textContent = coarse && !canAim ? "SWIPE TO EXPLORE" : "DRAG \u00b7 ARROWS \u00b7 B BUILDER \u00b7 \u21b5 OPEN";

  let canvasEl = document.createElement("canvas");
  stage.replaceChildren(canvasEl);

  const glCtx = createGL(canvasEl, coarse ? 12 : CFG.segments);
  let ctx2d = null;
  if (!glCtx) {
    // A canvas whose WebGL context succeeded once cannot return a 2D context, so create a fresh element.
    canvasEl = document.createElement("canvas");
    stage.replaceChildren(canvasEl);
    ctx2d = canvasEl.getContext("2d", { alpha: false });
  }

  let P = PALETTES[o.getTheme?.() === "light" ? "light" : "dark"];
  glCtx?.setClear(P.clear);

  const { placed, W, H } = pack(buildUnits());

  let vw = 1;
  let vh = 1;
  let dpr = 1;
  let zoom = 1;
  let zoomEff = 1;
  let texScale = 1.5;

  function resize() {
    vw = Math.max(1, stage.clientWidth);
    vh = Math.max(1, stage.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasEl.width = Math.round(vw * dpr);
    canvasEl.height = Math.round(vh * dpr);
    glCtx?.resize(canvasEl.width, canvasEl.height);
    zoom = clamp(vw / CFG.zoomRef, CFG.minZoom, 1);
    if (vw < CFG.heroFillBelow) zoom = Math.min(zoom, (CFG.heroFill * vw) / C2);
    dirty = true;
  }

  let dirty = true;
  resize();
  texScale = clamp(dpr * zoom * 1.15, 0.85, 2);

  let faviconImg = null;
  const specImgCache = new Map();

  function makeTileCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * texScale));
    c.height = Math.max(1, Math.round(h * texScale));
    const ctx = c.getContext("2d");
    return { c, ctx };
  }

  function drawCardFrame(ctx, w, h, bg, border) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(1, 1, w - 2, h - 2, Math.max(0, CFG.radius - 1));
      ctx.stroke();
    }
  }

  function paintTile(tile, ctx, w, h, hot = false) {
    ctx.setTransform(texScale, 0, 0, texScale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (tile.kind === "hero") {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      drawMono(ctx, "Open source action", PAD + 4, 52, P.boneMuted, "left", 14);
      drawMono(ctx, "MIT / Python 3", w - PAD - 4, 52, P.boneMuted, "right", 14);

      let lx = PAD + 4;
      const logoBaseY = 278;
      if (faviconImg) {
        const iconSize = 86;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(lx, logoBaseY - iconSize + 10, iconSize, iconSize, 14);
        ctx.clip();
        ctx.drawImage(faviconImg, lx, logoBaseY - iconSize + 10, iconSize, iconSize);
        ctx.restore();
        lx += iconSize + 22;
      }

      ctx.textBaseline = "alphabetic";
      ctx.font = fnt(400, 122, FONTS.serif, "italic");
      ctx.fillStyle = P.boneInk;
      ctx.fillText("term", lx, logoBaseY);
      const tw = ctx.measureText("term").width;
      setSpacing(ctx, -5);
      ctx.font = fnt(700, 114, FONTS.mono);
      ctx.fillText("card", lx + tw + 4, logoBaseY);
      setSpacing(ctx, 0);

      ctx.font = fnt(400, 28, FONTS.sans);
      ctx.fillStyle = P.boneMuted;
      ctx.fillText("by ", PAD + 4, logoBaseY + 48);
      const byW = ctx.measureText("by ").width;
      ctx.font = fnt(400, 36, FONTS.serif, "italic");
      ctx.fillStyle = P.boneInk;
      ctx.fillText("bagasadh", PAD + 4 + byW, logoBaseY + 48);

      ctx.font = fnt(500, 30, FONTS.sans);
      ctx.fillStyle = P.boneInk;
      setSpacing(ctx, -0.6);
      drawWrap(ctx, "Terminal-styled SVG cards for GitHub READMEs. Pick a theme, edit details, copy into GitHub.", PAD + 4, h - 166, w - PAD * 2 - 8, 38);
      setSpacing(ctx, 0);

      const b1 = drawPill(ctx, "Build your cards", PAD + 4, h - 82, P.boneInk, P.bone, P.boneInk);
      const b2 = drawPill(ctx, "Marketplace \u2197", PAD + 4 + b1.w + 12, h - 82, null, P.boneInk, P.boneInk);
      drawMono(ctx, "Drag \u00b7 fling \u00b7 tap", w - PAD - 4, h - 52, P.boneMuted, "right", 14);
      tile.chips = [
        { ...b1, action: { type: "builder" }, label: "Open builder <b>\u2197</b>" },
        { ...b2, action: { type: "href", url: MARKETPLACE }, label: "GitHub Marketplace <b>\u2197</b>" },
      ];
      return;
    }

    if (tile.kind === "intro") {
      drawCardFrame(ctx, w, h, P.surface, P.hairline);
      drawMono(ctx, "About termcard", PAD, 50, P.muted, "left", 14);
      ctx.fillStyle = P.text;
      ctx.font = fnt(500, 38, FONTS.sans);
      setSpacing(ctx, -1);
      const ny = drawWrap(ctx, "Static SVGs built in your repo.", PAD, 148, w - PAD * 2, 46);
      ctx.font = fnt(400, 44, FONTS.serif, "italic");
      drawWrap(ctx, "One JSON file and a GitHub Action.", PAD, ny + 14, w - PAD * 2, 48);
      setSpacing(ctx, 0);
      drawMono(ctx, "Typing \u00b7 Info \u00b7 Streak \u00b7 Link", PAD, h - 36, P.muted, "left", 13);
      return;
    }

    if (tile.kind === "clock") {
      drawCardFrame(ctx, w, h, P.surface, P.hairline);
      drawMono(ctx, "Your local time", PAD, 50, P.muted, "left", 14);
      ctx.fillStyle = P.text;
      ctx.beginPath();
      ctx.arc(w - PAD - 6, 44, 6, 0, Math.PI * 2);
      ctx.fill();
      setSpacing(ctx, -4);
      fitText(ctx, clockFmt.format(new Date()), 500, 100, FONTS.sans, w - PAD * 2);
      ctx.fillStyle = P.text;
      ctx.fillText(clockFmt.format(new Date()), PAD, h - 36);
      setSpacing(ctx, 0);
      return;
    }

    if (tile.kind === "setupHead") {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      drawMono(ctx, "No terminal needed / 04", PAD, 50, P.boneMuted, "left", 14);
      ctx.fillStyle = P.boneInk;
      setSpacing(ctx, -2.5);
      ctx.font = fnt(700, 56, FONTS.sans);
      drawWrap(ctx, "Add to GitHub in 4 steps.", PAD, 128, w - PAD * 2, 58);
      setSpacing(ctx, 0);
      return;
    }

    if (tile.kind === "step") {
      const dark = tile.step.dark;
      drawCardFrame(ctx, w, h, dark ? P.surface : P.bone, dark ? P.hairline : P.boneBorder);
      drawMono(ctx, `Step ${tile.step.n} / 04`, PAD, 50, dark ? P.muted : P.boneMuted, "left", 14);
      ctx.fillStyle = dark ? P.text : P.boneInk;
      setSpacing(ctx, -1.6);
      ctx.font = fnt(700, 42, FONTS.sans);
      const ny = drawWrap(ctx, tile.step.h, PAD, 122, w - PAD * 2, 46);
      setSpacing(ctx, -0.2);
      ctx.font = fnt(400, 21, FONTS.sans);
      ctx.fillStyle = dark ? P.muted : P.boneMuted;
      drawWrap(ctx, tile.step.p, PAD, ny + 18, w - PAD * 2, 31);
      setSpacing(ctx, 0);
      return;
    }

    if (tile.kind === "presetsHead") {
      drawCardFrame(ctx, w, h, P.surface, P.hairline);
      drawMono(ctx, "Presets / 06", PAD, 50, P.muted, "left", 14);
      ctx.fillStyle = P.text;
      setSpacing(ctx, -2.2);
      ctx.font = fnt(600, 58, FONTS.sans);
      ctx.fillText("Pick a", PAD, h - 98);
      setSpacing(ctx, 0);
      ctx.font = fnt(400, 72, FONTS.serif, "italic");
      ctx.fillText("look.", PAD, h - 36);
      return;
    }

    if (tile.kind === "caption") {
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, w, h);
      const s = tile.spec;
      drawMono(ctx, s.n, CAP_PAD, 36, hot ? P.text : P.muted, "left", 14);
      const tagW = drawMono(ctx, `${s.tag} \u2197`, w - CAP_PAD, 36, hot ? P.text : P.muted, "right", 14);
      const idxW = s.n.length > 2 ? 56 : 44;
      const titleMaxW = Math.max(80, w - idxW - tagW - 28);
      ctx.fillStyle = P.text;
      setSpacing(ctx, -0.5);
      fitText(ctx, s.title, 600, 25, FONTS.sans, titleMaxW);
      ctx.fillText(s.title, idxW, 38);
      const tw = inkWidth(ctx, s.title);
      setSpacing(ctx, 0);
      if (hot) {
        ctx.fillStyle = P.text;
        ctx.fillRect(idxW, 46, Math.min(tw, titleMaxW), 2);
      }
      return;
    }

    if (tile.kind === "specimen") {
      const entry = specImgCache.get(tile.spec.key);
      const stageBg = entry?.stage === "light" ? "#ffffff" : "#0d1117";
      const frameBorder = entry?.stage === "light" ? "#d0d7de" : "#30363d";
      drawCardFrame(ctx, w, h, stageBg, frameBorder);

      if (tile.spec.key === "live") {
        drawMono(ctx, "Your README stack / Live", 20, 32, entry?.stage === "light" ? "#57606a" : "#8b949e", "left", 12);
      }

      const items = entry?.items || [];
      const pausedTyping = reduced || o.isPaused();
      if (items.length) {
        const padX = w > 500 ? 48 : 26;
        const padY = tile.spec.key === "live" ? 48 : 30;
        const availW = w - padX * 2;
        const availH = h - padY * 2;
        const gap = 14;
        let totalH = 0;
        const scaled = items.map((item) => {
          const sw = Math.min(availW, item.w * (w > 500 ? 1.35 : 0.88));
          const sh = (item.h / item.w) * sw;
          totalH += sh;
          return { item, sw, sh };
        });
        totalH += gap * Math.max(0, scaled.length - 1);
        const fitScale = totalH > availH ? availH / totalH : 1;
        const finalH = totalH * fitScale;
        let cy = (h - finalH) / 2 + (tile.spec.key === "live" ? 8 : 0);
        for (const row of scaled) {
          const dw = row.sw * fitScale;
          const dh = row.sh * fitScale;
          if (row.item.type === "typing") {
            drawTypingCard(ctx, row.item, (w - dw) / 2, cy, dw, dh, typingTime, pausedTyping);
          } else {
            ctx.drawImage(row.item.img, (w - dw) / 2, cy, dw, dh);
          }
          cy += dh + gap * fitScale;
        }
      } else {
        drawMono(ctx, tile.spec.title, w / 2, h / 2, "#8b949e", "center", 16);
      }
      return;
    }

    if (tile.kind === "cta") {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      drawMono(ctx, "Interactive workbench", PAD + 4, 52, P.boneMuted, "left", 14);
      drawMono(ctx, "Free / No sign-in", w - PAD - 4, 52, P.boneMuted, "right", 14);
      ctx.fillStyle = P.boneInk;
      setSpacing(ctx, -3.5);
      ctx.font = fnt(700, 82, FONTS.sans);
      ctx.fillText("Ready to build", PAD + 4, 178);
      setSpacing(ctx, 0);
      ctx.font = fnt(400, 96, FONTS.serif, "italic");
      ctx.fillText("your cards?", PAD + 4, 266);

      const b1 = drawPill(ctx, "Open the builder", PAD + 4, h - 86, P.boneInk, P.bone, P.boneInk);
      const b2 = drawPill(ctx, "View source \u2197", PAD + 4 + b1.w + 12, h - 86, null, P.boneInk, P.boneInk);
      tile.chips = [
        { ...b1, action: { type: "builder" }, label: "Open builder <b>\u2197</b>" },
        { ...b2, action: { type: "href", url: REPO }, label: "GitHub source <b>\u2197</b>" },
      ];
      return;
    }

    if (tile.kind === "hello") {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      drawMono(ctx, "Say hello", PAD, 50, P.boneMuted, "left", 14);
      ctx.font = fnt(400, 26, FONTS.serif, "italic");
      ctx.fillStyle = P.boneInk;
      ctx.textAlign = "right";
      ctx.fillText("\u2197", w - PAD, 52);
      ctx.textAlign = "left";
      setSpacing(ctx, -1);
      fitText(ctx, "bagasadh/termcard", 600, 34, FONTS.sans, w - PAD * 2);
      ctx.fillStyle = P.boneInk;
      ctx.fillText("bagasadh/termcard", PAD, h - 40);
      setSpacing(ctx, 0);
      return;
    }

    // Fillers (5 variants)
    const v = tile.n % 5;
    if (v === 0) {
      drawCardFrame(ctx, w, h, P.bg, P.dim);
      ctx.fillStyle = P.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitText(ctx, "Ship it.", 400, Math.min(82, h * 0.4), FONTS.serif, w - PAD * 2, "italic");
      ctx.fillText("Ship it.", w / 2, h / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else if (v === 1) {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      ctx.fillStyle = P.boneInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fnt(700, Math.min(130, h * 0.55), FONTS.mono);
      ctx.fillText(">_", w / 2, h / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else if (v === 2) {
      drawCardFrame(ctx, w, h, P.surface, P.hairline);
      const words = ["Typing", "Info", "Streak", "Link"];
      const lh = Math.min(52, (h - PAD * 2) / 4);
      setSpacing(ctx, -1.2);
      words.forEach((wd, i) => {
        ctx.fillStyle = i === tile.n % 4 ? P.text : P.dim;
        ctx.font = fnt(600, lh * 0.88, FONTS.sans);
        ctx.fillText(wd, PAD, h / 2 - lh * 1.3 + lh * i);
      });
      setSpacing(ctx, 0);
    } else if (v === 3) {
      drawCardFrame(ctx, w, h, P.surface, P.hairline);
      drawMono(ctx, "termcard (n.)", PAD, 50, P.muted, "left", 14);
      ctx.fillStyle = P.text;
      setSpacing(ctx, -2);
      ctx.font = fnt(700, Math.min(58, h * 0.3), FONTS.sans);
      ctx.fillText("Pure SVG.", PAD, h - 38);
      setSpacing(ctx, 0);
    } else {
      drawCardFrame(ctx, w, h, P.bone, P.boneBorder);
      drawMono(ctx, "No edges", PAD, 50, P.boneMuted, "left", 14);
      const arrows = ["\u2196", "\u2191", "\u2197", "\u2190", "\u00b7", "\u2192", "\u2199", "\u2193", "\u2198"];
      const step = Math.min(w, h - 50) / 4.2;
      ctx.font = fnt(400, step * 0.6, FONTS.sans);
      ctx.fillStyle = P.boneInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      arrows.forEach((a, i) => {
        ctx.fillText(a, w / 2 + ((i % 3) - 1) * step, h / 2 + 12 + (Math.floor(i / 3) - 1) * step);
      });
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  }

  const ACTIONS = {
    specimen: (t) => (t.spec.preset ? { type: "preset", preset: t.spec.preset } : { type: "builder" }),
    caption: (t) => (t.spec.preset ? { type: "preset", preset: t.spec.preset } : { type: "builder" }),
    cta: () => ({ type: "builder" }),
    hello: () => ({ type: "href", url: REPO }),
  };
  const LABELS = {
    specimen: (t) => `${t.spec.title} <b>${t.spec.preset ? "\u00b7 Load preset" : "\u00b7 Edit"}</b>`,
    caption: (t) => `${t.spec.title} <b>${t.spec.preset ? "\u00b7 Load preset" : "\u00b7 Edit"}</b>`,
    cta: () => "Open builder <b>\u2197</b>",
    hello: () => "GitHub <b>\u2197</b>",
  };

  const tiles = placed.map((p) => {
    const main = makeTileCanvas(p.w, p.h);
    const alt = p.kind === "caption" ? makeTileCanvas(p.w, p.h) : null;
    const tile = {
      ...p,
      cx: p.x + p.w / 2,
      cy: p.y + p.h / 2,
      action: ACTIONS[p.kind] ? ACTIONS[p.kind](p) : null,
      label: LABELS[p.kind] ? LABELS[p.kind](p) : null,
      chips: null,
      canvas: main.c,
      ctx: main.ctx,
      tex: null,
      canvas2: alt ? alt.c : null,
      ctx2: alt ? alt.ctx : null,
      tex2: null,
      copies: [],
      hover: 0,
      pulse: 0,
      reveal: reduced ? 1 : 0,
      revealDelay: 0,
    };
    return tile;
  });

  const hero = tiles.find((t) => t.kind === "hero");
  const clockTile = tiles.find((t) => t.kind === "clock");
  let lastClockText = "";
  const cam = { x: hero.cx, y: hero.cy };
  const prev = { x: hero.cx, y: hero.cy };
  const vel = { x: 0, y: 0 };
  const sv = { x: 0, y: 0 };
  let speedS = 0;
  let flight = null;
  let dragging = false;
  let lastInput = -1e9;
  let now = 0;
  let typingTime = 0;
  let revealStart = -1;
  let last = performance.now();
  let frame = 0;
  let raf = 0;
  let down = null;
  let ptr = null;
  let hovered = null;
  let hoveredChip = null;
  let aimed = null;
  let presetIdx = 0;
  let lastHeading = null;
  let fieldMoving = false;
  let labelX = -999;
  let labelY = -999;
  let labelTx = -999;
  let labelTy = -999;
  let labelOn = false;
  const pending = { x: 0, y: 0 };
  const samples = [];
  const keys = new Set();
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  for (const t of tiles) {
    t.revealDelay = 0.08 + Math.hypot(t.cx - hero.cx, t.cy - hero.cy) / 3000;
  }

  function uploadTile(tile) {
    if (!glCtx) return;
    if (!tile.tex) tile.tex = glCtx.createTexture(tile.canvas);
    else glCtx.uploadTexture(tile.tex, tile.canvas);
    if (tile.canvas2) {
      if (!tile.tex2) tile.tex2 = glCtx.createTexture(tile.canvas2);
      else glCtx.uploadTexture(tile.tex2, tile.canvas2);
    }
  }

  function repaintTile(tile) {
    paintTile(tile, tile.ctx, tile.w, tile.h, false);
    if (tile.ctx2) paintTile(tile, tile.ctx2, tile.w, tile.h, true);
    uploadTile(tile);
    dirty = true;
  }

  async function loadSpecimenKey(key) {
    const r = o.getSpecimen(key);
    const rawItems = Array.isArray(r?.items) ? r.items : [];
    const resolved = await Promise.all(
      rawItems.map(async (item) => {
        if (item.type === "typing") {
          const built = buildTypingFrames(item.card?.words);
          return {
            type: "typing",
            card: item.card,
            theme: item.theme,
            duration: Math.max(2, Number(item.card?.duration) || 8),
            frames: built.frames,
            firstWord: built.firstWord,
            w: (item.theme?.width || 460) + 6,
            h: 84,
          };
        }
        const meta = parseSvgDimensions(item.svg);
        const img = await loadImage(meta.src);
        return img ? { type: "img", img, w: meta.w, h: meta.h } : null;
      })
    );
    const items = resolved.filter(Boolean);
    const hasTyping = items.some((it) => it.type === "typing");
    specImgCache.set(key, {
      stage: r?.stage || "dark",
      items,
      hasTyping,
    });
    for (const t of tiles) {
      if (t.kind === "specimen" && t.spec.key === key) {
        t.lastStepKey = "";
        repaintTile(t);
      }
    }
  }

  function repaintAllText() {
    for (const t of tiles) {
      if (t.kind !== "specimen" || specImgCache.get(t.spec.key)?.hasTyping) repaintTile(t);
    }
  }

  // Initial paint + async web fonts, favicon, and SVG specimens
  for (const t of tiles) repaintTile(t);
  revealStart = 0;

  Promise.all([
    document.fonts?.ready?.catch(() => {}) ?? Promise.resolve(),
    loadImage("/favicon.svg").then((img) => {
      faviconImg = img;
    }),
  ]).then(() => {
    repaintAllText();
  });

  Promise.all([...SPECS.map((s) => s.key), "live"].map(loadSpecimenKey));

  on(window, "resize", resize);

  const diag = () => Math.hypot(vw, vh) / zoom;

  // Pure-math hit test (0 DOM calls, 0 layout reflows)
  function hitAt(sx, sy) {
    const wx = (sx - vw / 2) / zoomEff;
    const wy = (sy - vh / 2) / zoomEff;
    for (let i = tiles.length - 1; i >= 0; i -= 1) {
      const t = tiles[i];
      for (const [cx, cy] of t.copies) {
        if (Math.abs(wx - cx) <= t.w / 2 && Math.abs(wy - cy) <= t.h / 2) {
          if (t.chips) {
            const lx = wx - (cx - t.w / 2);
            const ly = wy - (cy - t.h / 2);
            for (const chip of t.chips) {
              if (lx >= chip.x && lx <= chip.x + chip.w && ly >= chip.y && ly <= chip.y + chip.h) {
                return { tile: t, chip, action: chip.action, label: chip.label };
              }
            }
          }
          if (t.action) return { tile: t, chip: null, action: t.action, label: t.label };
          return null;
        }
      }
    }
    return null;
  }

  function setHover(hit, x, y) {
    const nextTile = hit?.tile ?? null;
    const nextChip = hit?.chip ?? null;
    const appearing = Boolean(hit) && !hovered && !hoveredChip;
    if (nextTile !== hovered || nextChip !== hoveredChip) {
      if (hit) o.sound.tick();
      hovered = nextTile;
      hoveredChip = nextChip;
      stage.classList.toggle("is-link", Boolean(hit));
      labelOn = Boolean(hit?.label);
      o.label.classList.toggle("is-on", labelOn);
      if (hit?.label) o.label.innerHTML = hit.label;
    }
    if (!hit || x === undefined) return;
    labelTx = x + 18;
    labelTy = y + 18;
    if (appearing || reduced) {
      labelX = labelTx;
      labelY = labelTy;
      o.label.style.transform = `translate3d(${labelX.toFixed(1)}px, ${labelY.toFixed(1)}px, 0)`;
    }
  }

  function updateHover() {
    if (!ptr || dragging || o.isSheetOpen() || fieldMoving) {
      if (hovered || hoveredChip) setHover(null);
      return;
    }
    setHover(hitAt(ptr.x, ptr.y), ptr.x, ptr.y);
  }

  function updateAim() {
    const hit = canAim && !fieldMoving && !dragging && !o.isSheetOpen() && !hovered ? hitAt(vw / 2, vh / 2) : null;
    const t = hit?.tile ?? null;
    if (t === aimed) return;
    aimed = t;
    o.aim.classList.toggle("is-on", Boolean(hit));
    if (hit) {
      const clean = (hit.label || "Open").replace(/<b>[^<]*<\/b>\s*$/, "").trim();
      o.aim.innerHTML = `<b>\u21b5</b> ${clean}`;
    }
  }

  function runAction(action) {
    if (!action) return;
    if (action.type === "href") {
      window.open(action.url, "_blank", "noopener");
      return;
    }
    o.onAction(action);
  }

  function flyTo(target, alignTop = false) {
    if (!target) return 0;
    const tx = target.at ? target.at[0] : cam.x + wrapD(target.cx - cam.x, W);
    let ty = target.at ? target.at[1] : cam.y + wrapD(target.cy - cam.y, H);
    if (alignTop) {
      const top = cam.y + wrapD(target.y - cam.y, H);
      ty = Math.min(ty, top + vh / zoomEff / 2 - 90 / zoom);
    }
    vel.x = vel.y = 0;
    lastInput = now;
    const dist = Math.hypot(tx - cam.x, ty - cam.y);
    if (dist > 1) lastHeading = Math.atan2(ty - cam.y, tx - cam.x);
    if (reduced) {
      cam.x = prev.x = tx;
      cam.y = prev.y = ty;
      dirty = true;
      return 0;
    }
    const dur = Math.min(CFG.flyMaxDuration, CFG.flyDuration * Math.max(1, Math.sqrt(dist / diag())));
    flight = { sx: cam.x, sy: cam.y, tx, ty, t0: now, dur };
    o.sound.sweep(dur);
    return dur;
  }

  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  function workTarget(list) {
    const D = diag();
    const lo = 0.6 * D;
    const hi = 1.2 * D;
    const mid = (lo + hi) / 2;
    const cands = [];
    for (const t of list) {
      const bx = wrapD(t.cx - cam.x, W);
      const by = wrapD(t.cy - cam.y, H);
      for (let kx = -2; kx <= 2; kx += 1) {
        for (let ky = -2; ky <= 2; ky += 1) {
          const x = bx + kx * W;
          const y = by + ky * H;
          const d = Math.hypot(x, y);
          if (d > 1) cands.push({ t, x, y, d, a: Math.atan2(y, x) });
        }
      }
    }
    const turn = (60 * Math.PI) / 180;
    const want = lastHeading === null ? null : lastHeading + 2.39996;
    const inBand = (c) => c.d >= lo && c.d <= hi;
    const turns = (c) => lastHeading === null || angDiff(c.a, lastHeading) >= turn;
    const off = (c) => (want === null ? 0 : angDiff(c.a, want) / Math.PI) + (Math.abs(c.d - mid) / D) * 0.35;
    const best = (pool, score) => pool.reduce((b, c) => (!b || score(c) < score(b) ? c : b), null);
    return (
      best(cands.filter((c) => inBand(c) && turns(c)), off) ??
      best(cands.filter(inBand), (c) => -angDiff(c.a, lastHeading ?? 0)) ??
      best(cands, (c) => Math.abs(c.d - mid))
    );
  }

  const nearest = (list) =>
    list.reduce((best, t) => {
      const d = Math.hypot(wrapD(t.cx - cam.x, W), wrapD(t.cy - cam.y, H));
      return !best || d < best.d ? { t, d } : best;
    }, null)?.t;

  function fly(name) {
    if (name === "presets") {
      const spec = SPECS[presetIdx];
      o.presetCount.textContent = `0${presetIdx + 1}/0${SPECS.length}`;
      presetIdx = (presetIdx + 1) % SPECS.length;
      const all = tiles.filter((t) => t.kind === "specimen" && t.spec === spec);
      const large = all.filter((t) => t.w > C);
      const c = workTarget(large.length ? large : all);
      flyTo({ at: [cam.x + c.x, cam.y + c.y] });
      for (const t of tiles) {
        if (t.spec === spec) t.pulse = 1.8;
      }
      return;
    }
    if (name === "setup") {
      const head = nearest(tiles.filter((t) => t.kind === "setupHead"));
      flyTo({ cx: head.x + C + G / 2, cy: head.y + 550, y: head.y }, true);
      return;
    }
    if (name === "hero") {
      flyTo(nearest(tiles.filter((t) => t.kind === "hero")));
      return;
    }
    flyTo(nearest(tiles.filter((t) => t.anchor === name)));
  }

  let activeFriction = coarse ? CFG.touchFriction : CFG.friction;

  on(stage, "touchmove", (e) => {
    if (!o.isSheetOpen()) e.preventDefault();
  }, { passive: false });

  on(stage, "pointerdown", (e) => {
    if (o.isSheetOpen() || !e.isPrimary) return;
    if (down && down.id !== e.pointerId) return;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // Optional pointer capture.
    }
    const tNow = performance.now();
    const isTouch = e.pointerType === "touch";
    activeFriction = isTouch ? CFG.touchFriction : CFG.friction;
    down = { id: e.pointerId, isTouch, lx: e.clientX, ly: e.clientY, lt: tNow, t: tNow, moved: 0, vx: 0, vy: 0 };
    samples.length = 0;
    samples.push({ t: tNow, x: e.clientX, y: e.clientY });
    dragging = true;
    flight = null;
    vel.x = vel.y = 0;
    lastInput = now;
    stage.classList.add("is-dragging");
    setHover(null);
  });

  on(stage, "pointermove", (e) => {
    if (e.pointerType === "mouse") ptr = { x: e.clientX, y: e.clientY };
    if (!down || !dragging || e.pointerId !== down.id) return;
    const tNow = performance.now();
    const dx = e.clientX - down.lx;
    const dy = e.clientY - down.ly;
    const stepDt = (tNow - down.lt) / 1000;
    if (stepDt > 0.002 && stepDt < 0.2) {
      const ivx = -dx / stepDt / zoomEff;
      const ivy = -dy / stepDt / zoomEff;
      down.vx = down.vx * 0.4 + ivx * 0.6;
      down.vy = down.vy * 0.4 + ivy * 0.6;
    }
    down.lx = e.clientX;
    down.ly = e.clientY;
    down.lt = tNow;
    down.moved += Math.abs(dx) + Math.abs(dy);
    pending.x += dx;
    pending.y += dy;
    samples.push({ t: tNow, x: e.clientX, y: e.clientY });
    while (samples.length > 2 && tNow - samples[0].t > CFG.flingWindow) samples.shift();
    lastInput = now;
  });

  function pointerVel(at) {
    if (samples.length < 2) return { x: 0, y: 0 };
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.006 || at - b.t > 140) return { x: 0, y: 0 };
    return { x: -(b.x - a.x) / dt / zoomEff, y: -(b.y - a.y) / dt / zoomEff };
  }

  function endDrag(e) {
    if (!down || e.pointerId !== down.id) return;
    const tNow = performance.now();
    const tapSlop = down.isTouch ? 14 : 8;
    const quick = down.moved < tapSlop && tNow - down.t < 500;
    if (!reduced && !quick) {
      const sv1 = pointerVel(tNow);
      const staleMs = tNow - down.lt;
      const boost = down.isTouch ? 1.15 : 1;
      let vx = sv1.x;
      let vy = sv1.y;
      if (staleMs < 95 && Math.hypot(down.vx, down.vy) > Math.hypot(vx, vy) * 0.85) {
        vx = vx * 0.45 + down.vx * 0.55;
        vy = vy * 0.45 + down.vy * 0.55;
      }
      vel.x = clamp(vx * boost, -6500, 6500);
      vel.y = clamp(vy * boost, -6500, 6500);
    }
    const wasTouch = down.isTouch;
    down = null;
    dragging = false;
    stage.classList.remove("is-dragging");
    if (quick && e.type === "pointerup") {
      const hit = hitAt(e.clientX, e.clientY);
      if (hit) {
        o.sound.tap();
        runAction(hit.action);
      }
    }
    if (wasTouch) ptr = null;
  }
  on(stage, "pointerup", endDrag);
  on(stage, "pointercancel", endDrag);
  on(stage, "pointerleave", () => {
    ptr = null;
    setHover(null);
  });

  on(
    stage,
    "wheel",
    (e) => {
      if (o.isSheetOpen()) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
      let dx = e.deltaX * k;
      let dy = e.deltaY * k;
      if (e.shiftKey && !dx) {
        dx = dy;
        dy = 0;
      }
      flight = null;
      activeFriction = CFG.friction;
      lastInput = now;
      if (reduced) {
        cam.x += dx / zoomEff;
        cam.y += dy / zoomEff;
        dirty = true;
        return;
      }
      vel.x += (dx * CFG.wheel) / zoomEff;
      vel.y += (dy * CFG.wheel) / zoomEff;
    },
    { passive: false }
  );

  const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const ownsKey = (e) => e.target.closest?.("button, a, input, textarea, select, summary, dialog, [contenteditable]");
  on(window, "keydown", (e) => {
    if (o.isSheetOpen() || document.querySelector("dialog[open]")) return;
    if (e.key === "Enter" || e.key === " ") {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || ownsKey(e)) return;
      const hit = hitAt(vw / 2, vh / 2);
      if (!hit) return;
      e.preventDefault();
      o.sound.tap();
      runAction(hit.action);
      return;
    }
    if (!DIRS[e.key] || ownsKey(e)) return;
    e.preventDefault();
    flight = null;
    lastInput = now;
    if (reduced) {
      const [dx, dy] = DIRS[e.key];
      cam.x += (dx * vw) / zoomEff / 3;
      cam.y += (dy * vh) / zoomEff / 3;
      dirty = true;
      return;
    }
    keys.add(e.key);
  });
  on(window, "keyup", (e) => keys.delete(e.key));
  on(window, "blur", () => keys.clear());

  function updateHudReadout() {
    const d = new Date();
    o.hudClock.textContent = clockSecFmt.format(d);
    const clk = clockFmt.format(d);
    if (clockTile && clk !== lastClockText) {
      lastClockText = clk;
      repaintTile(clockTile);
    }
    o.hudX.textContent = fmtCoord(cam.x / 10);
    o.hudY.textContent = fmtCoord(-cam.y / 10);
  }

  function renderFrame(bend) {
    if (glCtx) {
      const { gl, u, indexCount } = glCtx;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uView, vw / 2 / zoomEff, vh / 2 / zoomEff);
      gl.uniform1f(u.uBend, bend);
      for (const tile of tiles) {
        if (!tile.copies.length || !tile.tex || tile.reveal <= 0.001) continue;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tile.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tile.tex2 || tile.tex);
        gl.uniform2f(u.uSize, tile.w, tile.h);
        gl.uniform1f(u.uRadius, tile.kind === "caption" ? 0 : CFG.radius);
        gl.uniform1f(u.uHover, tile.hover);
        gl.uniform1f(u.uReveal, tile.reveal);
        gl.uniform1f(u.uZoom, tile.kind === "specimen" ? 1 : 0);
        gl.uniform1f(u.uAlt, tile.tex2 ? 1 : 0);
        for (const [x, y] of tile.copies) {
          gl.uniform2f(u.uOffset, x, y);
          gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
        }
      }
    } else if (ctx2d) {
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.fillStyle = P.bg;
      ctx2d.fillRect(0, 0, vw, vh);
      ctx2d.save();
      ctx2d.translate(vw / 2, vh / 2);
      ctx2d.scale(zoomEff, zoomEff);
      for (const tile of tiles) {
        if (!tile.copies.length || tile.reveal <= 0.001) continue;
        ctx2d.globalAlpha = tile.reveal;
        const src = tile.hover > 0.5 && tile.canvas2 ? tile.canvas2 : tile.canvas;
        for (const [x, y] of tile.copies) {
          ctx2d.drawImage(src, x - tile.w / 2, y - tile.h / 2, tile.w, tile.h);
        }
      }
      ctx2d.restore();
      ctx2d.globalAlpha = 1;
    }
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    const dt = clamp((ts - last) / 1000, 0, 0.05);
    last = ts;
    now += dt;
    frame += 1;

    if (o.isSheetOpen()) {
      pending.x = pending.y = 0;
      vel.x = vel.y = 0;
      return;
    }

    if (pending.x || pending.y) {
      cam.x -= pending.x / zoomEff;
      cam.y -= pending.y / zoomEff;
      pending.x = pending.y = 0;
      dirty = true;
    }

    if (flight) {
      const k = Math.min(1, (now - flight.t0) / flight.dur);
      const e = easeInOut(k);
      cam.x = flight.sx + (flight.tx - flight.sx) * e;
      cam.y = flight.sy + (flight.ty - flight.sy) * e;
      lastInput = now;
      dirty = true;
      if (k >= 1) flight = null;
    } else if (!dragging && !reduced) {
      if (keys.size) {
        let kx = 0;
        let ky = 0;
        for (const k of keys) {
          kx += DIRS[k][0];
          ky += DIRS[k][1];
        }
        const a = 1 - 0.0025 ** dt;
        vel.x += (kx * CFG.keySpeed - vel.x) * a;
        vel.y += (ky * CFG.keySpeed - vel.y) * a;
        lastInput = now;
      } else {
        const f = activeFriction ** (dt * 60);
        vel.x *= f;
        vel.y *= f;
      }
      if (now - lastInput > CFG.idleDelay && !o.isPaused()) {
        const a = 1 - 0.985 ** (dt * 60);
        const dx = Math.cos(now * 0.05) * CFG.drift;
        const dy = Math.sin(now * 0.037 + 1) * CFG.drift * 0.7;
        vel.x += (dx - vel.x) * a;
        vel.y += (dy - vel.y) * a;
      }
      vel.x = clamp(vel.x, -8000, 8000);
      vel.y = clamp(vel.y, -8000, 8000);
      cam.x += vel.x * dt;
      cam.y += vel.y * dt;
    }

    if (dt > 0) {
      let mx = (cam.x - prev.x) / dt;
      let my = (cam.y - prev.y) / dt;
      if (dragging) ({ x: mx, y: my } = pointerVel(performance.now()));
      const a = 1 - Math.exp(-dt / CFG.speedTau);
      sv.x += (mx - sv.x) * a;
      sv.y += (my - sv.y) * a;
    }
    prev.x = cam.x;
    prev.y = cam.y;

    speedS = (Math.hypot(sv.x, sv.y) * zoom) / Math.max(vw, vh);
    const speed = reduced ? 0 : speedS;
    zoomEff = zoom * (1 - Math.min(speed * CFG.speedZoom, 0.1));
    const bend = Math.min(speed * CFG.bend, CFG.maxBend, 0.4);

    // Enumerate visible wrapped copies
    const grow = 1 / (1 - 2 * Math.min(CFG.maxBend, 0.4));
    const zMin = zoom * 0.9;
    const hw = (vw / zMin) * (0.5 + CFG.cullMargin) * grow + C2;
    const hh = (vh / zMin) * (0.5 + CFG.cullMargin) * grow + C2;

    const pausedTyping = reduced || o.isPaused();
    if (!pausedTyping) {
      typingTime += dt;
    }

    let animating = false;
    for (const tile of tiles) {
      if (tile.reveal < 1) {
        const rk = clamp((now - revealStart - tile.revealDelay) / 0.75, 0, 1);
        tile.reveal = easeOut(rk);
        animating = true;
      }
      const dx = tile.cx - cam.x;
      const dy = tile.cy - cam.y;
      const ax = hw + tile.w / 2;
      const ay = hh + tile.h / 2;
      tile.copies.length = 0;
      for (let kx = Math.ceil((-ax - dx) / W); kx <= Math.floor((ax - dx) / W); kx += 1) {
        for (let ky = Math.ceil((-ay - dy) / H); ky <= Math.floor((ay - dy) / H); ky += 1) {
          tile.copies.push([dx + kx * W, dy + ky * H]);
        }
      }
      if (tile.kind === "specimen" && tile.copies.length) {
        const entry = specImgCache.get(tile.spec.key);
        if (entry?.hasTyping) {
          const stepKey = pausedTyping
            ? `P:${Math.floor(typingTime * 10)}`
            : entry.items
                .filter((it) => it.type === "typing")
                .map((it) => typingStepIndex(it, typingTime))
                .join(",");
          if (stepKey !== tile.lastStepKey) {
            tile.lastStepKey = stepKey;
            repaintTile(tile);
            animating = true;
          }
        }
      }
    }

    fieldMoving = Boolean(flight) || dragging || speedS > 0.05;
    updateHover();
    updateAim();

    const lit = hovered ?? aimed;
    for (const tile of tiles) {
      tile.pulse = Math.max(0, tile.pulse - dt);
      const matchUnit = lit && lit.unit !== null && lit.unit === tile.unit;
      const target = tile === lit || tile.pulse > 0 || matchUnit ? 1 : 0;
      tile.hover += (target - tile.hover) * (1 - 0.85 ** (dt * 60));
      if (Math.abs(target - tile.hover) > 0.002) animating = true;
    }

    if (labelOn && !reduced) {
      const la = 1 - Math.exp(-dt / 0.06);
      labelX += (labelTx - labelX) * la;
      labelY += (labelTy - labelY) * la;
      o.label.style.transform = `translate3d(${labelX.toFixed(1)}px, ${labelY.toFixed(1)}px, 0)`;
    }

    if (frame % 10 === 0) {
      updateHudReadout();
    }

    if (speed > 0.0004 || animating || dirty || dragging || flight) {
      renderFrame(bend);
      dirty = false;
    }
  }

  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  on(document, "visibilitychange", () => {
    if (document.hidden) {
      stop();
      keys.clear();
    } else {
      start();
    }
  });

  if (o.hudTz) {
    try {
      const tz = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value;
      if (tz) o.hudTz.textContent = tz;
    } catch {
      // Keep default label.
    }
  }
  updateHudReadout();
  start();

  return {
    fly,
    setTheme(mode) {
      P = PALETTES[mode === "light" ? "light" : "dark"];
      glCtx?.setClear(P.clear);
      repaintAllText();
    },
    refresh() {
      Promise.all([...SPECS.map((s) => s.key), "live"].map(loadSpecimenKey));
    },
    refreshLive() {
      loadSpecimenKey("live");
    },
    destroy() {
      stop();
      for (const fn of cleanups) fn();
      glCtx?.destroy();
      stage.replaceChildren();
    },
  };
}
