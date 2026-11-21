import {
  THEMES,
  resolveTheme,
  resolveThemes,
  variantFilename,
  renderCard,
  renderInfo,
  renderStreak,
  renderLink,
  buildExportConfig,
  buildWorkflowYaml,
  buildReadmeMarkers,
} from "./renderer.js";
import { initCanvas } from "./canvas.js";
import { createSound } from "./sound.js";

let nextId = 1;
const uid = () => `c${nextId++}`;
const COLOR_KEYS = new Set(["bg", "stroke", "text", "muted", "link"]);

function extractImportedStyle(rawStyle, baseTheme) {
  const colors = {
    bg: baseTheme.bg,
    stroke: baseTheme.stroke,
    text: baseTheme.text,
    muted: baseTheme.muted,
    link: baseTheme.link,
  };
  let useCustomColors = false;
  const extraStyle = {};
  if (!rawStyle || typeof rawStyle !== "object") {
    return { colors, useCustomColors, extraStyle };
  }

  const darkObj = rawStyle.dark && typeof rawStyle.dark === "object" ? rawStyle.dark : null;
  if (darkObj) {
    const nonColorDark = {};
    for (const [k, v] of Object.entries(darkObj)) {
      if (COLOR_KEYS.has(k) && v !== undefined && v !== null && String(v).trim() !== "") {
        colors[k] = v;
        useCustomColors = true;
      } else if (v !== undefined && v !== null && v !== "") {
        nonColorDark[k] = v;
      }
    }
    if (Object.keys(nonColorDark).length) extraStyle.dark = nonColorDark;
  }

  for (const [k, v] of Object.entries(rawStyle)) {
    if (k === "dark") continue;
    if (k === "light" && v && typeof v === "object") {
      extraStyle.light = { ...v };
      continue;
    }
    if (!darkObj && COLOR_KEYS.has(k) && v !== undefined && v !== null && String(v).trim() !== "") {
      colors[k] = v;
      useCustomColors = true;
    } else if (v !== undefined && v !== null && v !== "") {
      extraStyle[k] = typeof v === "object" ? { ...v } : v;
    }
  }
  return { colors, useCustomColors, extraStyle };
}

function createStarterState() {
  return {
    schemaUrl: "",
    theme: "dashed-dark",
    dualTheme: false,
    lightTheme: "dashed-light",
    width: 560,
    radius: 6,
    font: "",
    useCustomColors: false,
    extraStyle: {},
    style: {
      bg: THEMES["dashed-dark"].bg,
      stroke: THEMES["dashed-dark"].stroke,
      text: THEMES["dashed-dark"].text,
      muted: THEMES["dashed-dark"].muted,
      link: THEMES["dashed-dark"].link,
    },
    cards: [
      {
        id: uid(),
        type: "typing",
        output: "typing.svg",
        prompt_top: "┌ your-username",
        prompt_bottom: "└›",
        words: ["Hi", "fastfetch"],
        duration: 8,
        alt: "Typing banner",
      },
      {
        id: uid(),
        type: "info",
        output: "info.svg",
        alt: "Profile info",
        sections: [
          [
            ["Host", "Your Name"],
            ["Role", "Software Developer"],
          ],
          [
            ["OS", "Linux x86_64"],
            ["Editor", "Neovim"],
            ["Shell", "zsh"],
          ],
        ],
      },
      {
        id: uid(),
        type: "streak",
        output: "streak.svg",
        user: "your-username",
        timezone_offset: 7,
        title: "Streak",
        current_label: "Current streak",
        longest_label: "Longest streak",
        unit: "days",
        preview_current: 7,
        preview_longest: 14,
        alt: "GitHub streak",
      },
      {
        id: uid(),
        type: "link",
        output: "contact-email.svg",
        label: "Email",
        value: "you@example.com",
        url: "mailto:you@example.com",
        alt: "Email",
      },
    ],
  };
}

const STORAGE_KEY = "termcard_builder_v1";
const SOUND_KEY = "termcard_sound_v1";
const GH_USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

let state = createStarterState();
let openCardIds = new Set(state.cards[0] ? [state.cards[0].id] : []);
let typingPaused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let previewBackdrop = "dark";
let pageTheme = "dark";
let includePrivatePat = false;
let deployUser = "";
let deployBranch = "main";
let sheetOpen = false;
let sheetOpenedAt = 0;
let lastFocusBeforeSheet = null;
let soundOn = false;
try {
  soundOn = localStorage.getItem(SOUND_KEY) === "1";
} catch {
  // Ignore storage errors.
}
const sound = createSound();
let canvas = null;

const el = {
  stage: document.getElementById("canvas-stage"),
  aim: document.getElementById("canvas-aim"),
  cursorLabel: document.getElementById("cursor-label"),
  presetCount: document.getElementById("hud-preset-count"),
  hudHint: document.getElementById("hud-hint-text"),
  hudTz: document.getElementById("hud-tz"),
  hudClock: document.getElementById("hud-clock"),
  hudX: document.getElementById("hud-x"),
  hudY: document.getElementById("hud-y"),
  soundToggle: document.getElementById("sound-toggle"),
  builderSheet: document.getElementById("builder-sheet"),
  closeSheetBtn: document.getElementById("close-sheet-btn"),
  skipToBuilder: document.getElementById("skip-to-builder"),
  motionToggle: document.getElementById("motion-toggle"),
  themeToggle: document.getElementById("theme-toggle"),
  themeLegend: document.getElementById("theme-legend"),
  themePicker: document.getElementById("theme-picker"),
  dualThemeToggle: document.getElementById("dual-theme-toggle"),
  lightThemePickerWrap: document.getElementById("light-theme-picker-wrap"),
  lightThemeSelect: document.getElementById("light-theme-select"),
  widthInput: document.getElementById("card-width"),
  widthOut: document.getElementById("card-width-val"),
  radiusInput: document.getElementById("card-radius"),
  radiusOut: document.getElementById("card-radius-val"),
  customColorsToggle: document.getElementById("custom-colors-toggle"),
  customColorsPanel: document.getElementById("custom-colors-panel"),
  styleBg: document.getElementById("style-bg"),
  styleStroke: document.getElementById("style-stroke"),
  styleText: document.getElementById("style-text"),
  styleMuted: document.getElementById("style-muted"),
  styleLink: document.getElementById("style-link"),
  cardCountLabel: document.getElementById("card-count-label"),
  cardsEditorList: document.getElementById("cards-editor-list"),
  emptyCardsState: document.getElementById("empty-cards-state"),
  livePreviewStage: document.getElementById("live-preview-stage"),
  statusBanner: document.getElementById("status-banner"),
  errorBanner: document.getElementById("error-banner"),
  ghDeployUser: document.getElementById("gh-deploy-user"),
  ghDeployBranch: document.getElementById("gh-deploy-branch"),
  ghUserHint: document.getElementById("gh-user-hint"),
  ghCreateJsonBtn: document.getElementById("gh-create-json-btn"),
  ghCreateYamlBtn: document.getElementById("gh-create-yaml-btn"),
  ghEditReadmeBtn: document.getElementById("gh-edit-readme-btn"),
  outputJson: document.getElementById("output-json"),
  outputYaml: document.getElementById("output-yaml"),
  outputMarkers: document.getElementById("output-markers"),
  svgDownloadList: document.getElementById("svg-download-list"),
  privatePatToggle: document.getElementById("private-pat-toggle"),
  importDialog: document.getElementById("import-dialog"),
  importTextarea: document.getElementById("import-textarea"),
  importError: document.getElementById("import-error"),
  openImportBtn: document.getElementById("open-import-btn"),
};

