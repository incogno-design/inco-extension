# Inco Extension for Visual Studio Code

The official VS Code extension for [Inco](https://github.com/imnive-design/inco-go) — a powerful compile-time assertion and contract engine for Go.

Write clean, declarative contracts directly in your Go code using `@inco:` directives, and let Inco handle the enforcement, error handling, and telemetry.

## ✨ Features

### 🎨 Syntax Highlighting & Visuals
- **Distinct Highlighting**: `@inco:` directives are highlighted with custom colors to stand out from regular comments.
- **Toggle Support**: Quickly toggle highlighting on/off via the status bar button `$(eye)` or command palette.
- **Action Colors**: Different actions (panic, return, log) are visually distinct.

### 🔍 Real-time Diagnostics & Intelligence
- **Inline Validation**: Detects invalid directives, missing expressions, or unknown actions immediately.
- **Build Checks**: Automatically runs `go build -overlay` in the background to catch compile errors within your directives.
- **Gopls Integration**: Seamlessly syncs with `gopls` to provide autocompletion and hover information even for generated code.

### 📊 Status Bar Integration
- **Contract Coverage**: Displays the current contract coverage percentage (`inco/(if+inco)`) from `inco audit`.
- **Quick Controls**: 
  - Click the coverage stats to run a fresh audit.
  - Click the `$(eye) Inco HL` button to toggle syntax highlighting.

### 🛠️ Developer Productivity
- **Auto-Gen**: Automatically regenerates overlay files on save, keeping your editor in sync.
- **CodeLens**: Quick "Preview" buttons above directives to specific generated guard code.
- **Hover**: Hover over any `@inco:` directive to see the exact Go code that will be generated.
- **Preview**: Open a side-by-side diff view of your source code vs. the generated code.

## 🚀 Commands

Access these via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Title | Description |
|:---|:---|:---|
| `inco.gen` | **Inco: Generate Overlay** | Manually trigger `inco gen`. |
| `inco.preview` | **Inco: Preview Generated Guard** | Open a diff view of the generated code. |
| `inco.toggleHighlight` | **Inco: Toggle Highlight** | Toggle `@inco:` syntax highlighting on/off. |
| `inco.audit` | **Inco: Audit** | Run coverage audit and update status bar. |
| `inco.run` | **Inco: Run** | Run the project with `inco run`. |
| `inco.test` | **Inco: Test** | Run tests with `inco test`. |
| `inco.build` | **Inco: Build** | Build the project with `inco build`. |
| `inco.clean` | **Inco: Clean Cache** | Clean the internal build cache. |
| `inco.checkBuild` | **Inco: Check Build Errors** | Manually run the build check mechanism. |

## ⚙️ Configuration

| Setting | Default | Description |
|:---|:---|:---|
| `inco.executablePath` | `"inco"` | Path to the `inco` binary (if not in PATH). |
| `inco.autoGen` | `true` | Automatically run `inco gen` when saving files. |
| `inco.diagnostics.enabled` | `true` | Enable inline error diagnostics. |
| `inco.highlight.enabled` | `true` | Enable syntax highlighting for directives. |
| `inco.buildCheck` | `true` | validating directives by running a background build. |

## 📝 Usage Example

Simply add `@inco:` comments to your Go code:

```go
func process(user *User) error {
    // @inco: user != nil, -return(ErrInvalidUser)
    
    // @inco: user.Age >= 18, -log("underage access attempt"), -return(ErrUnderage)

    return nil
}
```

The extension will automatically generate the corresponding guard code in an overlay, keeping your source clean while ensuring runtime safety.

## 📦 Requirements

- **Inco CLI**: The `inco` binary must be installed.
  ```bash
  go install github.com/imnive-design/inco-go/cmd/inco@latest
  ```
- **Go**: A standard Go development environment.

## 🔧 Troubleshooting

If diagnostics aren't showing up or `gopls` seems out of sync:
1. Run **Inco: Generate Overlay** manually.
2. Check the **Output** panel (select "Inco" from the dropdown) for logs.
3. Ensure `inco` is in your PATH or configured via `inco.executablePath`.
