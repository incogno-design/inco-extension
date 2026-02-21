import * as vscode from "vscode";
import * as cp from "child_process";

let statusBarItem: vscode.StatusBarItem;
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
  statusBarItem.tooltip = "Inco contract coverage — click to run audit";
  context.subscriptions.push(statusBarItem);

  // Initial refresh
  refreshCoverage();

  // Refresh after saving .inco.go files
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith(".inco.go")) {
        scheduleRefresh();
      }
    })
  );
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
  const bin = config.get<string>("executablePath") || "inco";

  const proc = cp.spawn(bin, ["audit", "."], { cwd, shell: true });
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
