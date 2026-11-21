#!/usr/bin/env python3
"""Generate terminal-styled SVG profile cards from a JSON config."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

THEMES = {
    "dashed-dark": {
        "bg": "#000000",
        "bg_opacity": "0.5",
        "stroke": "#ffffff",
        "outline": "#24292f",
        "outline_opacity": "0.8",
        "dasharray": "9.5 6",
        "outline_dasharray": "11.5 4",
        "text": "#ffffff",
        "muted": "#8b949e",
        "link": "#388bfd",
    },
    "dashed-light": {
        "bg": "#ffffff",
        "bg_opacity": "0.85",
        "stroke": "#24292f",
        "outline": "#d0d7de",
        "outline_opacity": "0.9",
        "dasharray": "9.5 6",
        "outline_dasharray": "11.5 4",
        "text": "#1f2328",
        "muted": "#57606a",
        "link": "#0969da",
    },
    "solid-dark": {
        "bg": "#0d1117",
        "bg_opacity": "0.92",
        "stroke": "#30363d",
        "outline": "",
        "outline_opacity": "0",
        "dasharray": "",
        "outline_dasharray": "",
        "text": "#e6edf3",
        "muted": "#8b949e",
        "link": "#58a6ff",
    },
    "solid-light": {
        "bg": "#ffffff",
        "bg_opacity": "1",
        "stroke": "#d0d7de",
        "outline": "",
        "outline_opacity": "0",
        "dasharray": "",
        "outline_dasharray": "",
        "text": "#1f2328",
        "muted": "#656d76",
        "link": "#0969da",
    },
    "terminal-green": {
        "bg": "#040d07",
        "bg_opacity": "0.88",
        "stroke": "#3fb950",
        "outline": "#0f2916",
        "outline_opacity": "0.85",
        "dasharray": "9.5 6",
        "outline_dasharray": "11.5 4",
        "text": "#aff5b4",
        "muted": "#56d364",
        "link": "#7ee787",
    },
}

DEFAULT_FONT = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
MANIFEST_NAME = ".termcard-manifest.json"


def esc(value: object) -> str:
    return escape(str(value), {'"': "&quot;"})


def clamp_int(val: object, lo: int, hi: int, fallback: int) -> int:
    try:
        return max(lo, min(hi, int(val)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def truncate_text(text: str, max_len: int) -> str:
    if max_len <= 0:
        return ""
    if len(text) <= max_len:
        return text
    if max_len <= 3:
        return text[:max_len]
    return text[: max_len - 3].rstrip() + "..."


def fit_pair(label: str, value: str, width: int) -> tuple[str, str]:
    max_total = max(6, ((width - 48) * 10) // 84 - 2)
    l_len = len(label)
    v_len = len(value)
    if l_len + v_len <= max_total:
        return label, value
    if v_len == 0:
        return truncate_text(label, max_total), ""
    if l_len == 0:
        return "", truncate_text(value, max_total)
    half_label = max(4, (max_total * 4) // 10)
    half_value = max_total - half_label
    if l_len <= half_label:
        return label, truncate_text(value, max_total - l_len)
    if v_len <= half_value:
        return truncate_text(label, max_total - v_len), value
    return truncate_text(label, half_label), truncate_text(value, half_value)


def resolve_theme_variant(config: dict, theme_name: str, mode: str | None = None) -> dict:
    base = dict(THEMES.get(theme_name, THEMES["dashed-dark"]))
    base.update(
        {
            "width": clamp_int(config.get("width", 560), 360, 680, 560),
            "radius": clamp_int(config.get("radius", 6), 0, 20, 6),
            "font": config.get("font") or DEFAULT_FONT,
        }
    )
    style = config.get("style") or {}
    if isinstance(style, dict):
        if mode in ("dark", "light") and isinstance(style.get(mode), dict):
            override = style[mode]
        elif mode == "light":
            # Flat style overrides target the primary/dark preset so light mode keeps readable contrast.
            override = {}
        else:
            override = {k: v for k, v in style.items() if not isinstance(v, dict)}
        for key, val in override.items():
            if val is not None and str(val) != "":
                base[key] = val
    return base


def resolve_themes(config: dict) -> list[tuple[str | None, dict]]:
    raw_theme = config.get("theme", "dashed-dark")
    if isinstance(raw_theme, dict):
        dark_name = str(raw_theme.get("dark") or "dashed-dark")
        light_name = str(raw_theme.get("light") or "dashed-light")
        return [
            ("dark", resolve_theme_variant(config, dark_name, mode="dark")),
            ("light", resolve_theme_variant(config, light_name, mode="light")),
        ]
    name = str(raw_theme or "dashed-dark")
    return [(None, resolve_theme_variant(config, name, mode=None))]


def resolve_theme(config: dict) -> dict:
    return resolve_themes(config)[0][1]


def variant_filename(filename: str, variant: str | None) -> str:
    if not variant:
        return filename
    if filename.lower().endswith(".svg"):
        return f"{filename[:-4]}-{variant}.svg"
    return f"{filename}-{variant}"


def dash_attr(val: str) -> str:
    return f' stroke-dasharray="{esc(val)}"' if val else ""


def render_box(w: int, h: int, t: dict) -> str:
    rx = t["radius"]
    inner_w = w - 2
    parts = []
    if t.get("outline"):
        out_dash = f";stroke-dasharray:{esc(t['outline_dasharray'])};stroke-dashoffset:1" if t.get("outline_dasharray") else ""
        parts.append(
            f'<rect x="1" y="1" width="{inner_w}" height="{h}" rx="{rx}" fill="none"'
            f' style="stroke:{esc(t["outline"])};stroke-opacity:{esc(t["outline_opacity"])};stroke-width:3.5{out_dash}"/>'
        )
    parts.append(
        f'<rect x="1" y="1" width="{inner_w}" height="{h}" rx="{rx}"'
        f' fill="{esc(t["bg"])}" fill-opacity="{esc(t["bg_opacity"])}"'
        f' stroke="{esc(t["stroke"])}" stroke-width="1.5"{dash_attr(t.get("dasharray", ""))}/>'
    )
    return "".join(parts)


def render_divider(x1: float, y1: float, x2: float, y2: float, t: dict) -> str:
    parts = []
    if t.get("outline"):
        out_dash = f";stroke-dasharray:{esc(t['outline_dasharray'])};stroke-dashoffset:1" if t.get("outline_dasharray") else ""
        parts.append(
            f'<line x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}"'
            f' style="stroke:{esc(t["outline"])};stroke-opacity:{esc(t["outline_opacity"])};stroke-width:3.5{out_dash}"/>'
        )
    parts.append(
        f'<line x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}"'
        f' stroke="{esc(t["stroke"])}" stroke-width="1.5"{dash_attr(t.get("dasharray", ""))}/>'
    )
    return "".join(parts)


def wrap_svg(
    w: int,
    h: int,
    body: str,
    t: dict,
    font_size: int = 14,
    extra_style: str = "",
    extra_h: int = 16,
) -> str:
    svg_w = w + 6
    svg_h = h + extra_h
    style_tag = f"<style>{extra_style}</style>" if extra_style else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{svg_w}" height="{svg_h}"'
        f' viewBox="-3 -3 {svg_w} {svg_h}">{style_tag}'
        f'<g font-family="{esc(t["font"])}" font-size="{font_size}" fill="{esc(t["text"])}">'
        f"{body}</g></svg>\n"
    )


def render_typing(card: dict, t: dict) -> str:
    w = clamp_int(card.get("width"), 360, 680, t["width"])
    h = 68
    prompt_top = card.get("prompt_top") if card.get("prompt_top") is not None else f"┌ {card.get('user') or 'your-username'}"
    prompt_bottom = card.get("prompt_bottom") if card.get("prompt_bottom") is not None else "└›"
    raw_words = card.get("words")
    if isinstance(raw_words, list):
        words = [str(w).strip() for w in raw_words if w is not None and str(w).strip()]
    else:
        words = [w.strip() for w in str(raw_words or "Hi, fastfetch").split(",") if w.strip()]
    if not words:
        words = ["Hi"]
    try:
        dur_val = float(card.get("duration") or 0)
    except (TypeError, ValueError):
        dur_val = 0.0
    duration = max(2.0, dur_val or max(6, len(words) * 4))
    char_w = 8.4
    start_x = 24 + (len(prompt_bottom) + 1) * char_w

    # Build step timeline: type each char, hold with blinking cursor, backspace, pause.
    timeline: list[tuple[int, int, float, float]] = []
    cursor_spans: dict[int, list[tuple[float, float, bool]]] = {}
    step = 0
    for w_idx, word in enumerate(words):
        step += 2  # initial pause at col 0
        type_starts = []
        for c_idx in range(len(word)):
            cursor_spans.setdefault(c_idx, []).append((step, step + 1, False))
            step += 1
            type_starts.append(step)
        hold_end = step + 8
        cursor_spans.setdefault(len(word), []).append((step, hold_end, True))
        step = hold_end
        for c_idx in range(len(word) - 1, -1, -1):
            del_at = step
            timeline.append((w_idx, c_idx, type_starts[c_idx], del_at))
            cursor_spans.setdefault(c_idx, []).append((del_at, del_at + 1, False))
            step += 1
        cursor_spans.setdefault(0, []).append((step, step + 2, True))
        step += 2

    total = max(step, 1)
    keyframes: list[str] = []
    texts: list[str] = []
    for idx, (w_idx, c_idx, s_on, s_off) in enumerate(timeline):
        p_on = s_on / total * 100
        p_off = s_off / total * 100
        keyframes.append(f"@keyframes l{idx}{{0%{{opacity:0}}{p_on:.2f}%{{opacity:1}}{p_off:.2f}%{{opacity:0}}}}")
        ch = esc(words[w_idx][c_idx])
        x = start_x + c_idx * char_w
        cls = ' class="r"' if w_idx == 0 else ""
        texts.append(
            f'<text x="{x:.1f}" y="54" opacity="0"{cls}'
            f' style="animation:l{idx} {duration:g}s step-end infinite">{ch}</text>'
        )

    cursors: list[str] = []
    for col, spans in sorted(cursor_spans.items()):
        stops = ["0%{opacity:0}"]
        for s_start, s_end, blink in spans:
            if blink and s_end - s_start >= 2:
                cur_s = s_start
                visible = True
                while cur_s < s_end:
                    stops.append(f"{cur_s / total * 100:.2f}%{{opacity:{1 if visible else 0}}}")
                    visible = not visible
                    cur_s += 2
                stops.append(f"{s_end / total * 100:.2f}%{{opacity:0}}")
            else:
                stops.append(f"{s_start / total * 100:.2f}%{{opacity:1}}")
                stops.append(f"{s_end / total * 100:.2f}%{{opacity:0}}")
        keyframes.append(f"@keyframes c{col}{{{''.join(stops)}}}")
        x = start_x + col * char_w
        cls = ' class="r"' if col == len(words[0]) else ""
        cursors.append(
            f'<rect fill="{esc(t["text"])}" x="{x:.1f}" y="41" width="1.5" height="16" opacity="0"{cls}'
            f' style="animation:c{col} {duration:g}s step-end infinite"/>'
        )

    reduced_motion_rule = "@media (prefers-reduced-motion: reduce){text,rect{animation:none !important}.r{opacity:1 !important}}"
    clip_id = f"tc-clip-{w}-{t['radius']}"
    clip_rx = max(0, int(t["radius"]) - 1)
    defs = (
        f'<defs><clipPath id="{clip_id}">'
        f'<rect x="12" y="4" width="{w - 24}" height="{h - 6}" rx="{clip_rx}"/>'
        f"</clipPath></defs>"
    )
    inner = (
        f'<text x="24" y="30">{esc(prompt_top)}</text>'
        + f'<text x="24" y="54">{esc(prompt_bottom)}</text>'
        + "".join(texts)
        + "".join(cursors)
    )
    body = render_box(w, h, t) + defs + f'<g clip-path="url(#{clip_id})">{inner}</g>'
    return wrap_svg(w, h, body, t, font_size=14, extra_style="".join(keyframes) + reduced_motion_rule)


def render_info(card: dict, t: dict) -> str:
    w = clamp_int(card.get("width"), 360, 680, t["width"])
    sections = card.get("sections")
    if not sections and card.get("rows"):
        sections = [card["rows"]]
    sections = sections or [[]]

    y = 30
    elements: list[str] = []
    for s_idx, rows in enumerate(sections):
        if s_idx > 0:
            div_y = y - 9
            elements.append(render_divider(1, div_y, w - 1, div_y, t))
            y += 12
        for row in rows:
            if isinstance(row, dict):
                label = str(row.get("label") if row.get("label") is not None else "")
                value = str(row.get("value") if row.get("value") is not None else "")
            else:
                label = str(row[0] if row[0] is not None else "")
                value = str(row[1] if row[1] is not None else "")
            label, value = fit_pair(label, value, w)
            elements.append(f'<text x="24" y="{y}">{esc(label)}</text>')
            elements.append(f'<text x="{w - 24}" y="{y}" text-anchor="end">{esc(value)}</text>')
            y += 24

    h = max(44, y - 10)
    return wrap_svg(w, h, render_box(w, h, t) + "".join(elements), t, font_size=14)


def render_link(card: dict, t: dict) -> str:
    w = clamp_int(card.get("width"), 360, 680, t["width"])
    h = 44
    raw_label = str(card.get("label") if card.get("label") is not None else "")
    raw_value = str(card.get("value") if card.get("value") is not None else "")
    label_txt, value_txt = fit_pair(raw_label, raw_value, w)
    label = esc(label_txt)
    value = esc(value_txt)
    body = (
        render_box(w, h, t)
        + f'<text x="24" y="28">{label}</text>'
        + f'<text x="{w - 24}" y="28" text-anchor="end" fill="{esc(t["link"])}"'
        + f' text-decoration="underline">{value}</text>'
    )
    return wrap_svg(w, h, body, t, font_size=14)


def compute_streaks(days: dict[str, int], today: dt.date) -> tuple[tuple[int, dt.date | None, dt.date | None], tuple[int, dt.date | None, dt.date | None]]:
    dates = sorted(dt.date.fromisoformat(k) for k in days)
    best: tuple[int, dt.date | None, dt.date | None] = (0, None, None)
    run = 0
    start: dt.date | None = None
    prev: dt.date | None = None
    for d in dates:
        if days[d.isoformat()] > 0:
            if run == 0 or prev is None or (d - prev).days != 1:
                run, start = 0, d
            run += 1
            prev = d
            if run > best[0]:
                best = (run, start, d)
        else:
            run, prev = 0, None

    cur: tuple[int, dt.date | None, dt.date | None] = (0, None, None)
    d = today
    if days.get(d.isoformat(), 0) == 0:
        d -= dt.timedelta(days=1)
    end = d
    n = 0
    while days.get(d.isoformat(), 0) > 0:
        n += 1
        d -= dt.timedelta(days=1)
    if n:
        cur = (n, d + dt.timedelta(days=1), end)
    return cur, best


def fetch_contribution_days(user: str, token: str, now_year: int) -> dict[str, int]:
    def gql(q: str, v: dict) -> dict:
        req = urllib.request.Request(
            "https://api.github.com/graphql",
            data=json.dumps({"query": q, "variables": v}).encode("utf-8"),
            headers={
                "Authorization": f"bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "termcard",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 401:
                raise RuntimeError("GitHub API returned 401 Unauthorized. Check your token or STREAK_TOKEN secret.") from err
            if err.code == 403:
                raise RuntimeError("GitHub API returned 403 Forbidden (rate limit or insufficient token permissions).") from err
            raise RuntimeError(f"GitHub API HTTP {err.code}: {err.reason}") from err
        if payload.get("errors"):
            raise RuntimeError(f"GitHub GraphQL error: {payload['errors']}")
        return payload["data"]

    user_data = gql("query($u:String!){user(login:$u){createdAt}}", {"u": user}).get("user")
    if not user_data:
        raise ValueError(f"GitHub user '{user}' not found. Check the 'user' field in your streak card config.")
    created = int(user_data["createdAt"][:4])
    cal_query = (
        "query($u:String!,$f:DateTime!,$t:DateTime!){"
        "user(login:$u){contributionsCollection(from:$f,to:$t){"
        "contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}"
    )
    days: dict[str, int] = {}
    for year in range(created, now_year + 1):
        cal = gql(
            cal_query,
            {"u": user, "f": f"{year}-01-01T00:00:00Z", "t": f"{year}-12-31T23:59:59Z"},
        )["user"]["contributionsCollection"]["contributionCalendar"]
        for week in cal["weeks"]:
            for day in week["contributionDays"]:
                days[day["date"]] = int(day["contributionCount"])
    return days


def parse_tz_offset(val: object) -> float:
    try:
        offset = float(val)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(offset):
        return 0.0
    return max(-12.0, min(14.0, offset))


def format_range(start: dt.date | None, end: dt.date | None, ref_year: int | None = None) -> str:
    if not start or not end:
        return "-"
    cur_year = ref_year if ref_year is not None else end.year
    if start == end:
        return start.strftime("%b %d") if start.year == cur_year else start.strftime("%b %d, %Y")
    if start.year == end.year:
        if end.year == cur_year:
            return f"{start.strftime('%b %d')} - {end.strftime('%b %d')}"
        return f"{start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}"
    s_fmt = start.strftime("%b %d '%y")
    e_fmt = end.strftime("%b %d '%y")
    return f"{s_fmt} - {e_fmt}"


def resolve_streak_user(card: dict) -> str:
    raw = str(card.get("user") or "").strip()
    if raw and raw.lower() != "your-username":
        return raw
    return os.environ.get("GITHUB_REPOSITORY_OWNER", "").strip()


def render_streak(
    card: dict,
    t: dict,
    token: str,
    days_override: dict[str, int] | None = None,
    days_cache: dict[tuple[str, int], dict[str, int]] | None = None,
) -> str:
    w = clamp_int(card.get("width"), 360, 680, t["width"])
    h = 170
    mid = w / 2
    left_cx = w / 4
    right_cx = w * 3 / 4

    tz_offset = parse_tz_offset(card.get("timezone_offset", 0))
    now_local = dt.datetime.now(dt.timezone.utc).astimezone(dt.timezone(dt.timedelta(hours=tz_offset)))
    today = now_local.date()

    if days_override is not None:
        days = days_override
    elif "demo_days" in card and card["demo_days"] is not None:
        raw_demo = card["demo_days"]
        if isinstance(raw_demo, dict) and raw_demo:
            days = {str(k): int(v) for k, v in raw_demo.items()}
            today = max(dt.date.fromisoformat(k) for k in days)
        else:
            days = {}
    else:
        user = resolve_streak_user(card)
        if not user:
            raise ValueError("Streak card requires 'user' (or GITHUB_REPOSITORY_OWNER in Actions)")
        if not token:
            raise ValueError("Streak card requires GITHUB_TOKEN (or pass --skip-streak for offline builds)")
        cache_key = (user, today.year)
        if days_cache is not None and cache_key in days_cache:
            days = days_cache[cache_key]
        else:
            days = fetch_contribution_days(user, token, today.year)
            if days_cache is not None:
                days_cache[cache_key] = days

    cur, best = compute_streaks(days, today)
    title = esc(card.get("title") or "Streak")
    cur_label = esc(card.get("current_label") or "Current streak")
    best_label = esc(card.get("longest_label") or "Longest streak")
    unit = esc(card.get("unit") or "days")

    parts = [
        render_box(w, h, t),
        f'<text x="{mid:g}" y="30" text-anchor="middle">{title}</text>',
        render_divider(1, 44, w - 1, 44, t),
        f'<text x="{left_cx:g}" y="66" text-anchor="middle">{cur_label}</text>',
        f'<text x="{right_cx:g}" y="66" text-anchor="middle">{best_label}</text>',
        render_divider(1, 78, w - 1, 78, t),
        render_divider(mid, 44, mid, h + 1, t),
    ]
    for cx, data in ((left_cx, cur), (right_cx, best)):
        parts.append(f'<text x="{cx:g}" y="124" text-anchor="middle" font-size="34" font-weight="bold">{data[0]}</text>')
        parts.append(f'<text x="{cx:g}" y="146" text-anchor="middle">{unit}</text>')
        parts.append(
            f'<text x="{cx:g}" y="164" text-anchor="middle" font-size="12" fill="{esc(t["muted"])}">'
            f"{esc(format_range(data[1], data[2], ref_year=today.year))}</text>"
        )

    return wrap_svg(w, h, "".join(parts), t, font_size=15, extra_h=36)


def resolve_output_path(output_dir: Path, filename: str) -> Path:
    raw = str(filename or "").strip()
    if not raw or "\\" in raw:
        raise ValueError(f"Invalid output filename: {filename!r}")
    rel = Path(raw)
    if rel.is_absolute():
        raise ValueError(f"Output filename must be relative: {filename!r}")
    if raw == MANIFEST_NAME or rel.name == MANIFEST_NAME:
        raise ValueError(f"Output filename cannot overwrite manifest: {filename!r}")
    base_resolved = output_dir.resolve()
    dest = (output_dir / rel).resolve()
    if dest == base_resolved or not dest.is_relative_to(base_resolved):
        raise ValueError(f"Output path escapes output directory: {filename!r}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    return dest


def update_readme(
    readme_path: Path,
    entries: list[tuple[str | dict[str, str], str | None, str, int]],
) -> bool:
    start_marker = "<!-- TERMCARD:START -->"
    end_marker = "<!-- TERMCARD:END -->"
    if not readme_path.exists():
        return False
    text = readme_path.read_text(encoding="utf-8")
    if start_marker not in text or end_marker not in text:
        return False

    lines = ['<p align="center">']
    for idx, (rel_src, url, alt, width) in enumerate(entries):
        if isinstance(rel_src, dict):
            dark_src = esc(rel_src["dark"])
            light_src = esc(rel_src["light"])
            media = (
                "<picture>"
                f'<source media="(prefers-color-scheme: dark)" srcset="{dark_src}">'
                f'<source media="(prefers-color-scheme: light)" srcset="{light_src}">'
                f'<img src="{dark_src}" width="{width}" alt="{esc(alt)}">'
                "</picture>"
            )
        else:
            media = f'<img src="{esc(rel_src)}" width="{width}" alt="{esc(alt)}">'
        tag = f'<a href="{esc(url)}">{media}</a>' if url else media
        suffix = "<br>" if idx < len(entries) - 1 else ""
        lines.append(f"  {tag}{suffix}")
    lines.append("</p>")
    block = f"{start_marker}\n" + "\n".join(lines) + f"\n{end_marker}"

    updated = re.sub(
        rf"{re.escape(start_marker)}.*?{re.escape(end_marker)}",
        lambda _: block,
        text,
        flags=re.DOTALL,
    )
    readme_path.write_text(updated, encoding="utf-8")
    return True


def _clean_stale_outputs(output_dir: Path, written: list[Path]) -> None:
    base_resolved = output_dir.resolve()
    current_rel = sorted(p.resolve().relative_to(base_resolved).as_posix() for p in written)
    manifest_path = output_dir / MANIFEST_NAME
    old_files: list[str] = []
    if manifest_path.exists():
        try:
            loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("files"), list):
                old_files = [str(item) for item in loaded["files"]]
        except (OSError, ValueError, TypeError):
            old_files = []

    current_set = set(current_rel)
    for old_rel in old_files:
        if old_rel in current_set:
            continue
        try:
            stale = resolve_output_path(output_dir, old_rel)
        except ValueError:
            continue
        if stale.exists() and stale.is_file():
            stale.unlink()

    manifest_path.write_text(json.dumps({"version": 1, "files": current_rel}, indent=2) + "\n", encoding="utf-8")


def build_cards(
    config_path: Path,
    output_dir: Path,
    token: str = "",
    skip_streak: bool = False,
    readme_path: Path | None = None,
    clean: bool = True,
) -> list[Path]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    themes = resolve_themes(config)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    readme_entries: list[tuple[str | dict[str, str], str | None, str, int]] = []
    days_cache: dict[tuple[str, int], dict[str, int]] = {}

    for idx, card in enumerate(config.get("cards", [])):
        ctype = card.get("type")
        base_filename = card.get("output") or f"{ctype}-{idx + 1}.svg"
        if ctype not in ("typing", "info", "link", "streak"):
            raise ValueError(f"Unsupported card type: {ctype}")
        if ctype == "streak" and skip_streak and not card.get("demo_days"):
            continue

        variant_srcs: dict[str, str] = {}
        single_src: str | None = None
        card_width = clamp_int(card.get("width"), 360, 680, themes[0][1]["width"])
        alt = ""

        for variant, theme in themes:
            filename = variant_filename(base_filename, variant)
            dest = resolve_output_path(output_dir, filename)
            rel_out = output_dir / filename

            if ctype == "typing":
                svg = render_typing(card, theme)
                alt = card.get("alt", "Typing banner")
            elif ctype == "info":
                svg = render_info(card, theme)
                alt = card.get("alt", "Profile info")
            elif ctype == "link":
                svg = render_link(card, theme)
                alt = card.get("alt", card.get("label", "Link"))
            else:
                svg = render_streak(card, theme, token, days_cache=days_cache)
                alt = card.get("alt", "GitHub streak")

            dest.write_text(svg, encoding="utf-8")
            written.append(rel_out)
            if readme_path:
                rel_src = os.path.relpath(dest.resolve(), readme_path.resolve().parent).replace(os.sep, "/")
            else:
                rel_src = rel_out.as_posix()

            if variant is None:
                single_src = rel_src
            else:
                variant_srcs[variant] = rel_src

        if variant_srcs:
            readme_entries.append((variant_srcs, card.get("url"), alt, card_width))
        elif single_src is not None:
            readme_entries.append((single_src, card.get("url"), alt, card_width))

    if readme_path and readme_entries:
        update_readme(readme_path, readme_entries)

    if clean and not skip_streak:
        _clean_stale_outputs(output_dir, written)

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate terminal-styled SVG cards for GitHub profiles.")
    parser.add_argument("--config", default="termcard.json", help="Path to termcard JSON config.")
    parser.add_argument("--out", default="assets", help="Output directory for generated SVGs.")
    parser.add_argument("--readme", default="", help="Optional README.md to update between TERMCARD markers.")
    parser.add_argument("--skip-streak", action="store_true", help="Skip live GitHub streak API calls.")
    parser.add_argument("--no-clean", action="store_true", help="Keep previously generated SVGs not in the current config.")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    readme_path = Path(args.readme) if args.readme else None
    written = build_cards(
        Path(args.config),
        Path(args.out),
        token=token,
        skip_streak=args.skip_streak,
        readme_path=readme_path,
        clean=not args.no_clean,
    )
    for path in written:
        print(f"Generated {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

