# pi-extensions

Collection of pi extensions.

## Structure

- `extensions/` contains TypeScript or JavaScript extension entrypoints.
  - Single-file extension: `extensions/my-extension.ts`
  - Multi-file extension: `extensions/my-extension/index.ts`

This layout matches pi package conventions, and the `package.json` `pi.extensions`
entry points at the `extensions/` directory.

## Extensions

### starship-prompt

Shows your Starship prompt in the pi UI (strips zsh `%{...%}` prompt markers). Inline mode uses a custom editor and may conflict with other editor extensions.

- Env:
  - `PI_STARSHIP_MODE` = `inline` (default) | `widget` | `status` | `both` | `off`
  - `PI_STARSHIP_PLACEMENT` = `above` (default) | `below` (widget only)
  - `PI_STARSHIP_INLINE_BORDER` = `none` (default) | `full` (draws rail + top/bottom borders)
  - `PI_STARSHIP_FOOTER` = `compact` (default) | `default` | `off`
    - `compact` hides cwd/branch, keeps context usage + model
    - `default` restores built-in footer
    - `off` hides footer entirely

Inline mode uses last Starship line inline and renders preceding lines as a widget (line breaks preserved).
  - `PI_STARSHIP_CONFIG` = path to Starship config (optional)
- Command: `/starship-refresh`

## Usage

### Run a single extension (quick test)

```bash
pi -e ./extensions/starship-prompt/index.ts
```

### Auto-discover (copy or symlink)

```bash
# Global
ln -s "$(pwd)/extensions/my-extension.ts" ~/.pi/agent/extensions/

# Project-local
mkdir -p .pi/extensions
ln -s "$(pwd)/extensions/my-extension.ts" .pi/extensions/
```

### Install as a pi package

```bash
pi install "$(pwd)"
```