let statusTimer = null;
function showStatus(msg) {
  el.statusBanner.textContent = msg;
  el.statusBanner.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.statusBanner.hidden = true;
  }, 4500);
}

function showValidationErrors(errors) {
  if (!errors.length) {
    el.errorBanner.hidden = true;
    el.errorBanner.textContent = "";
    return;
  }
  el.errorBanner.textContent = `Check before exporting: ${errors.join(" ")}`;
  el.errorBanner.hidden = false;
}

function validateState() {
  const errors = [];
  const seenOutputs = new Set();
  state.cards.forEach((card, idx) => {
    const label = `Card ${idx + 1} (${card.type})`;
    const out = (card.output || "").trim();
    if (!out || !out.endsWith(".svg")) {
      errors.push(`${label} output filename must end with .svg.`);
    } else if (
      out.startsWith("/") ||
      out.includes("\\") ||
      /(^|\/)\.\.($|\/)/.test(out) ||
      out.endsWith(".termcard-manifest.json")
    ) {
      errors.push(`${label} output filename must be a safe relative path.`);
    } else if (seenOutputs.has(out)) {
      errors.push(`Duplicate output filename "${out}".`);
    } else {
      seenOutputs.add(out);
    }
    if (card.type === "streak" && !(card.user || "").trim()) {
      errors.push(`${label} needs a GitHub username.`);
    }
    if (card.type === "link" && card.url && !/^(https?:\/\/|mailto:)/i.test(card.url.trim())) {
      errors.push(`${label} URL should start with https:// or mailto:.`);
    }
  });
  showValidationErrors(errors);
  return errors;
}

function getSpecimen(key) {
  if (key === "live") {
    const exportCfg = buildExportConfig(state);
    const variants = resolveThemes(exportCfg);
    const baseTheme =
      state.dualTheme && previewBackdrop === "light" && variants[1]
        ? variants[1][1]
        : variants[0][1];
    const items = state.cards.slice(0, 4).map((card) => {
      const cardTheme = card.width ? { ...baseTheme, width: card.width } : baseTheme;
      if (card.type === "typing") {
        return {
          type: "typing",
          card: {
            prompt_top: card.prompt_top,
            prompt_bottom: card.prompt_bottom,
            words: Array.isArray(card.words) ? [...card.words] : ["Hi"],
            duration: card.duration || 8,
          },
          theme: cardTheme,
        };
      }
      return { type: "svg", svg: renderCard(card, cardTheme, { paused: true }) };
    });
    return { stage: previewBackdrop, items };
  }

  const specimens = {
    "typing-dark": {
      stage: "dark",
      items: [
        {
          type: "typing",
          card: { prompt_top: "┌ bagasadh", prompt_bottom: "└›", words: ["Hi", "fastfetch"], duration: 8 },
          theme: resolveTheme({ theme: "dashed-dark", width: 460 }),
        },
      ],
    },
    "info-dark": {
      stage: "dark",
      items: [
        {
          type: "svg",
          svg: renderInfo(
            {
              sections: [
                [
                  ["Host", "Your Name"],
                  ["Role", "Developer"],
                ],
                [
                  ["OS", "Arch Linux"],
                  ["WM", "i3 (X11)"],
                ],
              ],
            },
            resolveTheme({ theme: "dashed-dark", width: 460 })
          ),
        },
      ],
    },
    "streak-green": {
      stage: "dark",
      items: [
        {
          type: "svg",
          svg: renderStreak(
            {
              title: "Streak",
              current_label: "Current streak",
              longest_label: "Longest streak",
              preview_current: 13,
              preview_longest: 13,
              preview_current_range: "Sample preview",
              preview_longest_range: "Live via Action",
            },
            resolveTheme({ theme: "terminal-green", width: 460 })
          ),
        },
      ],
    },
    "light-pair": {
      stage: "light",
      items: [
        {
          type: "typing",
          card: { prompt_top: "┌ studio", prompt_bottom: "$", words: ["build", "ship"], duration: 7 },
          theme: resolveTheme({ theme: "dashed-light", width: 460 }),
        },
        {
          type: "svg",
          svg: renderLink(
            { label: "Email", value: "you@example.com" },
            resolveTheme({ theme: "dashed-light", width: 460 })
          ),
        },
      ],
    },
    "solid-dark-streak": {
      stage: "dark",
      items: [
        {
          type: "svg",
          svg: renderStreak(
            {
              title: "Activity",
              current_label: "Current streak",
              longest_label: "Longest streak",
              preview_current: 9,
              preview_longest: 21,
              preview_current_range: "Sample preview",
              preview_longest_range: "Live via Action",
            },
            resolveTheme({ theme: "solid-dark", width: 460 })
          ),
        },
      ],
    },
    "solid-light-link": {
      stage: "light",
      items: [
        {
          type: "svg",
          svg: renderLink(
            { label: "Portfolio", value: "your-site.dev" },
            resolveTheme({ theme: "solid-light", width: 460 })
          ),
        },
        {
          type: "svg",
          svg: renderLink(
            { label: "GitHub", value: "@your-username" },
            resolveTheme({ theme: "solid-light", width: 460 })
          ),
        },
      ],
    },
  };

  return specimens[key] || specimens["typing-dark"];
}

function renderGallerySpecimens() {
  canvas?.refresh();
}

