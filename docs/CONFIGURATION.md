# Configuration Reference

Add `"$schema": "https://raw.githubusercontent.com/bagasadh/termcard/main/termcard.schema.json"` to `termcard.json` for autocomplete and validation in VS Code.

## Top-level fields

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `theme` | `string \| object` | `"dashed-dark"` | Preset name (`dashed-dark`, `dashed-light`, `solid-dark`, `solid-light`, `terminal-green`) or `{ "dark": "...", "light": "..." }`. |
| `width` | `integer` | `560` | Card width in pixels, clamped to `360..680`. |
| `radius` | `integer` | `6` | Corner radius in pixels, clamped to `0..20`. |
| `font` | `string` | `JetBrains Mono, ...` | Custom CSS `font-family` stack for SVG text. |
| `style` | `object` | `{}` | Override `bg`, `bg_opacity`, `stroke`, `outline`, `outline_opacity`, `dasharray`, `outline_dasharray`, `text`, `muted`, or `link`. |
| `cards` | `array` | `[]` | Ordered list of card objects. |

### Dual dark and light mode

Set `theme` to an object to generate `-dark.svg` and `-light.svg` variants and inject `<picture>` tags into `README.md`:

```json
{
  "theme": { "dark": "dashed-dark", "light": "dashed-light" },
  "style": {
    "dark": { "stroke": "#ffffff" },
    "light": { "stroke": "#24292f" }
  }
}
```

## Card types

Every card supports `output` (relative `.svg` path inside `output_dir`, subfolders allowed), optional `width` (`360..680`), `url` (wraps the card in `<a href>` inside `README.md`), and `alt`.

### `typing`

Animated terminal prompt that loops through `words`. Long words are clipped inside the frame.

- `prompt_top` (default `"┌ <user>"`) and `prompt_bottom` (default `"└›"`)
- `words` (array of strings or comma-separated string)
- `duration` (loop duration in seconds, minimum `2`)

### `info`

Key-value table separated by optional horizontal dividers. Long label/value pairs truncate cleanly with `...` to prevent overlapping.

- `sections`: array of groups, where each row is `["Label", "Value"]` or `{"label": "...", "value": "..."}`
- `rows`: shorthand for a single-section card

### `streak`

Two-column GitHub contribution streak counter (`Current streak` and `Longest streak`).

- `user`: GitHub username (defaults to repository owner when omitted or `"your-username"` in Actions)
- `timezone_offset`: hours from UTC, supports fractional offsets like `5.5` (`-12..14`)
- `title`, `current_label`, `longest_label`, `unit` (defaults: `"Streak"`, `"Current streak"`, `"Longest streak"`, `"days"`)
- `demo_days`: optional `{"YYYY-MM-DD": count}` map for offline builds

### `link`

Single-row card with underlined link styling on the right value. Set `url` to wrap it in a clickable link inside `README.md`.

## GitHub Action inputs

| Input | Default | Description |
| :--- | :--- | :--- |
| `config` | `termcard.json` | Path to config file. |
| `output_dir` | `assets` | Directory where generated SVGs are written. |
| `readme` | `""` | Optional README path containing `TERMCARD:START` and `TERMCARD:END` markers. |
| `token` | `${{ github.token }}` | Token for GitHub GraphQL queries. Use a PAT secret (`STREAK_TOKEN`) to count private contributions. |
| `commit` | `"true"` | Commit and push changed SVGs automatically. |
| `clean` | `"true"` | Delete stale termcard SVGs tracked in `.termcard-manifest.json` when cards are removed or renamed. |
| `commit_message` | `"Update termcard SVGs"` | Git commit message. |

## Troubleshooting

- **Push fails with 403 Permission denied**: Enable **Read and write permissions** under **Settings > Actions > General > Workflow permissions** and keep `permissions: { contents: write }` in your workflow file.
- **Private repo commits missing from streak**: Default `GITHUB_TOKEN` can only read public contributions. Create a Personal Access Token (classic `read:user` scope, or fine-grained token with account read access), add it as repository secret `STREAK_TOKEN`, and pass `token: ${{ secrets.STREAK_TOKEN }}`.
- **README does not update**: Confirm both `<!-- TERMCARD:START -->` and `<!-- TERMCARD:END -->` exist in the file passed to the `readme` input.
- **`GitHub user '...' not found`**: Check the `user` field inside your `streak` card for typos.

