import * as vscode from "vscode";
import * as path from "path";
import { runIncoCommandCapture, findGoModDir } from "./commands";

/**
 * WebviewViewProvider that shows `inco audit` output in a sidebar panel.
 * Registered under the "inco" view container so it appears in the
 * primary sidebar by default (user can drag to secondary sidebar).
 */
export class IncoAuditPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "inco.auditPanel";

  private _view?: vscode.WebviewView;
  private _lastOutput = "";
  private _loading = false;
  private _lastRun?: Date;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    // Handle messages from the webview (file navigation)
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "openFile") {
        this._openFile(msg.file, msg.line);
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    this._render();
  }

  /**
   * Runs `inco audit`, updates the panel content, and reveals the view.
   */
  async refresh(): Promise<void> {
    this._loading = true;
    this._render();

    try {
      this._lastOutput = await runIncoCommandCapture(["audit"]);
      this._lastRun = new Date();
    } catch (e) {
      this._lastOutput = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    this._loading = false;
    this._render();

    // Reveal the panel (opens sidebar & focuses the view)
    vscode.commands.executeCommand("inco.auditPanel.focus");
  }

  // ── HTML rendering ──────────────────────────────────────────

  private _render(): void {
    if (!this._view) {
      return;
    }
    this._view.webview.html = this._buildHtml();
  }

  private _buildHtml(): string {
    if (this._loading) {
      return this._page(`<p class="muted">Running inco audit…</p>`);
    }

    if (!this._lastOutput) {
      return this._page(
        `<p class="muted">Click <b>$(refresh)</b> above to run audit.</p>`
      );
    }

    const ts = this._lastRun
      ? `<p class="timestamp">Last run: ${this._lastRun.toLocaleTimeString()}</p>`
      : "";

    const escaped = this._escapeHtml(this._lastOutput);
    const formatted = this._formatContent(escaped);

    return this._page(`${ts}${formatted}`);
  }

  private _page(body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body {
    padding: 8px 12px;
    margin: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    color: var(--vscode-foreground);
    background: transparent;
    line-height: 1.6;
  }
  pre {
    margin: 4px 0 12px;
    white-space: pre;
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 16px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: inherit;
  }
  th, td {
    text-align: left;
    padding: 2px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  th {
    color: var(--vscode-terminal-ansiCyan);
    font-weight: bold;
    border-bottom: 2px solid var(--vscode-panel-border);
  }
  /* Remove border for middle rows, only keep for header/bottom */
  td {
     border-bottom: none;
     white-space: nowrap;
  }
  tr:last-child td {
     border-bottom: 1px solid var(--vscode-panel-border);
  }
  /* Right align numeric columns in file table (cols 2-5) */
  .file-table td:not(:first-child), .file-table th:not(:first-child) {
    text-align: right;
  }
  .muted {
    color: var(--vscode-descriptionForeground);
    margin: 0;
  }
  .timestamp {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin: 0 0 4px;
  }
  .coverage {
    font-weight: bold;
    color: var(--vscode-terminal-ansiGreen);
  }
  .heading {
    color: var(--vscode-terminal-ansiCyan);
    font-weight: bold;
  }
  .filelink {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;
  }
  .filelink:hover {
    text-decoration: underline;
    color: var(--vscode-textLink-activeForeground);
  }
  .funcname {
    color: var(--vscode-terminal-ansiYellow);
  }
</style></head>
<body>${body}
<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-file]');
    if (link) {
      e.preventDefault();
      vscode.postMessage({
        type: 'openFile',
        file: link.getAttribute('data-file'),
        line: parseInt(link.getAttribute('data-line') || '0', 10)
      });
    }
  });
