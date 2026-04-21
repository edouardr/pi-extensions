# pi-extensions

Collection of pi extensions.

## Structure

- `extensions/` contains TypeScript or JavaScript extension entrypoints.
  - Single-file extension: `extensions/my-extension.ts`
  - Multi-file extension: `extensions/my-extension/index.ts`

This layout matches pi package conventions, and the `package.json` `pi.extensions`
entry points at the `extensions/` directory.

## Usage

### Run a single extension (quick test)

```bash
pi -e ./extensions/my-extension.ts
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
