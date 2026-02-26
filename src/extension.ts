import * as vscode from "vscode";
import * as path from "path";
import { registerCommands, startWatch, stopWatch, syncGoplsOverlay, findGoModDir, runBuildCheck } from "./commands";
import { IncoDirectiveDiagnostics } from "./diagnostics";
import { IncoHoverProvider } from "./hover";
import { IncoCodeLensProvider } from "./codelens";
import { registerPreviewCommand } from "./preview";
import { IncoDecorator } from "./decorator";
import { activateStatusBar } from "./statusbar";
import { IncoCompletionProvider } from "./completion";
import { IncoAuditPanel } from "./auditPanel";
import { IncoFormattingProvider } from "./formatter";

export function activate(context: vscode.ExtensionContext) {
  console.log("[inco] ★ Extension activated");

  // Register all inco commands (gen, build, test, run, release, clean, watch)
  const channel = registerCommands(context);

  // Audit panel — shows `inco audit` output in the sidebar
  const auditPanel = new IncoAuditPanel();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IncoAuditPanel.viewType,
      auditPanel
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("inco.audit", () => auditPanel.refresh())
  );

  // Register preview diff command (source ↔ generated shadow)
  registerPreviewCommand(context);

  // Diagnostics — uses `inco diagnose` for LSP-compatible analysis
  const diagnostics = new IncoDirectiveDiagnostics(context);
  diagnostics.activate();

  // Decorator — colored highlights for @inco: and actions
  const decorator = new IncoDecorator();
  decorator.activate(context);

  // Status bar — shows inco/(if+inco) coverage percentage
  activateStatusBar(context);

  // Hover provider — shows directive info on hover
  const hoverSelector: vscode.DocumentSelector = [
    { language: "go", scheme: "file" }
  ];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(hoverSelector, new IncoHoverProvider())
  );

  // CodeLens — shows run/audit actions above functions with directives
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(hoverSelector, new IncoCodeLensProvider())
  );

  // Completion Item Provider — for directive actions (-panic, -return, etc.)
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      hoverSelector,
      new IncoCompletionProvider(),
      "-", // Trigger characters: dash
      ","  // Trigger characters: comma
    )
  );

  // Formatter — gofmt + directive spacing normalization for .inco.go files
  // Use a separate selector with pattern glob so that gopls keeps exclusive
  // ownership of plain .go files. Without this, VS Code may pick our
  // provider for regular .go files (returning [] = no format) or show a
  // "choose formatter" popup that blocks format-on-save.
  const incoFormatterSelector: vscode.DocumentSelector = [
    { language: "go", scheme: "file", pattern: "**/*.inco.go" },
  ];
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      incoFormatterSelector,
      new IncoFormattingProvider()
    )
  );

  // ── Watch process ────────────────────────────────────────────
  // Start `inco watch .` as a persistent background process.
  // It handles fsnotify events, debouncing, incremental gen,
  // and overlay/manifest writes automatically — replacing the
  // old auto-gen-on-save approach.
  {
    const config = vscode.workspace.getConfiguration("inco");
    if (config.get<boolean>("watch.enabled", true)) {
      startWatch(channel);
    }
  }

  // ── gopls config ─────────────────────────────────────────────
  // Set directoryFilters once to exclude .inco_cache from gopls.
  // We do NOT set -overlay in gopls buildFlags — that caused the
  // freeze/卡死 (gopls and inco watch fighting over shadow files).
  // gopls analyzes original .inco.go files directly.
  syncGoplsOverlay();

  // ── Overlay watcher ─────────────────────────────────────────
  // When inco watch updates overlay.json, run `go build -overlay`
  // to catch compile errors in the generated guard blocks and map
  // them back to .inco.go source files as VS Code diagnostics.
  //
  // This is the ONLY mechanism that connects shadow-file errors to
  // .inco.go red lines — gopls never sees the shadow content.
  //
  // Debounced (1s) to avoid hammering go build on rapid edits.
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsDir) {
    const goModDir = findGoModDir(wsDir);
    if (goModDir) {
      const overlayPattern = new vscode.RelativePattern(
        goModDir,
        ".inco_cache/overlay.json"
      );
      const overlayWatcher = vscode.workspace.createFileSystemWatcher(overlayPattern);

      let buildCheckTimer: ReturnType<typeof setTimeout> | undefined;
      const debouncedBuildCheck = () => {
        if (buildCheckTimer) { clearTimeout(buildCheckTimer); }
        buildCheckTimer = setTimeout(() => {
          buildCheckTimer = undefined;
          runBuildCheck();
        }, 1000);
      };

      overlayWatcher.onDidCreate(() => {
        console.log("[inco] overlay.json created — scheduling build check");
        debouncedBuildCheck();
      });
      overlayWatcher.onDidChange(() => {
        debouncedBuildCheck();
      });

      context.subscriptions.push(overlayWatcher);
      context.subscriptions.push({ dispose: () => { if (buildCheckTimer) { clearTimeout(buildCheckTimer); } } });

      // Run initial build check if overlay already exists.
      runBuildCheck();
    }
  }

  // Clean up watch process on deactivation
  context.subscriptions.push({ dispose: () => stopWatch() });
}