</script>
</body></html>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private _formatContent(text: string): string {
    const lines = text.split("\n");
    let html = "";
    let buffer = "";
    let parsingTable: "file" | "func" | null = null;
    let tableRows: string[] = [];

    const flushBuffer = () => {
      if (buffer) {
        html += `<pre>${this._highlightText(buffer)}</pre>`;
        buffer = "";
      }
    };

    const flushTable = () => {
      if (!parsingTable) return;

      if (parsingTable === "file") {
        html += `<table class="file-table"><thead>
          <tr><th>File</th><th>@inco:</th><th>if</th><th>funcs</th><th>guarded</th></tr>
        </thead><tbody>`;
        for (const row of tableRows) {
          if (!row.trim()) continue;
          const parts = row.trim().split(/\s+/);
          if (parts.length >= 5) {
            const guarded = parts.pop();
            const funcs = parts.pop();
            const ifCount = parts.pop();
            const incoCount = parts.pop();
            const file = parts.join(" ");
            const link = `<a class="filelink" data-file="${file}" data-line="1">${file}</a>`;
            html += `<tr><td>${link}</td><td>${incoCount}</td><td>${ifCount}</td><td>${funcs}</td><td>${guarded}</td></tr>`;
          }
        }
        html += `</tbody></table>`;
      } else if (parsingTable === "func") {
        html += `<table class="func-table"><thead><tr><th>Location</th><th>Function</th></tr></thead><tbody>`;
        for (const row of tableRows) {
          if (!row.trim()) continue;
          // "  path/to/file:123  funcName"
          // Split by 2+ spaces to separate loc from func name
          const parts = row.trim().split(/\s{2,}/);
          if (parts.length >= 2) {
            const loc = parts[0];
            const func = parts.slice(1).join("  ");
            const colon = loc.lastIndexOf(":");
            let link = loc;
            if (colon !== -1) {
              const file = loc.substring(0, colon);
              const line = loc.substring(colon + 1);
              link = `<a class="filelink" data-file="${file}" data-line="${line}">${loc}</a>`;
            }
            html += `<tr><td>${link}</td><td class="funcname">${func}</td></tr>`;
          } else {
             html += `<tr><td colspan="2">${row}</td></tr>`;
          }
        }
        html += `</tbody></table>`;
      }
      tableRows = [];
      parsingTable = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect start of File Table
      if (line.match(/^Per-file breakdown:/)) {
        flushBuffer();
        if (parsingTable) flushTable();
        
        parsingTable = "file";
        html += `<div class="heading">Per-file breakdown:</div>`;
        // Skip header and separator lines
        i += 2; 
        continue;
      }

      // Detect start of Func Table
      if (line.match(/^Functions (without|with|guarded) @?inco:/)) {
        flushBuffer();
        if (parsingTable) flushTable();

        parsingTable = "func";
        html += `<div class="heading" style="margin-top:16px">${trimmed}</div>`;
        continue;
      }

      // If inside table, collect rows until empty line or new header
      if (parsingTable) {
        if (!trimmed || line.match(/^(Directive|Per-file|Functions)/)) {
          flushTable();
          // Reprocess this line if it's not empty
          if (trimmed) {
            i--; 
          }
        } else {
          tableRows.push(line);
        }
      } else {
        buffer += line + "\n";
      }
    }

    flushBuffer();
    flushTable();

    return html;
  }

  private _highlightText(escaped: string): string {
    let result = escaped;
    // Highlight coverage summary
    result = result.replace(
      /(inco\/\(if\+inco\):\s+[\d.]+%)/g,
      '<span class="coverage">$1</span>'
    );
     // Highlight headings
    result = result.replace(
      /^(=+.*=+)$/gm,
      '<span class="heading">$1</span>'
    );
    return result;
  }

  /**
   * Opens a file at a specific line in the editor.
   * Resolves relative paths against the go.mod directory (where inco audit runs).
   */
  private async _openFile(file: string, line: number): Promise<void> {
    const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsDir) {
      return;
    }

    // inco audit runs from the go.mod directory, so paths are relative to it
    const goModDir = findGoModDir(wsDir) || wsDir;
    const absPath = path.isAbsolute(file)
      ? file
      : path.join(goModDir, file);

    try {
      const uri = vscode.Uri.file(absPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const lineNum = Math.max(0, line - 1); // 0-based
      const range = new vscode.Range(lineNum, 0, lineNum, 0);
      await vscode.window.showTextDocument(doc, {
        selection: range,
        preserveFocus: false,
      });
    } catch (e) {
      vscode.window.showWarningMessage(`Cannot open file: ${file}`);
    }
  }
}
