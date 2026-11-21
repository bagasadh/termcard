// Mirrors termcard.py so browser previews match GitHub Action SVG output.

export const DEFAULT_FONT =
  "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const THEMES = {
  "dashed-dark": {
    label: "Dashed Dark",
    bg: "#000000",
    bg_opacity: "0.5",
    stroke: "#ffffff",
    outline: "#24292f",
    outline_opacity: "0.8",
    dasharray: "9.5 6",
    outline_dasharray: "11.5 4",
    text: "#ffffff",
    muted: "#8b949e",
    link: "#388bfd",
  },
  "dashed-light": {
    label: "Dashed Light",
    bg: "#ffffff",
    bg_opacity: "0.85",
    stroke: "#24292f",
    outline: "#d0d7de",
    outline_opacity: "0.9",
    dasharray: "9.5 6",
    outline_dasharray: "11.5 4",
    text: "#1f2328",
    muted: "#57606a",
    link: "#0969da",
  },
  "solid-dark": {
    label: "Solid Dark",
    bg: "#0d1117",
    bg_opacity: "0.92",
    stroke: "#30363d",
    outline: "",
    outline_opacity: "0",
    dasharray: "",
    outline_dasharray: "",
    text: "#e6edf3",
    muted: "#8b949e",
    link: "#58a6ff",
  },
  "solid-light": {
    label: "Solid Light",
    bg: "#ffffff",
    bg_opacity: "1",
    stroke: "#d0d7de",
    outline: "",
    outline_opacity: "0",
    dasharray: "",
    outline_dasharray: "",
    text: "#1f2328",
    muted: "#656d76",
    link: "#0969da",
  },
  "terminal-green": {
    label: "Terminal Green",
    bg: "#040d07",
    bg_opacity: "0.88",
    stroke: "#3fb950",
    outline: "#0f2916",
    outline_opacity: "0.85",
    dasharray: "9.5 6",
    outline_dasharray: "11.5 4",
    text: "#aff5b4",
    muted: "#56d364",
    link: "#7ee787",
  },
};

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function truncateText(text, maxLen) {
  const chars = Array.from(String(text ?? ""));
  if (maxLen <= 0) return "";
  if (chars.length <= maxLen) return chars.join("");
  if (maxLen <= 3) return chars.slice(0, maxLen).join("");
  return `${chars.slice(0, maxLen - 3).join("").trimEnd()}...`;
}

export function fitPair(label, value, width) {
  const lStr = String(label ?? "");
  const vStr = String(value ?? "");
  const maxTotal = Math.max(6, Math.floor(((width - 48) * 10) / 84) - 2);
  const lLen = Array.from(lStr).length;
  const vLen = Array.from(vStr).length;
  if (lLen + vLen <= maxTotal) return [lStr, vStr];
  if (vLen === 0) return [truncateText(lStr, maxTotal), ""];
  if (lLen === 0) return ["", truncateText(vStr, maxTotal)];
  const halfLabel = Math.max(4, Math.floor((maxTotal * 4) / 10));
  const halfValue = maxTotal - halfLabel;
  if (lLen <= halfLabel) return [lStr, truncateText(vStr, maxTotal - lLen)];
  if (vLen <= halfValue) return [truncateText(lStr, maxTotal - vLen), vStr];
  return [truncateText(lStr, halfLabel), truncateText(vStr, halfValue)];
}

export function resolveThemeVariant(config, themeName, mode = null) {
  const base = { ...(THEMES[themeName] || THEMES["dashed-dark"]) };
  base.width = clampInt(config.width, 360, 680, 560);
  base.radius = clampInt(config.radius, 0, 20, 6);
  base.font = config.font || DEFAULT_FONT;
  const style = config.style;
  if (style && typeof style === "object") {
    let override = {};
    if ((mode === "dark" || mode === "light") && style[mode] && typeof style[mode] === "object") {
      override = style[mode];
    } else if (mode === "light") {
      override = {};
    } else {
      for (const [key, val] of Object.entries(style)) {
        if (!val || typeof val !== "object") {
          override[key] = val;
        }
      }
    }
    for (const [key, val] of Object.entries(override)) {
      if (val !== undefined && val !== null && val !== "") {
        base[key] = val;
      }
    }
  }
  return base;
}