function renderThemePicker() {
  el.themePicker.innerHTML = "";
  for (const [key, theme] of Object.entries(THEMES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-chip";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(state.theme === key));
    btn.dataset.themeKey = key;

    const swatch = document.createElement("span");
    swatch.className = "theme-swatch";
    swatch.style.background = theme.bg;
    swatch.style.border = `2px ${theme.dasharray ? "dashed" : "solid"} ${theme.stroke}`;

    const label = document.createElement("span");
    label.textContent = theme.label;

    btn.append(swatch, label);
    btn.addEventListener("click", () => selectCardTheme(key));
    el.themePicker.appendChild(btn);
  }
}

function populateLightThemeSelect() {
  el.lightThemeSelect.innerHTML = "";
  for (const [key, theme] of Object.entries(THEMES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = theme.label;
    el.lightThemeSelect.appendChild(opt);
  }
  el.lightThemeSelect.value = THEMES[state.lightTheme] ? state.lightTheme : "dashed-light";
}

function selectCardTheme(key, announce = false) {
  if (!THEMES[key]) return;
  state.theme = key;
  if (!state.useCustomColors) {
    syncColorInputsFromTheme(key);
  }
  if (!state.dualTheme) {
    setPreviewBackdrop(key.includes("light") ? "light" : "dark");
  }
  renderThemePicker();
  renderPreviewAndExport();
  if (announce) {
    showStatus(`Loaded ${THEMES[key].label} theme into the builder.`);
  }
}

function syncColorInputsFromTheme(key) {
  const t = THEMES[key] || THEMES["dashed-dark"];
  state.style = {
    bg: t.bg,
    stroke: t.stroke,
    text: t.text,
    muted: t.muted,
    link: t.link,
  };
  el.styleBg.value = t.bg;
  el.styleStroke.value = t.stroke;
  el.styleText.value = t.text;
  el.styleMuted.value = t.muted;
  el.styleLink.value = t.link;
}

function syncCustomColorsDisabled() {
  const disabled = !state.useCustomColors;
  el.customColorsPanel.classList.toggle("is-disabled", disabled);
  el.customColorsPanel.setAttribute("aria-disabled", String(disabled));
  for (const input of [el.styleBg, el.styleStroke, el.styleText, el.styleMuted, el.styleLink]) {
    input.disabled = disabled;
  }
}

function syncFrameControls() {
  el.dualThemeToggle.checked = Boolean(state.dualTheme);
  el.lightThemePickerWrap.hidden = !state.dualTheme;
  if (el.themeLegend) {
    el.themeLegend.textContent = state.dualTheme ? "Dark mode theme" : "Preset theme";
  }
  el.lightThemeSelect.value = THEMES[state.lightTheme] ? state.lightTheme : "dashed-light";
  el.widthInput.value = String(state.width);
  el.widthOut.textContent = `${state.width}px`;
  el.radiusInput.value = String(state.radius);
  el.radiusOut.textContent = `${state.radius}px`;
  el.customColorsToggle.checked = Boolean(state.useCustomColors);
  syncCustomColorsDisabled();
  el.styleBg.value = state.style.bg;
  el.styleStroke.value = state.style.stroke;
  el.styleText.value = state.style.text;
  el.styleMuted.value = state.style.muted;
  el.styleLink.value = state.style.link;
}

function makeLabeledInput({ id, labelText, value, type = "text", placeholder = "", step, min, max, onInput }) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.className = "field-label";
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.className = "text-input";
  input.value = value ?? "";
  if (placeholder) input.placeholder = placeholder;
  if (step !== undefined) input.step = String(step);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.addEventListener("input", (e) => onInput(e.target.value));

  wrap.append(label, input);
  return wrap;
}

function renderCardsEditor() {
  el.cardsEditorList.innerHTML = "";
  const count = state.cards.length;
  el.cardCountLabel.textContent = `${count} ${count === 1 ? "card" : "cards"}`;
  el.emptyCardsState.hidden = count > 0;

  state.cards.forEach((card, idx) => {
    const isOpen = openCardIds.has(card.id);
    const bodyId = `body-${card.id}`;

    const box = document.createElement("article");
    box.className = `card-editor${isOpen ? "" : " is-collapsed"}`;

    const head = document.createElement("div");
    head.className = "card-editor-head";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "card-toggle-btn";
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
    toggleBtn.setAttribute("aria-controls", bodyId);

    const meta = document.createElement("span");
    meta.className = "card-toggle-meta";

    const title = document.createElement("span");
    title.className = "card-type-title";
    title.textContent = `${String(idx + 1).padStart(2, "0")} / ${card.type.toUpperCase()}`;

    const fileHint = document.createElement("span");
    fileHint.className = "card-file-hint";
    fileHint.textContent = card.output || "";

    meta.append(title, fileHint);

    const stateTxt = document.createElement("span");
    stateTxt.className = "card-toggle-state";
    stateTxt.textContent = isOpen ? "Hide" : "Edit";

    toggleBtn.append(meta, stateTxt);
    toggleBtn.addEventListener("click", () => {
      if (openCardIds.has(card.id)) {
        openCardIds.delete(card.id);
      } else {
        openCardIds.add(card.id);
      }
      renderCardsEditor();
    });

    const actions = document.createElement("div");
    actions.className = "card-editor-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "icon-action-btn";
    upBtn.textContent = "Up";
    upBtn.disabled = idx === 0;
    upBtn.setAttribute("aria-label", `Move card ${idx + 1} up`);
    upBtn.addEventListener("click", () => {
      [state.cards[idx - 1], state.cards[idx]] = [state.cards[idx], state.cards[idx - 1]];
      renderCardsEditor();
      renderPreviewAndExport();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "icon-action-btn";
    downBtn.textContent = "Down";
    downBtn.disabled = idx === state.cards.length - 1;
    downBtn.setAttribute("aria-label", `Move card ${idx + 1} down`);
    downBtn.addEventListener("click", () => {
      [state.cards[idx + 1], state.cards[idx]] = [state.cards[idx], state.cards[idx + 1]];
      renderCardsEditor();
      renderPreviewAndExport();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-action-btn btn-danger";
    delBtn.textContent = "Remove";
    delBtn.setAttribute("aria-label", `Remove ${card.type} card ${idx + 1}`);
    delBtn.addEventListener("click", () => {
      state.cards.splice(idx, 1);
      openCardIds.delete(card.id);
      renderCardsEditor();
      renderPreviewAndExport();
      showStatus(`Removed ${card.type} card.`);
    });

    actions.append(upBtn, downBtn, delBtn);
    head.append(toggleBtn, actions);
    box.appendChild(head);

    const fields = document.createElement("div");
    fields.id = bodyId;
    fields.className = "editor-fields";
    fields.hidden = !isOpen;

    if (card.type === "typing") {
      const topRow = document.createElement("div");
      topRow.className = "two-col";
      topRow.append(
        makeLabeledInput({
          id: `${card.id}-top`,
          labelText: "Top prompt line",
          value: card.prompt_top,
          placeholder: "┌ your-username",
          onInput: (v) => {
            card.prompt_top = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-bottom`,
          labelText: "Bottom prompt prefix",
          value: card.prompt_bottom,
          placeholder: "└›",
          onInput: (v) => {
            card.prompt_bottom = v;
            renderPreviewAndExport();
          },
        })
      );
      fields.appendChild(topRow);

      fields.appendChild(
        makeLabeledInput({
          id: `${card.id}-words`,
          labelText: "Typed words (comma separated)",
          value: card.words.join(", "),
          placeholder: "Hi, fastfetch",
          onInput: (v) => {
            card.words = v.split(",").map((w) => w.trim()).filter(Boolean);
            if (!card.words.length) card.words = ["Hi"];
            renderPreviewAndExport();
          },
        })
      );

      const bottomRow = document.createElement("div");
      bottomRow.className = "two-col";
      bottomRow.append(
        makeLabeledInput({
          id: `${card.id}-dur`,
          labelText: "Loop duration (seconds)",
          value: card.duration,
          type: "number",
          onInput: (v) => {
            card.duration = Math.max(2, Number(v) || 8);
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-out`,
          labelText: "Output SVG filename",
          value: card.output,
          placeholder: "typing.svg",
          onInput: (v) => {
            card.output = v;
            fileHint.textContent = v;
            renderPreviewAndExport();
          },
        })
      );
      fields.appendChild(bottomRow);
    } else if (card.type === "info") {
      fields.appendChild(
        makeLabeledInput({
          id: `${card.id}-out`,
          labelText: "Output SVG filename",
          value: card.output,
          placeholder: "info.svg",
          onInput: (v) => {
            card.output = v;
            fileHint.textContent = v;
            renderPreviewAndExport();
          },
        })
      );

      card.sections.forEach((sec, sIdx) => {
        const secBox = document.createElement("div");
        secBox.className = "info-section-box";

        const secHead = document.createElement("div");
        secHead.className = "info-section-head";
        const secLabel = document.createElement("span");
        secLabel.className = "mono-meta";
        secLabel.textContent = `Group ${sIdx + 1}`;

        const secBtns = document.createElement("div");
        secBtns.className = "section-row-actions";

        const addRowBtn = document.createElement("button");
        addRowBtn.type = "button";
        addRowBtn.className = "icon-action-btn";
        addRowBtn.textContent = "+ Row";
        addRowBtn.addEventListener("click", () => {
          sec.push(["Label", "Value"]);
          renderCardsEditor();
          renderPreviewAndExport();
        });
        secBtns.appendChild(addRowBtn);

        if (card.sections.length > 1) {
          const rmSecBtn = document.createElement("button");
          rmSecBtn.type = "button";
          rmSecBtn.className = "icon-action-btn btn-danger";
          rmSecBtn.textContent = "Remove group";
          rmSecBtn.addEventListener("click", () => {
            card.sections.splice(sIdx, 1);
            renderCardsEditor();
            renderPreviewAndExport();
          });
          secBtns.appendChild(rmSecBtn);
        }

        secHead.append(secLabel, secBtns);
        secBox.appendChild(secHead);

        sec.forEach((row, rIdx) => {
          const rowGrid = document.createElement("div");
          rowGrid.className = "info-row-grid";
          rowGrid.append(
            makeLabeledInput({
              id: `${card.id}-s${sIdx}-r${rIdx}-k`,
              labelText: "Key",
              value: row[0],
              placeholder: "OS",
              onInput: (v) => {
                row[0] = v;
                renderPreviewAndExport();
              },
            }),
            makeLabeledInput({
              id: `${card.id}-s${sIdx}-r${rIdx}-v`,
              labelText: "Value",
              value: row[1],
              placeholder: "Linux",
              onInput: (v) => {
                row[1] = v;
                renderPreviewAndExport();
              },
            })
          );

          const rmRowBtn = document.createElement("button");
          rmRowBtn.type = "button";
          rmRowBtn.className = "icon-action-btn";
          rmRowBtn.textContent = "Del";
          rmRowBtn.disabled = sec.length <= 1;
          rmRowBtn.setAttribute("aria-label", `Delete row ${rIdx + 1} in group ${sIdx + 1}`);
          rmRowBtn.addEventListener("click", () => {
            sec.splice(rIdx, 1);
            renderCardsEditor();
            renderPreviewAndExport();
          });
          rowGrid.appendChild(rmRowBtn);
          secBox.appendChild(rowGrid);
        });

        fields.appendChild(secBox);
      });

      const addGroupBtn = document.createElement("button");
      addGroupBtn.type = "button";
      addGroupBtn.className = "add-btn";
      addGroupBtn.textContent = "+ Add divider group";
      addGroupBtn.addEventListener("click", () => {
        card.sections.push([["Stack", "TypeScript / Python"]]);
        renderCardsEditor();
        renderPreviewAndExport();
      });
      fields.appendChild(addGroupBtn);
    } else if (card.type === "streak") {
      const row1 = document.createElement("div");
      row1.className = "two-col";
      row1.append(
        makeLabeledInput({
          id: `${card.id}-user`,
          labelText: "GitHub username",
          value: card.user,
          placeholder: "your-username",
          onInput: (v) => {
            card.user = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-tz`,
          labelText: "Timezone offset (hours from UTC)",
          value: card.timezone_offset,
          type: "number",
          step: "0.5",
          min: "-12",
          max: "14",
          onInput: (v) => {
            const num = Number(v);
            card.timezone_offset = v.trim() === "" ? 0 : (Number.isFinite(num) ? Math.max(-12, Math.min(14, num)) : 0);
            renderPreviewAndExport();
          },
        })
      );

      const row2 = document.createElement("div");
      row2.className = "two-col";
      row2.append(
        makeLabeledInput({
          id: `${card.id}-title`,
          labelText: "Card title",
          value: card.title,
          placeholder: "Streak",
          onInput: (v) => {
            card.title = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-out`,
          labelText: "Output SVG filename",
          value: card.output,
          placeholder: "streak.svg",
          onInput: (v) => {
            card.output = v;
            fileHint.textContent = v;
            renderPreviewAndExport();
          },
        })
      );

      const row3 = document.createElement("div");
      row3.className = "two-col";
      row3.append(
        makeLabeledInput({
          id: `${card.id}-cur`,
          labelText: "Left column label",
          value: card.current_label,
          placeholder: "Current streak",
          onInput: (v) => {
            card.current_label = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-best`,
          labelText: "Right column label",
          value: card.longest_label,
          placeholder: "Longest streak",
          onInput: (v) => {
            card.longest_label = v;
            renderPreviewAndExport();
          },
        })
      );

      const unitField = makeLabeledInput({
        id: `${card.id}-unit`,
        labelText: "Unit label",
        value: card.unit ?? "days",
        placeholder: "days",
        onInput: (v) => {
          card.unit = v;
          renderPreviewAndExport();
        },
      });

      fields.append(row1, row2, row3, unitField);
    } else if (card.type === "link") {
      const row1 = document.createElement("div");
      row1.className = "two-col";
      row1.append(
        makeLabeledInput({
          id: `${card.id}-lbl`,
          labelText: "Left label",
          value: card.label,
          placeholder: "Email",
          onInput: (v) => {
            card.label = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-val`,
          labelText: "Right display text",
          value: card.value,
          placeholder: "you@example.com",
          onInput: (v) => {
            card.value = v;
            renderPreviewAndExport();
          },
        })
      );

      const row2 = document.createElement("div");
      row2.className = "two-col";
      row2.append(
        makeLabeledInput({
          id: `${card.id}-url`,
          labelText: "Destination URL",
          value: card.url,
          placeholder: "mailto:you@example.com",
          onInput: (v) => {
            card.url = v;
            renderPreviewAndExport();
          },
        }),
        makeLabeledInput({
          id: `${card.id}-out`,
          labelText: "Output SVG filename",
          value: card.output,
          placeholder: "contact-email.svg",
          onInput: (v) => {
            card.output = v;
            fileHint.textContent = v;
            renderPreviewAndExport();
          },
        })
      );

      fields.append(row1, row2);
    }

    box.appendChild(fields);
    el.cardsEditorList.appendChild(box);
  });
}

function renderPreviewAndExport() {
  validateState();

  const exportConfig = buildExportConfig(state);
  const resolvedVariants = resolveThemes(exportConfig);
  const previewTheme =
    state.dualTheme && previewBackdrop === "light" && resolvedVariants[1]
      ? resolvedVariants[1][1]
      : resolvedVariants[0][1];

  el.livePreviewStage.innerHTML = "";
  el.svgDownloadList.innerHTML = "";

  if (!state.cards.length) {
    const note = document.createElement("p");
    note.className = "preview-empty-note";
    note.textContent = "Preview is empty. Add a card on the left to see it rendered here.";
    el.livePreviewStage.appendChild(note);
  } else {
    state.cards.forEach((card, idx) => {
      const svg = renderCard(card, previewTheme, { paused: typingPaused });
      const item = document.createElement("div");
      item.className = "preview-item";
      item.innerHTML = svg;
      el.livePreviewStage.appendChild(item);

      const baseFilename = (card.output || `${card.type}-${idx + 1}.svg`).trim();
      for (const [variant, variantTheme] of resolvedVariants) {
        const dlName = variantFilename(baseFilename, variant);
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "ctrl-btn";
        dlBtn.textContent = `Download ${dlName}`;
        dlBtn.addEventListener("click", () => {
          const exportSvg = renderCard(card, variantTheme, { paused: false });
          downloadTextFile(dlName, exportSvg, "image/svg+xml");
          showStatus(`Downloaded ${dlName}.`);
        });
        el.svgDownloadList.appendChild(dlBtn);
      }
    });
  }

  const jsonText = `${JSON.stringify(exportConfig, null, 2)}\n`;
  const yamlText = buildWorkflowYaml({ includePrivate: includePrivatePat });
  el.outputJson.textContent = jsonText;
  el.outputYaml.textContent = yamlText;
  el.outputMarkers.textContent = buildReadmeMarkers();
  updateGithubQuickLinks(jsonText, yamlText);
  canvas?.refreshLive();
  saveToStorage();
}

function saveToStorage() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state, deployUser, deployBranch, includePrivatePat, previewBackdrop, pageTheme })
    );
  } catch {
    // Ignore storage failures in private browsing or restricted contexts.
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || !saved.state || !Array.isArray(saved.state.cards)) return;
    const tKey = THEMES[saved.state.theme] ? saved.state.theme : "dashed-dark";
    const baseT = THEMES[tKey];
    state = {
      schemaUrl: typeof saved.state.schemaUrl === "string" ? saved.state.schemaUrl : "",
      theme: tKey,
      dualTheme: Boolean(saved.state.dualTheme),
      lightTheme: THEMES[saved.state.lightTheme] ? saved.state.lightTheme : "dashed-light",
      width: Number(saved.state.width) || 560,
      radius: Number(saved.state.radius ?? 6),
      font: typeof saved.state.font === "string" ? saved.state.font : "",
      useCustomColors: Boolean(saved.state.useCustomColors),
      extraStyle:
        saved.state.extraStyle && typeof saved.state.extraStyle === "object"
          ? saved.state.extraStyle
          : {},
      style: {
        bg: saved.state.style?.bg || baseT.bg,
        stroke: saved.state.style?.stroke || baseT.stroke,
        text: saved.state.style?.text || baseT.text,
        muted: saved.state.style?.muted || baseT.muted,
        link: saved.state.style?.link || baseT.link,
      },
      cards: saved.state.cards.map((c) => ({ ...c, id: uid() })),
    };
    openCardIds = new Set(state.cards[0] ? [state.cards[0].id] : []);
    deployUser = typeof saved.deployUser === "string" ? saved.deployUser : "";
    deployBranch = typeof saved.deployBranch === "string" && saved.deployBranch.trim() ? saved.deployBranch.trim() : "main";
    includePrivatePat = Boolean(saved.includePrivatePat);
    previewBackdrop = saved.previewBackdrop === "light" ? "light" : "dark";
    pageTheme = saved.pageTheme === "light" ? "light" : "dark";
  } catch {
    // Fall back to starter state if saved JSON is corrupted.
  }
}

function getEffectiveGithubUser() {
  const manual = deployUser.trim();
  if (manual) return manual;
  const streak = state.cards.find((c) => c.type === "streak" && c.user && c.user.trim().toLowerCase() !== "your-username");
  return streak ? streak.user.trim() : "";
}

function updateGithubQuickLinks(jsonText, yamlText) {
  const user = getEffectiveGithubUser();
  const branch = deployBranch.trim().replace(/^\/+|\/+$/g, "") || "main";
  const valid = Boolean(user && user.toLowerCase() !== "your-username" && GH_USER_RE.test(user));

  const setDisabledAnchor = (anchor) => {
    anchor.href = "#gh-deploy-user";
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
    anchor.setAttribute("aria-disabled", "true");
  };

  const setLink = (anchor, filename, content) => {
    if (!valid) {
      setDisabledAnchor(anchor);
      return true;
    }
    const url = `https://github.com/${encodeURIComponent(user)}/${encodeURIComponent(user)}/new/${encodeURIComponent(branch)}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(content)}`;
    if (url.length > 7000) {
      setDisabledAnchor(anchor);
      return false;
    }
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.removeAttribute("aria-disabled");
    return true;
  };

  const jsonFits = setLink(el.ghCreateJsonBtn, "termcard.json", jsonText);
  setLink(el.ghCreateYamlBtn, ".github/workflows/termcard.yml", yamlText);
  if (el.ghEditReadmeBtn) {
    if (!valid) {
      setDisabledAnchor(el.ghEditReadmeBtn);
    } else {
      el.ghEditReadmeBtn.href = `https://github.com/${encodeURIComponent(user)}/${encodeURIComponent(user)}/edit/${encodeURIComponent(branch)}/README.md`;
      el.ghEditReadmeBtn.target = "_blank";
      el.ghEditReadmeBtn.rel = "noopener noreferrer";
      el.ghEditReadmeBtn.removeAttribute("aria-disabled");
    }
  }

  if (!user) {
    el.ghUserHint.textContent = "Enter your GitHub username to prefill files directly in github.com/username/username.";
  } else if (!valid) {
    el.ghUserHint.textContent = "Enter a valid GitHub username (letters, numbers, single hyphens, max 39 chars).";
  } else if (!jsonFits) {
    el.ghUserHint.textContent = `Ready for github.com/${user}/${user} (${branch}) (JSON is too long for a URL prefill; use Copy or Download).`;
  } else {
    el.ghUserHint.textContent = `1-click Create opens github.com/${user}/${user} (${branch}). If a file already exists, edit it directly on GitHub.`;
  }
}

function addCard(type) {
  const n = state.cards.filter((c) => c.type === type).length + 1;
  const suffix = n > 1 ? `-${n}` : "";
  if (type === "typing") {
    state.cards.push({
      id: uid(),
      type: "typing",
      output: `typing${suffix}.svg`,
      prompt_top: "┌ your-username",
      prompt_bottom: "└›",
      words: ["Hi", "fastfetch"],
      duration: 8,
      alt: "Typing banner",
    });
  } else if (type === "info") {
    state.cards.push({
      id: uid(),
      type: "info",
      output: `info${suffix}.svg`,
      alt: "Profile info",
      sections: [
        [
          ["Host", "Your Name"],
          ["Role", "Developer"],
        ],
      ],
    });
  } else if (type === "streak") {
    state.cards.push({
      id: uid(),
      type: "streak",
      output: `streak${suffix}.svg`,
      user: "your-username",
      timezone_offset: 7,
      title: "Streak",
      current_label: "Current streak",
      longest_label: "Longest streak",
      unit: "days",
      preview_current: 7,
      preview_longest: 14,
      alt: "GitHub streak",
    });
  } else if (type === "link") {
    state.cards.push({
      id: uid(),
      type: "link",
      output: `link${suffix}.svg`,
      label: "GitHub",
      value: "@your-username",
      url: "https://github.com/your-username",
      alt: "GitHub",
    });
  }
  const added = state.cards[state.cards.length - 1];
  if (added) openCardIds.add(added.id);
  renderCardsEditor();
  renderPreviewAndExport();
  showStatus(`Added ${type} card.`);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    sound.chime();
    showStatus(`Copied ${label} to clipboard.`);
  } catch {
    showStatus(`Clipboard blocked by browser. Select and copy ${label} manually from the box below.`);
  }
}

function downloadTextFile(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setPreviewBackdrop(mode) {
  previewBackdrop = mode === "light" ? "light" : "dark";
  el.livePreviewStage.classList.toggle("backdrop-dark", previewBackdrop === "dark");
  el.livePreviewStage.classList.toggle("backdrop-light", previewBackdrop === "light");
  document.querySelectorAll("[data-backdrop]").forEach((btn) => {
    const active = btn.dataset.backdrop === previewBackdrop;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  if (canvas && state.dualTheme) {
    renderPreviewAndExport();
    return;
  }
  canvas?.refreshLive();
  saveToStorage();
}

function updateSoundButton() {
  if (!el.soundToggle) return;
  el.soundToggle.classList.toggle("is-on", soundOn);
  el.soundToggle.setAttribute("aria-pressed", String(soundOn));
}

function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  sheetOpenedAt = performance.now();
  lastFocusBeforeSheet = document.activeElement;
  el.builderSheet.classList.add("is-open");
  el.builderSheet.setAttribute("aria-hidden", "false");
  sound.swoosh(true);
  el.closeSheetBtn?.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  el.builderSheet.classList.remove("is-open");
  el.builderSheet.setAttribute("aria-hidden", "true");
  sound.swoosh(false);
  lastFocusBeforeSheet?.focus?.({ preventScroll: true });
}

function applyPageTheme(mode) {
  pageTheme = mode === "light" ? "light" : "dark";
  const isLight = pageTheme === "light";
  document.documentElement.setAttribute("data-theme", pageTheme);
  const fullLabel = isLight ? "Dark mode" : "Light mode";
  const shortLabel = isLight ? "Dark" : "Light";
  const fullEl = el.themeToggle.querySelector(".lbl-full");
  const shortEl = el.themeToggle.querySelector(".lbl-short");
  if (fullEl && shortEl) {
    fullEl.textContent = fullLabel;
    shortEl.textContent = shortLabel;
  } else {
    el.themeToggle.textContent = fullLabel;
  }
  el.themeToggle.setAttribute("aria-label", `Switch to ${fullLabel.toLowerCase()}`);
  el.themeToggle.setAttribute("aria-pressed", String(isLight));
  canvas?.setTheme(pageTheme);
  saveToStorage();
}

function updateMotionButton() {
  el.motionToggle.textContent = typingPaused ? "Play typing" : "Pause typing";
  el.motionToggle.setAttribute("aria-pressed", String(typingPaused));
}

function importConfigFromText(rawText) {
  el.importError.hidden = true;
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    el.importError.textContent = `Invalid JSON syntax: ${err.message}`;
    el.importError.hidden = false;
    return false;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cards)) {
    el.importError.textContent = 'Expected a JSON object with a "cards" array.';
    el.importError.hidden = false;
    return false;
  }

  const isDual = Boolean(parsed.theme && typeof parsed.theme === "object");
  const nextTheme = isDual
    ? (THEMES[parsed.theme.dark] ? parsed.theme.dark : "dashed-dark")
    : (THEMES[parsed.theme] ? parsed.theme : "dashed-dark");
  const nextLightTheme = isDual
    ? (THEMES[parsed.theme.light] ? parsed.theme.light : "dashed-light")
    : "dashed-light";
  const baseT = THEMES[nextTheme];
  const parsedStyle = extractImportedStyle(parsed.style, baseT);

  const importedCards = [];
  for (let i = 0; i < parsed.cards.length; i += 1) {
    const c = parsed.cards[i];
    if (!c || !["typing", "info", "streak", "link"].includes(c.type)) {
      el.importError.textContent = `Card #${i + 1} has unsupported type "${c?.type}". Use typing, info, streak, or link.`;
      el.importError.hidden = false;
      return false;
    }
    const cardWidth = Number.isFinite(Number(c.width)) ? Number(c.width) : undefined;
    const widthOpt = cardWidth !== undefined ? { width: cardWidth } : {};
    if (c.type === "typing") {
      importedCards.push({
        id: uid(),
        type: "typing",
        output: c.output || `typing-${i + 1}.svg`,
        ...widthOpt,
        prompt_top: c.prompt_top ?? "┌ your-username",
        prompt_bottom: c.prompt_bottom ?? "└›",
        words: Array.isArray(c.words) && c.words.length ? c.words.map(String) : ["Hi"],
        duration: Number(c.duration) || 8,
        alt: c.alt || "Typing banner",
      });
    } else if (c.type === "info") {
      const rawSections = Array.isArray(c.sections) && c.sections.length
        ? c.sections
        : Array.isArray(c.rows)
        ? [c.rows]
        : [[["Host", "Your Name"]]];
      importedCards.push({
        id: uid(),
        type: "info",
        output: c.output || `info-${i + 1}.svg`,
        ...widthOpt,
        alt: c.alt || "Profile info",
        sections: rawSections.map((sec) =>
          sec.map((row) => (Array.isArray(row) ? [String(row[0] ?? ""), String(row[1] ?? "")] : [String(row.label ?? ""), String(row.value ?? "")]))
        ),
      });
    } else if (c.type === "streak") {
      const tz = Number(c.timezone_offset);
      const demoDays = c.demo_days && typeof c.demo_days === "object" ? { ...c.demo_days } : undefined;
      importedCards.push({
        id: uid(),
        type: "streak",
        output: c.output || `streak-${i + 1}.svg`,
        ...widthOpt,
        user: String(c.user || "your-username"),
        timezone_offset: Number.isFinite(tz) ? tz : 0,
        title: String(c.title || "Streak"),
        current_label: String(c.current_label || "Current streak"),
        longest_label: String(c.longest_label || "Longest streak"),
        unit: String(c.unit || "days"),
        ...(demoDays ? { demo_days: demoDays } : {}),
        preview_current: 7,
        preview_longest: 14,
        alt: c.alt || "GitHub streak",
      });
    } else {
      importedCards.push({
        id: uid(),
        type: "link",
        output: c.output || `link-${i + 1}.svg`,
        ...widthOpt,
        label: String(c.label || "Link"),
        value: String(c.value || ""),
        url: String(c.url || ""),
        alt: c.alt || c.label || "Link",
      });
    }
  }

  state = {
    schemaUrl: typeof parsed.$schema === "string" ? parsed.$schema : "",
    theme: nextTheme,
    dualTheme: isDual,
    lightTheme: nextLightTheme,
    width: Number(parsed.width) || 560,
    radius: Number(parsed.radius ?? 6),
    font: typeof parsed.font === "string" ? parsed.font : "",
    useCustomColors: parsedStyle.useCustomColors,
    extraStyle: parsedStyle.extraStyle,
    style: parsedStyle.colors,
    cards: importedCards,
  };

  openCardIds = new Set(state.cards[0] ? [state.cards[0].id] : []);
  syncFrameControls();
  renderThemePicker();
  renderCardsEditor();
  renderPreviewAndExport();
  showStatus(`Imported ${importedCards.length} card(s) from JSON.`);
  return true;
}

function wireEvents() {
  el.motionToggle.addEventListener("click", () => {
    typingPaused = !typingPaused;
    updateMotionButton();
    renderGallerySpecimens();
    renderPreviewAndExport();
  });

  el.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyPageTheme(current === "dark" ? "light" : "dark");
  });

  el.soundToggle?.addEventListener("click", () => {
    soundOn = !soundOn;
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
    } catch {
      // Ignore storage errors.
    }
    updateSoundButton();
    if (soundOn) sound.enable();
    else sound.disable();
  });

  const resumeRememberedSound = (e) => {
    if (!soundOn || sound.running || e.target.closest?.("#sound-toggle")) return;
    sound.enable();
  };
  window.addEventListener("pointerdown", resumeRememberedSound, true);
  window.addEventListener("keydown", resumeRememberedSound, true);

  document.querySelectorAll("[data-fly]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      closeSheet();
      canvas?.fly(btn.dataset.fly);
      if (e.detail > 0) btn.blur();
    });
  });

  document.querySelectorAll("[data-open-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sound.tap();
      openSheet();
    });
  });

  el.skipToBuilder?.addEventListener("click", (e) => {
    e.preventDefault();
    openSheet();
  });

  el.builderSheet?.addEventListener("click", (e) => {
    if (e.target.closest(".sheet__backdrop") && performance.now() - sheetOpenedAt < 450) return;
    if (e.target.closest("[data-close-sheet]")) {
      closeSheet();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetOpen && !el.importDialog?.open) {
      closeSheet();
      return;
    }
    if (
      (e.key === "b" || e.key === "B") &&
      !sheetOpen &&
      !el.importDialog?.open &&
      !e.repeat &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.target.closest?.("input, textarea, select, dialog, [contenteditable]")
    ) {
      e.preventDefault();
      sound.tap();
      openSheet();
    }
  });

  el.dualThemeToggle.addEventListener("change", (e) => {
    state.dualTheme = e.target.checked;
    if (state.dualTheme && state.theme.includes("light")) {
      state.lightTheme = state.theme;
      state.theme = state.theme === "solid-light" ? "solid-dark" : "dashed-dark";
      if (!state.useCustomColors) syncColorInputsFromTheme(state.theme);
    }
    syncFrameControls();
    renderThemePicker();
    renderPreviewAndExport();
  });

  el.lightThemeSelect.addEventListener("change", (e) => {
    if (THEMES[e.target.value]) {
      state.lightTheme = e.target.value;
      renderPreviewAndExport();
    }
  });

  el.widthInput.addEventListener("input", (e) => {
    state.width = Number(e.target.value);
    el.widthOut.textContent = `${state.width}px`;
    renderPreviewAndExport();
  });

  el.radiusInput.addEventListener("input", (e) => {
    state.radius = Number(e.target.value);
    el.radiusOut.textContent = `${state.radius}px`;
    renderPreviewAndExport();
  });

  el.customColorsToggle.addEventListener("change", (e) => {
    state.useCustomColors = e.target.checked;
    syncCustomColorsDisabled();
    renderPreviewAndExport();
  });

  for (const [inputEl, key] of [
    [el.styleBg, "bg"],
    [el.styleStroke, "stroke"],
    [el.styleText, "text"],
    [el.styleMuted, "muted"],
    [el.styleLink, "link"],
  ]) {
    inputEl.addEventListener("input", (e) => {
      state.style[key] = e.target.value;
      renderPreviewAndExport();
    });
  }

  document.querySelectorAll("[data-add-card]").forEach((btn) => {
    btn.addEventListener("click", () => addCard(btn.dataset.addCard));
  });

  const resetAll = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
    state = createStarterState();
    openCardIds = new Set(state.cards[0] ? [state.cards[0].id] : []);
    deployUser = "";
    deployBranch = "main";
    includePrivatePat = false;
    el.ghDeployUser.value = "";
    el.ghDeployBranch.value = "main";
    el.privatePatToggle.checked = false;
    syncFrameControls();
    renderThemePicker();
    renderCardsEditor();
    renderPreviewAndExport();
    showStatus("Restored starter profile cards and cleared saved draft.");
  };
  document.getElementById("reset-default-btn").addEventListener("click", resetAll);
  document.getElementById("restore-from-empty-btn").addEventListener("click", resetAll);

  el.ghDeployBranch.addEventListener("input", (e) => {
    deployBranch = e.target.value;
    renderPreviewAndExport();
  });

  el.ghDeployUser.addEventListener("input", (e) => {
    const prev = deployUser.trim();
    deployUser = e.target.value.trim();
    let editorNeedsRefresh = false;
    if (deployUser && GH_USER_RE.test(deployUser)) {
      state.cards.forEach((card) => {
        if (card.type === "streak" && (!card.user || card.user === "your-username" || card.user === prev)) {
          card.user = deployUser;
          editorNeedsRefresh = true;
        }
        if (card.type === "typing" && (card.prompt_top === "┌ your-username" || (prev && card.prompt_top === `┌ ${prev}`))) {
          card.prompt_top = `┌ ${deployUser}`;
          editorNeedsRefresh = true;
        }
      });
    }
    if (editorNeedsRefresh) {
      renderCardsEditor();
    }
    renderPreviewAndExport();
  });

  const guardDisabledLink = (e) => {
    if (e.currentTarget.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      el.ghDeployUser.focus();
      showStatus("Enter your GitHub username above to enable 1-click Create on GitHub.");
    }
  };
  el.ghCreateJsonBtn.addEventListener("click", guardDisabledLink);
  el.ghCreateYamlBtn.addEventListener("click", guardDisabledLink);
  el.ghEditReadmeBtn?.addEventListener("click", guardDisabledLink);

  document.querySelectorAll("[data-backdrop]").forEach((btn) => {
    btn.addEventListener("click", () => setPreviewBackdrop(btn.dataset.backdrop));
  });

  // Export tabs with click + Left/Right keyboard navigation.
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const activateTab = (tab) => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.classList.toggle("is-active", selected);
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    });
  };
  tabs.forEach((tab, idx) => {
    tab.tabIndex = idx === 0 ? 0 : -1;
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        const next = tabs[(idx + 1) % tabs.length];
        activateTab(next);
        next.focus();
      } else if (e.key === "ArrowLeft") {
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        activateTab(prev);
        prev.focus();
      }
    });
  });

  el.privatePatToggle.addEventListener("change", (e) => {
    includePrivatePat = e.target.checked;
    renderPreviewAndExport();
  });

  document.getElementById("copy-json-btn").addEventListener("click", () => {
    copyText(el.outputJson.textContent, "termcard.json");
  });
  document.getElementById("download-json-btn").addEventListener("click", () => {
    downloadTextFile("termcard.json", el.outputJson.textContent, "application/json");
    showStatus("Downloaded termcard.json.");
  });
  document.getElementById("copy-yaml-btn").addEventListener("click", () => {
    copyText(el.outputYaml.textContent, "termcard.yml");
  });
  document.getElementById("download-yaml-btn").addEventListener("click", () => {
    downloadTextFile("termcard.yml", el.outputYaml.textContent, "text/yaml");
    showStatus("Downloaded termcard.yml.");
  });
  document.getElementById("copy-markers-btn").addEventListener("click", () => {
    copyText(el.outputMarkers.textContent, "README markers");
  });

  // Import modal (native <dialog> handles Escape; return focus on close).
  const closeDialog = () => {
    el.importDialog.close();
    el.openImportBtn.focus();
  };
  el.openImportBtn.addEventListener("click", () => {
    el.importError.hidden = true;
    el.importTextarea.value = el.outputJson.textContent.trim();
    el.importDialog.showModal();
    el.importTextarea.focus();
  });
  document.getElementById("close-import-btn").addEventListener("click", closeDialog);
  document.getElementById("cancel-import-btn").addEventListener("click", closeDialog);
  document.getElementById("apply-import-btn").addEventListener("click", () => {
    if (importConfigFromText(el.importTextarea.value)) {
      closeDialog();
    }
  });
}

