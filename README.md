# termcard

Generate terminal-styled SVG profile cards (typing banner, info box, GitHub streak, and links) from a single JSON config via GitHub Actions.

<p align="center">
  <img src="examples/preview/typing.svg" width="520" alt="Typing card preview"><br>
  <img src="examples/preview/info.svg" width="520" alt="Info card preview"><br>
  <img src="examples/preview/streak.svg" width="520" alt="Streak card preview"><br>
  <img src="examples/preview/contact-email.svg" width="520" alt="Link card preview">
</p>

## Features
- Four card types (`typing`, `info`, `streak`, `link`), five built-in themes (`dashed-dark`, `dashed-light`, `solid-dark`, `solid-light`, `terminal-green`), and optional dual dark/light mode (`<picture>`).
- Zero external dependencies (Python 3 standard library only) with auto-injection between `<!-- TERMCARD:START -->` and `<!-- TERMCARD:END -->`.
- Static visual builder at [termcard.vercel.app](https://termcard.vercel.app/) to customize cards and create `termcard.json` + workflow YAML on GitHub in one click.

## Usage

Use the [Visual Web Builder](https://termcard.vercel.app/) or copy [`examples/termcard.json`](examples/termcard.json) into your profile repo as `termcard.json`, add `<!-- TERMCARD:START -->` and `<!-- TERMCARD:END -->` to your profile `README.md`, then add `.github/workflows/termcard.yml`:

```yaml
name: Update termcard
on:
  push: { paths: ["termcard.json"] }
  schedule: [{ cron: "0 17 * * *" }]
  workflow_dispatch:
permissions: { contents: write }
concurrency:
  group: termcard-${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bagasadh/termcard@v1
        with:
          config: termcard.json
          output_dir: assets
          readme: README.md
          token: ${{ secrets.GITHUB_TOKEN }}
```

Note: `GITHUB_TOKEN` counts public contributions only; use a Personal Access Token secret (such as `secrets.STREAK_TOKEN`) to include private repos. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [termcard.schema.json](termcard.schema.json) for all options and troubleshooting.

Run locally: `python3 termcard.py --config examples/termcard.json --out assets --skip-streak` or preview the web builder with `python3 -m http.server 3000 -d web`.