export function resolveThemes(config) {
  const rawTheme = config.theme ?? "dashed-dark";
  if (rawTheme && typeof rawTheme === "object") {
    const darkName = String(rawTheme.dark || "dashed-dark");
    const lightName = String(rawTheme.light || "dashed-light");
    return [
      ["dark", resolveThemeVariant(config, darkName, "dark")],
      ["light", resolveThemeVariant(config, lightName, "light")],
    ];
  }
  const name = String(rawTheme || "dashed-dark");
  return [[null, resolveThemeVariant(config, name, null)]];
}

export function resolveTheme(config) {
  return resolveThemes(config)[0][1];
}

export function variantFilename(filename, variant) {
  if (!variant) return filename;
  if (filename.toLowerCase().endsWith(".svg")) {
    return `${filename.slice(0, -4)}-${variant}.svg`;
  }
  return `${filename}-${variant}`;
}

function clampInt(val, min, max, fallback) {
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function dashAttr(val) {
  return val ? ` stroke-dasharray="${escapeXml(val)}"` : "";
}

function renderBox(w, h, t) {
  const rx = t.radius;
  const innerW = w - 2;
  const parts = [];
  if (t.outline) {
    const outDash = t.outline_dasharray
      ? `;stroke-dasharray:${escapeXml(t.outline_dasharray)};stroke-dashoffset:1`
      : "";
    parts.push(
      `<rect x="1" y="1" width="${innerW}" height="${h}" rx="${rx}" fill="none"` +
        ` style="stroke:${escapeXml(t.outline)};stroke-opacity:${escapeXml(t.outline_opacity)};stroke-width:3.5${outDash}"/>`
    );
  }
  parts.push(
    `<rect x="1" y="1" width="${innerW}" height="${h}" rx="${rx}"` +
      ` fill="${escapeXml(t.bg)}" fill-opacity="${escapeXml(t.bg_opacity)}"` +
      ` stroke="${escapeXml(t.stroke)}" stroke-width="1.5"${dashAttr(t.dasharray)}/>`
  );
  return parts.join("");
}

function renderDivider(x1, y1, x2, y2, t) {
  const parts = [];
  if (t.outline) {
    const outDash = t.outline_dasharray
      ? `;stroke-dasharray:${escapeXml(t.outline_dasharray)};stroke-dashoffset:1`
      : "";
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"` +
        ` style="stroke:${escapeXml(t.outline)};stroke-opacity:${escapeXml(t.outline_opacity)};stroke-width:3.5${outDash}"/>`
    );
  }
  parts.push(
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"` +
      ` stroke="${escapeXml(t.stroke)}" stroke-width="1.5"${dashAttr(t.dasharray)}/>`
  );
  return parts.join("");
}

function wrapSvg(w, h, body, t, fontSize = 14, extraStyle = "", extraH = 16) {
  const svgW = w + 6;
  const svgH = h + extraH;
  const styleTag = extraStyle ? `<style>${extraStyle}</style>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}"` +
    ` viewBox="-3 -3 ${svgW} ${svgH}">${styleTag}` +
    `<g font-family="${escapeXml(t.font)}" font-size="${fontSize}" fill="${escapeXml(t.text)}">` +
    `${body}</g></svg>\n`
  );
}