loadFromStorage();
populateLightThemeSelect();
updateMotionButton();
updateSoundButton();
applyPageTheme(pageTheme);
setPreviewBackdrop(previewBackdrop);
el.ghDeployUser.value = deployUser;
el.ghDeployBranch.value = deployBranch;
el.privatePatToggle.checked = includePrivatePat;
syncFrameControls();
renderThemePicker();
renderCardsEditor();
renderPreviewAndExport();
canvas = initCanvas({
  stage: el.stage,
  aim: el.aim,
  label: el.cursorLabel,
  presetCount: el.presetCount,
  hint: el.hudHint,
  hudTz: el.hudTz,
  hudClock: el.hudClock,
  hudX: el.hudX,
  hudY: el.hudY,
  sound,
  getTheme: () => pageTheme,
  getSpecimen,
  isSheetOpen: () => sheetOpen,
  isPaused: () => typingPaused,
  onAction: (action) => {
    if (action.type === "preset" && action.preset) {
      selectCardTheme(action.preset, true);
      openSheet();
    } else if (action.type === "builder") {
      openSheet();
    }
  },
});
wireEvents();
const urlParams = new URLSearchParams(window.location.search);
const presetParam = urlParams.get("preset");
if (presetParam && THEMES[presetParam]) {
  selectCardTheme(presetParam, true);
  openSheet();
} else if (window.location.hash === "#builder" || window.location.hash === "#builder-sheet") {
  openSheet();
}

