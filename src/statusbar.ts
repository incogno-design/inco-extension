import * as vscode from "vscode";
import * as cp from "child_process";
import { getIncoExecutablePath } from "./util";

let statusBarItem: vscode.StatusBarItem;
let highlightStatusItem: vscode.StatusBarItem;
let fmtStatusItem: vscode.StatusBarItem;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

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

  highlightStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    49
  );
  highlightStatusItem.command = "inco.toggleHighlight";
  context.subscriptions.push(highlightStatusItem);

  // Fmt button — next to HL
  fmtStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    48
  );
  fmtStatusItem.text = "$(symbol-ruler) inco Fmt";
  fmtStatusItem.command = "inco.fmt";
  fmtStatusItem.tooltip = "Run inco fmt ./...";
  context.subscriptions.push(fmtStatusItem);
  fmtStatusItem.show();

  // Initial refresh
  refreshCoverage();
  updateHighlightStatus();

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
      if (e.affectsConfiguration("inco.highlight.enabled")) {
        updateHighlightStatus();
      }
    })
  );
}

function updateHighlightStatus() {
  const enabled = vscode.workspace
    .getConfiguration("inco")
    .get<boolean>("highlight.enabled", true);

  if (enabled) {
    highlightStatusItem.text = "$(eye) inco HL";
    highlightStatusItem.tooltip = "inco Highlighting: ON (click to disable)";
    highlightStatusItem.color = undefined; // Default color
  } else {
    highlightStatusItem.text = "$(eye-closed) inco HL";
    highlightStatusItem.tooltip = "inco Highlighting: OFF (click to enable)";
    highlightStatusItem.color = new vscode.ThemeColor("terminal.ansiBrightBlack"); // Dimmed
  }
  highlightStatusItem.show();
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