export function renderTyping(card, t, { paused = false } = {}) {
  const w = clampInt(card.width, 360, 680, t.width);
  const h = 68;
  const promptTop = card.prompt_top ?? `┌ ${card.user || "your-username"}`;
  const promptBottom = card.prompt_bottom ?? "└›";
  const promptBottomChars = Array.from(String(promptBottom));
  const rawWords = Array.isArray(card.words)
    ? card.words
    : String(card.words || "Hi, fastfetch").split(",");
  const words = rawWords.map((s) => String(s).trim()).filter(Boolean);
  if (!words.length) words.push("Hi");
  const wordCharsList = words.map((word) => Array.from(word));
  const duration = Math.max(2, Number(card.duration) || Math.max(6, words.length * 4));
  const charW = 8.4;
  const startX = 24 + (promptBottomChars.length + 1) * charW;
  const clipId = `tc-clip-${w}-${t.radius}`;
  const clipRx = Math.max(0, Number(t.radius) - 1);
  const defs =
    `<defs><clipPath id="${clipId}">` +
    `<rect x="12" y="4" width="${w - 24}" height="${h - 6}" rx="${clipRx}"/>` +
    `</clipPath></defs>`;

  if (paused) {
    const firstChars = wordCharsList[0];
    const staticChars = firstChars
      .map((ch, i) => `<text x="${(startX + i * charW).toFixed(1)}" y="54">${escapeXml(ch)}</text>`)
      .join("");
    const cursorX = (startX + firstChars.length * charW).toFixed(1);
    const inner =
      `<text x="24" y="30">${escapeXml(promptTop)}</text>` +
      `<text x="24" y="54">${escapeXml(promptBottom)}</text>` +
      staticChars +
      `<rect fill="${escapeXml(t.text)}" x="${cursorX}" y="41" width="1.5" height="16"/>`;
    const body = renderBox(w, h, t) + defs + `<g clip-path="url(#${clipId})">${inner}</g>`;
    return wrapSvg(w, h, body, t, 14);
  }

  const timeline = [];
  const cursorSpans = new Map();
  let step = 0;

  const addSpan = (col, span) => {
    if (!cursorSpans.has(col)) cursorSpans.set(col, []);
    cursorSpans.get(col).push(span);
  };

  wordCharsList.forEach((wordChars, wIdx) => {
    step += 2;
    const typeStarts = [];
    for (let c = 0; c < wordChars.length; c += 1) {
      addSpan(c, [step, step + 1, false]);
      step += 1;
      typeStarts.push(step);
    }
    const holdEnd = step + 8;
    addSpan(wordChars.length, [step, holdEnd, true]);
    step = holdEnd;
    for (let c = wordChars.length - 1; c >= 0; c -= 1) {
      const delAt = step;
      timeline.push([wIdx, c, typeStarts[c], delAt]);
      addSpan(c, [delAt, delAt + 1, false]);
      step += 1;
    }
    addSpan(0, [step, step + 2, true]);
    step += 2;
  });

  const total = Math.max(step, 1);
  const keyframes = [];
  const texts = [];
  timeline.forEach(([wIdx, cIdx, sOn, sOff], idx) => {
    const pOn = ((sOn / total) * 100).toFixed(2);
    const pOff = ((sOff / total) * 100).toFixed(2);
    keyframes.push(`@keyframes l${idx}{0%{opacity:0}${pOn}%{opacity:1}${pOff}%{opacity:0}}`);
    const ch = escapeXml(wordCharsList[wIdx][cIdx]);
    const x = (startX + cIdx * charW).toFixed(1);
    const cls = wIdx === 0 ? ' class="r"' : "";
    texts.push(
      `<text x="${x}" y="54" opacity="0"${cls} style="animation:l${idx} ${duration}s step-end infinite">${ch}</text>`
    );
  });

  const cursors = [];
  const sortedCols = [...cursorSpans.keys()].sort((a, b) => a - b);
  for (const col of sortedCols) {
    const stops = ["0%{opacity:0}"];
    for (const [sStart, sEnd, blink] of cursorSpans.get(col)) {
      if (blink && sEnd - sStart >= 2) {
        let cur = sStart;
        let visible = true;
        while (cur < sEnd) {
          stops.push(`${((cur / total) * 100).toFixed(2)}%{opacity:${visible ? 1 : 0}}`);
          visible = !visible;
          cur += 2;
        }
        stops.push(`${((sEnd / total) * 100).toFixed(2)}%{opacity:0}`);
      } else {
        stops.push(`${((sStart / total) * 100).toFixed(2)}%{opacity:1}`);
        stops.push(`${((sEnd / total) * 100).toFixed(2)}%{opacity:0}`);
      }
    }
    keyframes.push(`@keyframes c${col}{${stops.join("")}}`);
    const x = (startX + col * charW).toFixed(1);
    const cls = col === wordCharsList[0].length ? ' class="r"' : "";
    cursors.push(
      `<rect fill="${escapeXml(t.text)}" x="${x}" y="41" width="1.5" height="16" opacity="0"${cls}` +
        ` style="animation:c${col} ${duration}s step-end infinite"/>`
    );
  }

  const reducedMotionRule =
    "@media (prefers-reduced-motion: reduce){text,rect{animation:none !important}.r{opacity:1 !important}}";

  const inner =
    `<text x="24" y="30">${escapeXml(promptTop)}</text>` +
    `<text x="24" y="54">${escapeXml(promptBottom)}</text>` +
    texts.join("") +
    cursors.join("");
  const body = renderBox(w, h, t) + defs + `<g clip-path="url(#${clipId})">${inner}</g>`;

  return wrapSvg(w, h, body, t, 14, keyframes.join("") + reducedMotionRule);
}

