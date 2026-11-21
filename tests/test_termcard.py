import datetime as dt
import io
import json
import tempfile
import unittest
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import termcard


class TestTermcard(unittest.TestCase):
    def assertValidSvg(self, svg: str) -> ET.Element:
        root = ET.fromstring(svg)
        self.assertTrue(root.tag.endswith("svg"))
        return root

    def test_all_themes_and_style_override(self) -> None:
        for name in termcard.THEMES:
            t = termcard.resolve_theme({"theme": name, "width": 500, "style": {"stroke": "#ff0000"}})
            self.assertEqual(t["width"], 500)
            self.assertEqual(t["stroke"], "#ff0000")

    def test_render_typing_valid_xml_and_escaping(self) -> None:
        t = termcard.resolve_theme({"theme": "dashed-dark"})
        svg = termcard.render_typing(
            {"prompt_top": "┌ dev & ops", "prompt_bottom": "└>", "words": ["A<B", "ok"], "duration": 6},
            t,
        )
        self.assertValidSvg(svg)
        self.assertIn("dev &amp; ops", svg)
        self.assertIn("&lt;", svg)
        self.assertIn("@keyframes l0", svg)
        self.assertIn("@keyframes c0", svg)

    def test_render_info_sections_and_dividers(self) -> None:
        t = termcard.resolve_theme({"theme": "solid-dark"})
        svg = termcard.render_info(
            {
                "sections": [
                    [["Host", "Alice"]],
                    [{"label": "OS", "value": "Arch & i3"}],
                ]
            },
            t,
        )
        self.assertValidSvg(svg)
        self.assertIn("<line ", svg)
        self.assertIn("Arch &amp; i3", svg)

    def test_render_link_valid_xml(self) -> None:
        t = termcard.resolve_theme({"theme": "terminal-green"})
        svg = termcard.render_link({"label": "Email", "value": "me@example.com"}, t)
        self.assertValidSvg(svg)
        self.assertIn("me@example.com", svg)
        self.assertIn('text-decoration="underline"', svg)

    def test_compute_streaks_edge_cases(self) -> None:
        days = {
            "2026-11-01": 3,
            "2026-11-02": 4,
            "2026-11-03": 2,
            "2026-11-04": 0,
            "2026-11-05": 1,
            "2026-11-06": 5,
            "2026-11-07": 0,
        }
        cur, best = termcard.compute_streaks(days, dt.date(2026, 11, 7))
        self.assertEqual(cur[0], 2)
        self.assertEqual(cur[1], dt.date(2026, 11, 5))
        self.assertEqual(cur[2], dt.date(2026, 11, 6))
        self.assertEqual(best[0], 3)

        broken_cur, _ = termcard.compute_streaks(days, dt.date(2026, 11, 8))
        self.assertEqual(broken_cur[0], 0)

    def test_render_streak_and_build_cards_with_readme(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg_path = root / "termcard.json"
            readme_path = root / "README.md"
            out_dir = root / "assets"

            cfg_path.write_text(
                json.dumps(
                    {
                        "theme": "dashed-light",
                        "cards": [
                            {"type": "typing", "output": "t.svg", "words": ["hi"]},
                            {
                                "type": "streak",
                                "output": "s.svg",
                                "demo_days": {"2026-11-10": 2, "2026-11-11": 5},
                            },
                            {"type": "link", "output": "l.svg", "label": "Web", "value": "example.com", "url": "https://example.com"},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            readme_path.write_text("# Hi\n<!-- TERMCARD:START -->\nold\n<!-- TERMCARD:END -->\n", encoding="utf-8")

            written = termcard.build_cards(cfg_path, out_dir, readme_path=readme_path)
            self.assertEqual(len(written), 3)
            for svg_file in written:
                self.assertValidSvg(svg_file.read_text(encoding="utf-8"))

            readme_text = readme_path.read_text(encoding="utf-8")
            self.assertIn('<img src="assets/t.svg" width="560"', readme_text)
            self.assertIn('<a href="https://example.com"><img src="assets/l.svg"', readme_text)
            self.assertNotIn("old", readme_text)

    def test_resolve_streak_user_fallback(self) -> None:
        import os
        old = os.environ.get("GITHUB_REPOSITORY_OWNER")
        try:
            os.environ["GITHUB_REPOSITORY_OWNER"] = "octocat"
            self.assertEqual(termcard.resolve_streak_user({"user": "your-username"}), "octocat")
            self.assertEqual(termcard.resolve_streak_user({}), "octocat")
            self.assertEqual(termcard.resolve_streak_user({"user": "bagasadh"}), "bagasadh")
        finally:
            if old is None:
                os.environ.pop("GITHUB_REPOSITORY_OWNER", None)
            else:
                os.environ["GITHUB_REPOSITORY_OWNER"] = old

    def test_render_typing_reduced_motion_shows_first_word(self) -> None:
        t = termcard.resolve_theme({"theme": "dashed-dark"})
        svg = termcard.render_typing({"words": ["Hi", "fastfetch"], "duration": 1}, t)
        root = self.assertValidSvg(svg)
        self.assertIn("@media (prefers-reduced-motion: reduce){text,rect{animation:none !important}.r{opacity:1 !important}}", svg)
        self.assertIn("2s step-end infinite", svg)
        r_texts = [el.text for el in root.iter() if el.tag.endswith("text") and el.attrib.get("class") == "r"]
        self.assertEqual(sorted(r_texts), ["H", "i"])
        r_rects = [el for el in root.iter() if el.tag.endswith("rect") and el.attrib.get("class") == "r"]
        self.assertEqual(len(r_rects), 1)

    def test_resolve_theme_clamping_and_style_escaping(self) -> None:
        t = termcard.resolve_theme(
            {
                "theme": "dashed-dark",
                "width": 100,
                "radius": 99,
                "style": {
                    "bg": '#111" onclick="x',
                    "stroke": "#fff<bad>",
                    "text": "#eee",
                    "link": '#09f"',
                },
            }
        )
        self.assertEqual(t["width"], 360)
        self.assertEqual(t["radius"], 20)
        svg = termcard.render_link({"label": "Site", "value": "example.com"}, t)
        self.assertValidSvg(svg)
        self.assertIn("&quot;", svg)
        self.assertIn("&lt;bad&gt;", svg)

    def test_update_readme_handles_backslashes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            readme_path = Path(tmp) / "README.md"
            readme_path.write_text("<!-- TERMCARD:START -->\n<!-- TERMCARD:END -->\n", encoding="utf-8")
            ok = termcard.update_readme(readme_path, [("assets/t.svg", "https://example.com", r"dev\1\ops", 560)])
            self.assertTrue(ok)
            content = readme_path.read_text(encoding="utf-8")
            self.assertIn(r'alt="dev\1\ops"', content)

    def test_render_streak_integer_divider_coords(self) -> None:
        t = termcard.resolve_theme({"theme": "dashed-dark", "width": 560})
        svg = termcard.render_streak(
            {"demo_days": {"2026-11-08": 1, "2026-11-09": 2}},
            t,
            token="",
        )
        self.assertValidSvg(svg)
        self.assertIn('x1="280"', svg)
        self.assertNotIn('x1="280.0"', svg)

    def test_examples_preview_matches_generator(self) -> None:
        repo_root = Path(__file__).resolve().parent.parent
        cfg_path = repo_root / "examples" / "termcard.json"
        preview_dir = repo_root / "examples" / "preview"
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            termcard.build_cards(cfg_path, out_dir, skip_streak=True, clean=False)
            for name in ("typing.svg", "info.svg", "contact-email.svg"):
                self.assertEqual(
                    (preview_dir / name).read_text(encoding="utf-8"),
                    (out_dir / name).read_text(encoding="utf-8"),
                )

    def test_info_and_link_truncate_long_text(self) -> None:
        t = termcard.resolve_theme({"theme": "dashed-dark", "width": 360})
        long_val = "x" * 90
        info_svg = termcard.render_info({"sections": [[["Very Long Key Label Name", long_val]]]}, t)
        self.assertValidSvg(info_svg)
        self.assertIn("...", info_svg)
        self.assertNotIn(long_val, info_svg)

        link_svg = termcard.render_link({"label": "Website", "value": "https://example.com/" + "a" * 60}, t)
        self.assertValidSvg(link_svg)
        self.assertIn("...", link_svg)

    def test_render_typing_has_clip_path(self) -> None:
        t = termcard.resolve_theme({"theme": "solid-dark", "width": 360, "radius": 8})
        svg = termcard.render_typing({"words": ["a" * 80]}, t)
        self.assertValidSvg(svg)
        self.assertIn('<clipPath id="tc-clip-360-8">', svg)
        self.assertIn('clip-path="url(#tc-clip-360-8)"', svg)

    def test_streak_float_timezone_smart_year_and_invalid_user(self) -> None:
        self.assertEqual(termcard.parse_tz_offset(5.5), 5.5)
        self.assertEqual(termcard.parse_tz_offset("bad"), 0.0)
        self.assertEqual(termcard.parse_tz_offset(float("nan")), 0.0)
        self.assertEqual(termcard.parse_tz_offset(99), 14.0)

        self.assertEqual(
            termcard.format_range(dt.date(2026, 11, 5), dt.date(2026, 11, 6), ref_year=2026),
            "Nov 05 - Nov 06",
        )
        self.assertEqual(
            termcard.format_range(dt.date(2025, 11, 1), dt.date(2025, 11, 15), ref_year=2026),
            "Nov 01 - Nov 15, 2025",
        )
        self.assertEqual(
            termcard.format_range(dt.date(2025, 11, 1), dt.date(2025, 11, 1), ref_year=2026),
            "Nov 01, 2025",
        )
        self.assertEqual(
            termcard.format_range(dt.date(2025, 12, 28), dt.date(2026, 1, 3), ref_year=2026),
            "Dec 28 '25 - Jan 03 '26",
        )

        t = termcard.resolve_theme({"theme": "dashed-dark"})
        empty_svg = termcard.render_streak({"timezone_offset": 5.5, "demo_days": {}}, t, token="")
        self.assertValidSvg(empty_svg)
        self.assertIn(">0<", empty_svg)
        self.assertIn(">-<", empty_svg)

        fake_resp = mock.MagicMock()
        fake_resp.read.return_value = json.dumps({"data": {"user": None}}).encode("utf-8")
        fake_resp.__enter__.return_value = fake_resp
        with mock.patch("urllib.request.urlopen", return_value=fake_resp):
            with self.assertRaisesRegex(ValueError, "not found"):
                termcard.fetch_contribution_days("ghost-user-xyz", "tok", 2026)

        err_401 = urllib.error.HTTPError("https://api.github.com/graphql", 401, "Unauthorized", {}, io.BytesIO(b""))
        with mock.patch("urllib.request.urlopen", side_effect=err_401):
            with self.assertRaisesRegex(RuntimeError, "401 Unauthorized"):
                termcard.fetch_contribution_days("octocat", "bad-tok", 2026)

    def test_dual_theme_picture_readme_and_single_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg_path = root / "termcard.json"
            readme_path = root / "README.md"
            out_dir = root / "assets"
            cfg_path.write_text(
                json.dumps(
                    {
                        "theme": {"dark": "dashed-dark", "light": "dashed-light"},
                        "style": {"dark": {"stroke": "#ff0000"}, "light": {"stroke": "#0000ff"}},
                        "cards": [
                            {"type": "typing", "output": "typing.svg", "words": ["hi"]},
                            {"type": "streak", "output": "streak.svg", "user": "octocat"},
                            {"type": "link", "output": "web.svg", "label": "Web", "value": "example.com", "url": "https://example.com"},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            readme_path.write_text("<!-- TERMCARD:START -->\n<!-- TERMCARD:END -->\n", encoding="utf-8")

            with mock.patch("termcard.fetch_contribution_days", return_value={"2026-11-20": 3}) as fetch_mock:
                written = termcard.build_cards(cfg_path, out_dir, token="tok", readme_path=readme_path)

            self.assertEqual(fetch_mock.call_count, 1)
            self.assertEqual(len(written), 6)
            for p in written:
                self.assertValidSvg(p.read_text(encoding="utf-8"))
            self.assertIn('stroke="#ff0000"', (out_dir / "typing-dark.svg").read_text(encoding="utf-8"))
            self.assertIn('stroke="#0000ff"', (out_dir / "typing-light.svg").read_text(encoding="utf-8"))

            readme_text = readme_path.read_text(encoding="utf-8")
            self.assertIn("<picture>", readme_text)
            self.assertIn('media="(prefers-color-scheme: dark)" srcset="assets/typing-dark.svg"', readme_text)
            self.assertIn('media="(prefers-color-scheme: light)" srcset="assets/typing-light.svg"', readme_text)
            self.assertIn('<a href="https://example.com"><picture>', readme_text)

    def test_output_path_traversal_and_nested_subfolder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "assets"
            for bad in ("../evil.svg", "/tmp/evil.svg", ".termcard-manifest.json", r"sub\bad.svg", "."):
                with self.assertRaises(ValueError):
                    termcard.resolve_output_path(out_dir, bad)

            cfg_path = root / "termcard.json"
            cfg_path.write_text(
                json.dumps({"cards": [{"type": "link", "output": "cards/mail.svg", "label": "Email", "value": "a@b.c"}]}),
                encoding="utf-8",
            )
            written = termcard.build_cards(cfg_path, out_dir)
            self.assertEqual(len(written), 1)
            self.assertTrue((out_dir / "cards" / "mail.svg").exists())

    def test_manifest_cleanup_and_no_clean(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cfg_path = root / "termcard.json"
            out_dir = root / "assets"
            out_dir.mkdir(parents=True, exist_ok=True)
            unrelated = out_dir / "custom-photo.png"
            unrelated.write_bytes(b"png")

            cfg_path.write_text(
                json.dumps(
                    {
                        "cards": [
                            {"type": "typing", "output": "typing.svg", "words": ["hi"]},
                            {"type": "info", "output": "info.svg", "rows": [["OS", "Linux"]]},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            termcard.build_cards(cfg_path, out_dir, clean=True)
            self.assertTrue((out_dir / "typing.svg").exists())
            self.assertTrue((out_dir / "info.svg").exists())
            self.assertTrue((out_dir / termcard.MANIFEST_NAME).exists())

            cfg_path.write_text(
                json.dumps({"cards": [{"type": "typing", "output": "typing.svg", "words": ["hi"]}]}),
                encoding="utf-8",
            )
            termcard.build_cards(cfg_path, out_dir, clean=True)
            self.assertTrue((out_dir / "typing.svg").exists())
            self.assertFalse((out_dir / "info.svg").exists())
            self.assertTrue(unrelated.exists())

            cfg_path.write_text(
                json.dumps({"cards": [{"type": "link", "output": "link.svg", "label": "X", "value": "Y"}]}),
                encoding="utf-8",
            )
            termcard.build_cards(cfg_path, out_dir, clean=False)
            self.assertTrue((out_dir / "typing.svg").exists())
            self.assertTrue((out_dir / "link.svg").exists())

            streak_file = out_dir / "streak.svg"
            streak_file.write_text("<svg/>", encoding="utf-8")
            manifest_before = (out_dir / termcard.MANIFEST_NAME).read_text(encoding="utf-8")
            cfg_path.write_text(
                json.dumps(
                    {
                        "cards": [
                            {"type": "typing", "output": "typing.svg", "words": ["hi"]},
                            {"type": "streak", "output": "streak.svg", "user": "octocat"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            termcard.build_cards(cfg_path, out_dir, skip_streak=True, clean=True)
            self.assertTrue(streak_file.exists())
            self.assertEqual((out_dir / termcard.MANIFEST_NAME).read_text(encoding="utf-8"), manifest_before)


if __name__ == "__main__":
    unittest.main()

