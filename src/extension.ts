import * as vscode from "vscode";
import * as path from "path";
import { registerCommands, runGenSilent } from "./commands";
import { IncoDirectiveDiagnostics } from "./diagnostics";
import { IncoHoverProvider } from "./hover";
import { IncoCodeLensProvider } from "./codelens";
import { registerPreviewCommand } from "./preview";
import { IncoDecorator } from "./decorator";
import { activateStatusBar } from "./statusbar";
import { IncoCompletionProvider } from "./completion";
import { IncoAuditPanel } from "./auditPanel";

/** Debounce timer for auto-gen — prevents rapid-fire runs when
 *  multiple files are opened / saved in quick succession. */
let genDebounceTimer: ReturnType<typeof setTimeout> | undefined;
const GEN_DEBOUNCE_MS = 500;

function scheduleGen(reason: string): void {
  if (genDebounceTimer) {
    clearTimeout(genDebounceTimer);
  }
  genDebounceTimer = setTimeout(() => {
    genDebounceTimer = undefined;
    console.log(`[inco] running gen (${reason})`);
    runGenSilent().catch((e) => {
      console.error("[inco] runGenSilent unhandled error:", e);
    });
  }, GEN_DEBOUNCE_MS);
}

export function activate(context: vscode.ExtensionContext) {
  console.log("[inco] ★ Extension activated");
  vscode.window.showInformationMessage("inco extension activated");

  // Register all inco commands (gen, build, test, run, release, clean)
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

  // Diagnostics for @inco: directives (errors only)
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

  // ── Auto-gen: on activation ──────────────────────────────────
  // Run gen once at startup so the overlay is up-to-date before
  // the user does anything.
  {
    const config = vscode.workspace.getConfiguration("inco");
    if (config.get<boolean>("autoGen", true)) {
      console.log("[inco] initial gen on activation");
      scheduleGen("activation");
    }
  }

  // ── Auto-gen: on open ────────────────────────────────────────
  // When an inco file is opened (e.g. switching tabs, restoring
  // session), regenerate so diagnostics & overlay stay fresh.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (!isIncoGoFile(doc)) {
        return;
      }
      const config = vscode.workspace.getConfiguration("inco");
      if (!config.get<boolean>("autoGen", true)) {
        return;
      }
      console.log(`[inco] onDidOpen: ${doc.fileName}`);
      scheduleGen("open");
    })
  );

  // ── Auto-gen: on save ────────────────────────────────────────
  // inco gen reads from disk, so it always makes sense after save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      console.log(`[inco] onDidSave: ${doc.fileName} isIncoGo=${isIncoGoFile(doc)}`);
      if (!isIncoGoFile(doc)) {
        return;
      }
      const config = vscode.workspace.getConfiguration("inco");
      if (!config.get<boolean>("autoGen", true)) {
        console.log("[inco] autoGen disabled");
        return;
      }
      console.log("[inco] calling runGenSilent");
      scheduleGen("save");
    })
  );
}

function isIncoGoFile(doc: vscode.TextDocument): boolean {
  const name = doc.fileName;
  // Exclude formatter temp files (e.g. .inco-fmt-1234567890-foo.inco.go)
  if (path.basename(name).startsWith(".inco-fmt-")) {
    return false;
  }
  return name.endsWith(".inco.go") || name.endsWith(".inco");
}