export function renderInfo(card, t) {
  const w = clampInt(card.width, 360, 680, t.width);
  const sections =
    Array.isArray(card.sections) && card.sections.length
      ? card.sections
      : Array.isArray(card.rows) && card.rows.length
        ? [card.rows]
        : [[]];

  let y = 30;
  const elements = [];
  sections.forEach((rows, sIdx) => {
    if (sIdx > 0) {
      const divY = y - 9;
      elements.push(renderDivider(1, divY, w - 1, divY, t));
      y += 12;
    }
    for (const row of rows) {
      const rawLabel = Array.isArray(row) ? (row[0] ?? "") : (row.label ?? "");
      const rawValue = Array.isArray(row) ? (row[1] ?? "") : (row.value ?? "");
      const [label, value] = fitPair(rawLabel, rawValue, w);
      elements.push(`<text x="24" y="${y}">${escapeXml(label)}</text>`);
      elements.push(`<text x="${w - 24}" y="${y}" text-anchor="end">${escapeXml(value)}</text>`);
      y += 24;
    }
  });

  const h = Math.max(44, y - 10);
  return wrapSvg(w, h, renderBox(w, h, t) + elements.join(""), t, 14);
}

export function renderLink(card, t) {
  const w = clampInt(card.width, 360, 680, t.width);
  const h = 44;
  const [label, value] = fitPair(card.label ?? "", card.value ?? "", w);
  const body =
    renderBox(w, h, t) +
    `<text x="24" y="28">${escapeXml(label)}</text>` +
    `<text x="${w - 24}" y="28" text-anchor="end" fill="${escapeXml(t.link)}" text-decoration="underline">` +
    `${escapeXml(value)}</text>`;
  return wrapSvg(w, h, body, t, 14);
}

export function renderStreak(card, t) {
  const w = clampInt(card.width, 360, 680, t.width);
  const h = 170;
  const mid = w / 2;
  const leftCx = w / 4;
  const rightCx = (w * 3) / 4;

  const title = escapeXml(card.title || "Streak");
  const curLabel = escapeXml(card.current_label || "Current streak");
  const bestLabel = escapeXml(card.longest_label || "Longest streak");
  const unit = escapeXml(card.unit || "days");

  // Browser preview uses sample values; live values come from GitHub Actions.
  const curDays = clampInt(card.preview_current, 0, 9999, 7);
  const bestDays = Math.max(curDays, clampInt(card.preview_longest, 0, 9999, 14));
  const curRange = card.preview_current_range || "Sample preview";
  const bestRange = card.preview_longest_range || "Live via Action";

  const parts = [
    renderBox(w, h, t),
    `<text x="${mid}" y="30" text-anchor="middle">${title}</text>`,
    renderDivider(1, 44, w - 1, 44, t),
    `<text x="${leftCx}" y="66" text-anchor="middle">${curLabel}</text>`,
    `<text x="${rightCx}" y="66" text-anchor="middle">${bestLabel}</text>`,
    renderDivider(1, 78, w - 1, 78, t),
    renderDivider(mid, 44, mid, h + 1, t),
  ];

  for (const [cx, count, range] of [
    [leftCx, curDays, curRange],
    [rightCx, bestDays, bestRange],
  ]) {
    parts.push(
      `<text x="${cx}" y="124" text-anchor="middle" font-size="34" font-weight="bold">${count}</text>`
    );
    parts.push(`<text x="${cx}" y="146" text-anchor="middle">${unit}</text>`);
    parts.push(
      `<text x="${cx}" y="164" text-anchor="middle" font-size="12" fill="${escapeXml(t.muted)}">${escapeXml(range)}</text>`
    );
  }

  return wrapSvg(w, h, parts.join(""), t, 15, "", 36);
}

