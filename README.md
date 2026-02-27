# inco — VS Code Extension

The official VS Code extension for [inco](https://github.com/incogno-design/inco) — a compile-time assertion and contract engine for Go.

Write declarative contracts in your Go code using `@inco:` directives. The extension provides real-time feedback, code generation, and tooling integration.

## Features

### Syntax Highlighting
- **Directive Highlighting**: `@inco:` and `@if:` directives are highlighted with distinct colors via TextMate grammar injection.
- **Action Colors**: Keywords (`@inco:`, `@if:`) and actions (`-panic`, `-return`, `-log`, etc.) use different colors for readability.
- **Toggle**: Quickly toggle highlighting on/off via the status bar or command palette.

### Diagnostics
- **Inline Validation**: Detects invalid directives, missing expressions, or unknown actions as you type.
- **Build Checks**: Runs `go build -overlay` in the background to catch compile errors in directive expressions.
- **gopls Integration**: Syncs overlay files with `gopls` via `-overlay` build flag for accurate editor intelligence.

### Smart Completion
- **Action Suggestions**: After typing a comma in a directive line, auto-complete suggests available actions: `-panic`, `-return`, `-log`, `-continue`, `-break`.
- **Snippet Support**: Completions include snippet placeholders for action arguments (e.g., `-return(val)`).

### Hover & Preview
- **Hover**: Hover over any `@inco:` or `@if:` directive to see the exact guard code that will be generated.
- **Preview Diff**: Open a side-by-side diff view comparing your source file with the generated overlay.

### CodeLens
- Displays the total directive count at the top of each `.inco.go` file.
- Provides inline **Gen**, **Audit**, and **Preview** quick-action buttons.

### Status Bar
Three buttons in the status bar:
- **Coverage %**: Shows contract coverage ratio from `inco audit`. Click to run audit.
- **inco HL**: Toggle directive syntax highlighting on/off.
- **Fmt**: Run `inco fmt ./...` on the workspace.

### Auto-Gen
- Automatically runs `inco gen` on save for `.inco.go` files (configurable).
- Post-gen sync with gopls is debounced (1.5s) to avoid editor thrashing.

### Snippets
- 16 built-in snippets for common `@inco:` patterns in Go files.

## Commands

Access via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Title | Description |
|:---|:---|:---|
| `inco.gen` | inco: Generate Overlay | Run `inco gen` to generate overlay files. |
| `inco.build` | inco: Build | Build the project with `inco build`. |
| `inco.test` | inco: Test | Run tests with `inco test`. |
| `inco.run` | inco: Run | Run the project with `inco run`. |
| `inco.audit` | inco: Audit (Contract Coverage) | Run audit, show results in a temporary document. |
| `inco.release` | inco: Release (Bake Guards) | Bake generated guards into source files. |
| `inco.releaseClean` | inco: Release Clean (Revert) | Revert a previous release bake. |
| `inco.clean` | inco: Clean Cache | Clean the internal build cache. |
| `inco.fmt` | inco: Format (inco fmt) | Run `inco fmt ./...` on the workspace. |
| `inco.preview` | inco: Preview Generated Guard | Open a diff view of source vs. generated code. |
| `inco.toggleHighlight` | inco: Toggle Highlight | Toggle directive syntax highlighting. |
| `inco.checkBuild` | inco: Check Build Errors (Debug) | Manually trigger a build-check for diagnostics. |

## Configuration

| Setting | Default | Description |
|:---|:---|:---|
| `inco.executablePath` | `"inco"` | Path to the `inco` binary (if not in PATH). |
| `inco.autoGen` | `true` | Automatically run `inco gen` on save in `.inco.go` files. |
| `inco.diagnostics.enabled` | `true` | Enable inline error diagnostics for directives. |
| `inco.highlight.enabled` | `true` | Enable syntax highlighting for directives. |
| `inco.buildCheck` | `true` | Run `go build -overlay` after gen to catch compile errors. |

## Usage

Add `@inco:` comments to your Go code (in `.inco.go` files):

```go
func process(user *User) error {
    // @inco: user != nil, -return(ErrInvalidUser)

    return nil
}
```

The extension automatically generates guard code in an overlay file, keeping your source clean while ensuring runtime safety.

## Requirements

- **inco CLI**: Install with:
  ```bash
  go install github.com/incogno-design/inco/cmd/inco@latest
  ```
- **Go**: A standard Go development environment.

## Troubleshooting

If diagnostics or gopls integration aren't working:
1. Run **inco: Generate Overlay** from the command palette.
2. Check the **Output** panel (select "inco" from the dropdown) for logs.
3. Ensure `inco` is in your PATH or set `inco.executablePath` in settings.
