import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  THEMES,
  resolveTheme,
  resolveThemes,
  variantFilename,
  buildExportConfig,
  renderTyping,
  renderInfo,
  renderLink,
  renderStreak,
} from "../web/renderer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const cases = [];

for (const themeName of Object.keys(THEMES)) {
  const cfg = { theme: themeName, width: 520, radius: 8 };
  cases.push({
    name: `${themeName}/typing`,
    config: cfg,
    card: { type: "typing", prompt_top: "┌ dev", prompt_bottom: "└›", words: ["Hi", "ship"], duration: 6 },
  });
  cases.push({
    name: `${themeName}/info`,
    config: cfg,
    card: {
      type: "info",
      sections: [
        [["Host", "Bagas"]],
        [{ label: "OS", value: "Linux" }, ["Shell", "zsh"]],
      ],
    },
  });
  cases.push({
    name: `${themeName}/link`,
    config: cfg,
    card: { type: "link", label: "GitHub", value: "@bagasadh" },
  });
  cases.push({
    name: `${themeName}/streak`,
    config: cfg,
    card: {
      type: "streak",
      title: "Streak",
      current_label: "Current streak",
      longest_label: "Longest streak",
      unit: "days",
      demo_days: {
        "2026-11-01": 1,
        "2026-11-02": 1,
        "2026-11-03": 1,
        "2026-11-04": 0,
        "2026-11-05": 1,
        "2026-11-06": 1,
      },
      preview_current: 2,
      preview_longest: 3,
      preview_current_range: "Nov 05 - Nov 06",
      preview_longest_range: "Nov 01 - Nov 03",
    },
  });
}

cases.push(
  {
    name: "edge/typing-escaping-and-clamp",
    config: { theme: "dashed-dark", width: 200, radius: 99, style: { stroke: '#fff"', text: "#eee<1>" } },
    card: { type: "typing", user: "octocat", words: "A&B, ok", duration: 0.5 },
  },
  {
    name: "edge/typing-empty-words",
    config: { theme: "solid-dark" },
    card: { type: "typing", words: [], prompt_top: "", prompt_bottom: "$" },
  },
  {
    name: "edge/info-rows-fallback",
    config: { theme: "dashed-light", width: 999 },
    card: { type: "info", rows: [["A & B", "1 < 2"]] },
  },
  {
    name: "edge/info-empty",
    config: { theme: "solid-light" },
    card: { type: "info" },
  },
  {
    name: "edge/link-empty-and-escaped",
    config: { theme: "terminal-green" },
    card: { type: "link", label: "", value: "a&b<c>" },
  },
  {
    name: "edge/streak-single-day",
    config: { theme: "solid-dark" },
    card: {
      type: "streak",
      demo_days: { "2026-11-10": 4 },
      preview_current: 1,
      preview_longest: 1,
      preview_current_range: "Nov 10",
      preview_longest_range: "Nov 10",
    },
  },
  {
    name: "edge/info-long-overflow",
    config: { theme: "dashed-dark", width: 360 },
    card: {
      type: "info",
      sections: [
        [
          ["Very Long Key Label Name", "https://example.com/extremely/long/path/that/would/collide"],
          ["Emoji ⚡", "🚀".repeat(40)],
        ],
      ],
    },
  },
  {
    name: "edge/link-long-overflow",
    config: { theme: "dashed-light", width: 360 },
    card: {
      type: "link",
      label: "Documentation & Source",
      value: "https://github.com/bagasadh/termcard/blob/main/docs/CONFIGURATION.md",
    },
  },
  {
    name: "edge/typing-long-word-unicode",
    config: { theme: "terminal-green", width: 360, radius: 10 },
    card: {
      type: "typing",
      prompt_top: "┌ dev",
      prompt_bottom: "❯",
      words: ["🚀superlongwordthatshouldclipcleanlyinsideframe"],
      duration: 6,
    },
  }
);

