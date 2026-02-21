import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { IncoDirectiveDiagnostics } from "./diagnostics";
import { IncoHoverProvider } from "./hover";
import { IncoCodeLensProvider } from "./codelens";
import { registerPreviewCommand } from "./preview";
import { IncoDecorator } from "./decorator";
import { activateStatusBar } from "./statusbar";

let genTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Inco extension activated");

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
    { language: "inco-go", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(hoverSelector, new IncoHoverProvider())
  );

  // CodeLens — shows run/audit actions above functions with directives
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(hoverSelector, new IncoCodeLensProvider())
  );

  // ── Auto-gen: on save + debounced idle ──────────────────────────
  const scheduleGen = (doc: vscode.TextDocument) => {
    if (!isIncoGoFile(doc)) {
      return;
    }
    const config = vscode.workspace.getConfiguration("inco");
    if (!config.get<boolean>("autoGen", true)) {
      return;
    }
    const delay = config.get<number>("autoGenDelay", 1000);
    if (genTimer) {
      clearTimeout(genTimer);
    }
    genTimer = setTimeout(() => {
      genTimer = undefined;
      vscode.commands.executeCommand("inco.gen");
    }, delay);
  };

  // Trigger on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      scheduleGen(doc);
    })
  );

  // Trigger on save (immediate)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!isIncoGoFile(doc)) {
        return;
      }
      const config = vscode.workspace.getConfiguration("inco");
      if (!config.get<boolean>("autoGen", true)) {
        return;
      }
      if (genTimer) {
        clearTimeout(genTimer);
        genTimer = undefined;
      }
      vscode.commands.executeCommand("inco.gen");
    })
  );

  // Trigger on stop typing (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      scheduleGen(e.document);
    })
  );
}

function isIncoGoFile(doc: vscode.TextDocument): boolean {
  return doc.fileName.endsWith(".inco.go");
}

export function deactivate() {
  if (genTimer) {
    clearTimeout(genTimer);
  }
}
