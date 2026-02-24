# Inco Extension for Visual Studio Code

VSCode extension for [Inco](https://github.com/imnive-design/inco-go) — a compile-time assertion engine for Go.

## Features

### Syntax Highlighting
`@inco:` directives are highlighted with distinct colors for the directive keyword, expression, and action — in both `.inco.go` and regular `.go` files.

### Diagnostics
Real-time inline diagnostics that:
- Detect missing expressions after `@inco:`
- Flag unknown actions
- Show recognized contracts as informational hints

### Hover Information
Hover over any `@inco:` directive to see:
- The assertion expression
- The action type
- A preview of the generated Go guard code

### CodeLens
Files with `@inco:` directives show:
- Contract count at the top of the file
- Quick **Gen** and **Audit** action buttons

### Commands
All Inco CLI commands are available from the Command Palette (`Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Inco: Generate Overlay` | Run `inco gen` |
| `Inco: Build` | Run `inco build ./...` |
| `Inco: Test` | Run `inco test ./...` |
| `Inco: Run` | Run `inco run .` |
| `Inco: Audit` | Run `inco audit` |
| `Inco: Release` | Run `inco release` |
| `Inco: Release Clean` | Run `inco release clean` |
| `Inco: Clean Cache` | Run `inco clean` |

### Snippets

| Prefix | Description |
|--------|-------------|
| `inco` | Basic directive (default panic) |
| `incopanic` | Directive with custom panic message |
| `incoreturn` | Directive with return action |
| `incocontinue` | Directive with continue action |
| `incobreak` | Directive with break action |
| `incolog` | Directive with log action |
| `inconil` | Nil pointer check |
| `incoerr` | Inline error assertion |
| `incopos` | Positive value assertion |
| `incobounds` | Bounds check |
| `incolen` | Non-empty string check |

### Auto-gen on Save
Optionally auto-run `inco gen` when saving `.inco.go` files. Enable via:
```json
"inco.genOnSave": true
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `inco.executablePath` | `"inco"` | Path to the `inco` binary |
| `inco.genOnSave` | `false` | Auto-run `inco gen` on save |
| `inco.diagnostics.enabled` | `true` | Enable inline diagnostics |

## Requirements

- [Inco CLI](https://github.com/imnive-design/inco-go) installed and available in your PATH
- Go workspace with `.inco.go` files

## Development

```bash
cd inco-extension
npm install
npm run compile
# Press F5 in VSCode to launch Extension Development Host
```