const dualThemeConfig = {
  theme: { dark: "dashed-dark", light: "dashed-light" },
  width: 500,
  radius: 8,
  style: {
    dark: { stroke: "#ff00ff" },
    light: { stroke: "#111111" },
  },
};
const dualVariants = resolveThemes(dualThemeConfig);
assert.equal(dualVariants.length, 2);
assert.equal(variantFilename("cards/typing.svg", "dark"), "cards/typing-dark.svg");
assert.equal(variantFilename("cards/typing.svg", "light"), "cards/typing-light.svg");

const roundTripExport = buildExportConfig({
  schemaUrl: "https://raw.githubusercontent.com/bagasadh/termcard/main/termcard.schema.json",
  theme: "dashed-dark",
  dualTheme: true,
  lightTheme: "solid-light",
  width: 540,
  radius: 8,
  font: "Fira Code, monospace",
  useCustomColors: true,
  extraStyle: { dark: { bg_opacity: "0.7" }, light: { stroke: "#222222" } },
  style: { bg: "#101010", stroke: "#ffffff", text: "#ffffff", muted: "#8b949e", link: "#388bfd" },
  cards: [
    {
      type: "streak",
      output: "streak.svg",
      width: 480,
      user: "bagasadh",
      timezone_offset: 5.5,
      title: "Streak",
      current_label: "Now",
      longest_label: "Best",
      unit: "commits",
      demo_days: { "2026-11-20": 3 },
      alt: "Streak",
    },
  ],
});
assert.equal(roundTripExport.$schema, "https://raw.githubusercontent.com/bagasadh/termcard/main/termcard.schema.json");
assert.deepEqual(roundTripExport.theme, { dark: "dashed-dark", light: "solid-light" });
assert.equal(roundTripExport.font, "Fira Code, monospace");
assert.equal(roundTripExport.style.dark.bg_opacity, "0.7");
assert.equal(roundTripExport.style.light.stroke, "#222222");
assert.equal(roundTripExport.cards[0].width, 480);
assert.equal(roundTripExport.cards[0].timezone_offset, 5.5);
assert.equal(roundTripExport.cards[0].unit, "commits");
assert.deepEqual(roundTripExport.cards[0].demo_days, { "2026-11-20": 3 });

function renderJs(config, card) {
  const t = resolveTheme(config);
  switch (card.type) {
    case "typing":
      return renderTyping(card, t);
    case "info":
      return renderInfo(card, t);
    case "link":
      return renderLink(card, t);
    case "streak":
      return renderStreak(card, t);
    default:
      throw new Error(`Unsupported type: ${card.type}`);
  }
}

const pyScript = `
import json, sys, termcard
payload = json.loads(sys.argv[1])
out = []
for item in payload:
    t = termcard.resolve_theme(item["config"])
    c = item["card"]
    ct = c["type"]
    if ct == "typing":
        out.append(termcard.render_typing(c, t))
    elif ct == "info":
        out.append(termcard.render_info(c, t))
    elif ct == "link":
        out.append(termcard.render_link(c, t))
    elif ct == "streak":
        out.append(termcard.render_streak(c, t, token=""))
dual = json.loads(sys.argv[2])
dual_out = [
    termcard.render_link({"label": "Site", "value": "example.com"}, t)
    for _, t in termcard.resolve_themes(dual)
]
print(json.dumps({"cases": out, "dual": dual_out}))
`;

const pyOutput = execFileSync("python3", ["-c", pyScript, JSON.stringify(cases), JSON.stringify(dualThemeConfig)], {
  cwd: repoRoot,
  encoding: "utf8",
});
const { cases: pySvgs, dual: pyDualSvgs } = JSON.parse(pyOutput);

assert.equal(pySvgs.length, cases.length);
cases.forEach((item, idx) => {
  const jsSvg = renderJs(item.config, item.card);
  assert.equal(jsSvg, pySvgs[idx], `Parity mismatch for case: ${item.name}`);
});

dualVariants.forEach(([, theme], idx) => {
  const jsSvg = renderLink({ label: "Site", value: "example.com" }, theme);
  assert.equal(jsSvg, pyDualSvgs[idx], `Dual-theme parity mismatch at variant ${idx}`);
});

console.log(`Parity OK: ${cases.length} cases + ${dualVariants.length} dual-theme variants matched byte-for-byte between termcard.py and web/renderer.js.`);

