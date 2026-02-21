import * as vscode from "vscode";
import { registerCommands, runGenSilent } from "./commands";
import { IncoDirectiveDiagnostics } from "./diagnostics";
import { IncoHoverProvider } from "./hover";
import { IncoCodeLensProvider } from "./codelens";
import { registerPreviewCommand } from "./preview";
import { IncoDecorator } from "./decorator";
import { activateStatusBar } from "./statusbar";

export function activate(context: vscode.ExtensionContext) {
  console.log("[inco] ★ Extension activated");
  vscode.window.showInformationMessage("Inco extension activated");

  // Register all inco commands (gen, build, test, run, audit, release, clean)
  registerCommands(context);

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
    { language: "go", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(hoverSelector, new IncoHoverProvider())
  );

  // CodeLens — shows run/audit actions above functions with directives
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(hoverSelector, new IncoCodeLensProvider())
  );

  // ── Auto-gen: on save only ───────────────────────────────────
  // inco gen reads from disk, so it only makes sense after save.
  // Decorator & directive diagnostics already refresh in real-time
  // from the in-memory buffer — no gen needed for that.

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
      runGenSilent().catch((e) => {
        console.error("[inco] runGenSilent unhandled error:", e);
      });
    })
  );
}

function isIncoGoFile(doc: vscode.TextDocument): boolean {
  return doc.fileName.endsWith(".inco.go");
}
