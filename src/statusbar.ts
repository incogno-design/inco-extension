import * as vscode from "vscode";
import * as cp from "child_process";
import { getIncoExecutablePath } from "./util";

let statusBarItem: vscode.StatusBarItem;
let fmtStatusItem: vscode.StatusBarItem;
let foldStatusItem: vscode.StatusBarItem;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether directives are currently folded (toggled by the button). */
let directivesFolded = false;

/**
 * Activates the Inco coverage status bar item.
 * Shows the inco/(if+inco) percentage from `inco audit`.
 */
export function activateStatusBar(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "inco.audit";
  statusBarItem.tooltip = "inco contract coverage — click to run audit";
  context.subscriptions.push(statusBarItem);

  // Fmt button
  fmtStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    48
  );
  fmtStatusItem.text = "$(symbol-ruler) inco Fmt";
  fmtStatusItem.command = "inco.fmt";
  fmtStatusItem.tooltip = "Run inco fmt ./...";
  context.subscriptions.push(fmtStatusItem);
  fmtStatusItem.show();

  // Fold button — next to Fmt
  foldStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    47
  );
  foldStatusItem.command = "inco.toggleFoldDirectives";
  context.subscriptions.push(foldStatusItem);
  updateFoldStatus();
  foldStatusItem.show();

  // Initial refresh
  refreshCoverage();

  // Refresh after saving .inco.go files
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith(".inco.go") || doc.fileName.endsWith(".inco")) {
        scheduleRefresh();
      }
    })
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("inco")) {
        // reserved for future config listeners
      }
    })
  );
}

function updateFoldStatus() {
  if (directivesFolded) {
    foldStatusItem.text = "$(eye-closed) inco Fold";
    foldStatusItem.tooltip = "Directives hidden — click to show";
    foldStatusItem.color = new vscode.ThemeColor("terminal.ansiBrightBlack");
  } else {
    foldStatusItem.text = "$(eye) inco Fold";
    foldStatusItem.tooltip = "Directives visible — click to hide";
    foldStatusItem.color = undefined;
  }
}

/**
 * Notify the status bar that fold state changed (called from folding.ts
 * after the toggle command executes).
 */
export function notifyFoldToggled(folded: boolean) {
  directivesFolded = folded;
  updateFoldStatus();
}

function scheduleRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    refreshCoverage();
  }, 2000);
}

function refreshCoverage() {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    return;
  }

  const config = vscode.workspace.getConfiguration("inco");
  const bin = getIncoExecutablePath();

  const proc = cp.spawn(bin, ["audit", "."], { cwd });
  let stdout = "";

  proc.stdout?.on("data", (data: Buffer) => {
    stdout += data.toString();
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      statusBarItem.text = "$(shield) inco: —";
      statusBarItem.show();
      return;
    }

    // Parse "inco/(if+inco):     51.4%"
    const match = stdout.match(/inco\/\(if\+inco\):\s+([\d.]+)%/);
    if (match) {
      const pct = parseFloat(match[1]);
      statusBarItem.text = `$(shield) inco: ${pct.toFixed(1)}%`;
      statusBarItem.show();
    } else {
      statusBarItem.text = "$(shield) inco: —";
      statusBarItem.show();
    }
  });

  proc.on("error", () => {
    statusBarItem.text = "$(shield) inco: —";
    statusBarItem.show();
  });
}