export function renderCard(card, theme, opts = {}) {
  switch (card.type) {
    case "typing":
      return renderTyping(card, theme, opts);
    case "info":
      return renderInfo(card, theme);
    case "link":
      return renderLink(card, theme);
    case "streak":
      return renderStreak(card, theme);
    default:
      return "";
  }
}

export function buildExportConfig(state) {
  const out = {};
  if (state.schemaUrl) {
    out.$schema = state.schemaUrl;
  }
  out.theme = state.dualTheme
    ? { dark: state.theme, light: state.lightTheme || "dashed-light" }
    : state.theme;
  out.width = clampInt(state.width, 360, 680, 560);
  out.radius = clampInt(state.radius, 0, 20, 6);
  if (state.font && String(state.font).trim() !== "" && state.font !== DEFAULT_FONT) {
    out.font = state.font;
  }

  const styleOut = {};
  if (state.extraStyle && typeof state.extraStyle === "object") {
    for (const [k, v] of Object.entries(state.extraStyle)) {
      if (v !== undefined && v !== null && v !== "") {
        styleOut[k] = typeof v === "object" ? { ...v } : v;
      }
    }
  }
  if (state.useCustomColors && state.style) {
    const cleanColors = {};
    for (const [k, v] of Object.entries(state.style)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        cleanColors[k] = v;
      }
    }
    if (state.dualTheme && (styleOut.dark || styleOut.light)) {
      styleOut.dark = { ...(styleOut.dark || {}), ...cleanColors };
    } else {
      Object.assign(styleOut, cleanColors);
    }
  }
  if (Object.keys(styleOut).length) {
    out.style = styleOut;
  }

  out.cards = state.cards.map((card, idx) => {
    const output = (card.output || `${card.type}-${idx + 1}.svg`).trim();
    const extraWidth =
      card.width !== undefined && card.width !== null && card.width !== ""
        ? { width: clampInt(card.width, 360, 680, out.width) }
        : {};
    if (card.type === "typing") {
      return {
        type: "typing",
        output,
        ...extraWidth,
        prompt_top: card.prompt_top,
        prompt_bottom: card.prompt_bottom,
        words: card.words.map((w) => w.trim()).filter(Boolean),
        duration: Number(card.duration) || 8,
        alt: card.alt || "Typing banner",
      };
    }
    if (card.type === "info") {
      return {
        type: "info",
        output,
        ...extraWidth,
        alt: card.alt || "Profile info",
        sections: card.sections.map((sec) => sec.map(([k, v]) => [k, v])),
      };
    }
    if (card.type === "streak") {
      const tz = Number(card.timezone_offset);
      const streakOut = {
        type: "streak",
        output,
        ...extraWidth,
        user: (card.user || "your-username").trim(),
        timezone_offset: Number.isFinite(tz) ? tz : 0,
        title: card.title || "Streak",
        current_label: card.current_label || "Current streak",
        longest_label: card.longest_label || "Longest streak",
      };
      if (card.unit && String(card.unit).trim() && String(card.unit).trim() !== "days") {
        streakOut.unit = String(card.unit).trim();
      }
      if (card.demo_days && typeof card.demo_days === "object" && Object.keys(card.demo_days).length) {
        streakOut.demo_days = { ...card.demo_days };
      }
      streakOut.alt = card.alt || "GitHub streak";
      return streakOut;
    }
    return {
      type: "link",
      output,
      ...extraWidth,
      label: card.label || "Email",
      value: card.value || "you@example.com",
      url: card.url || "",
      alt: card.alt || card.label || "Link",
    };
  });

  return out;
}

export function buildWorkflowYaml({ includePrivate = false, outputDir = "assets" } = {}) {
  const tokenExpr = includePrivate ? "${{ secrets.STREAK_TOKEN }}" : "${{ secrets.GITHUB_TOKEN }}";
  return `name: Update termcard

on:
  push:
    paths:
      - "termcard.json"
  schedule:
    - cron: "0 17 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: termcard-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bagasadh/termcard@v1
        with:
          config: termcard.json
          output_dir: ${outputDir}
          readme: README.md
          token: ${tokenExpr}
`;
}

export function buildReadmeMarkers() {
  return `<!-- TERMCARD:START -->\n<!-- Cards will be inserted here automatically by bagasadh/termcard@v1 -->\n<!-- TERMCARD:END -->\n`;
}
