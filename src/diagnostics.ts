import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import { getIncoExecutablePath } from "./util";
import { findGoModDir } from "./commands";

/**
 * LSP-compatible diagnostic returned by `inco diagnose <file>`.
 *
 * Severity levels: 1=error, 2=warning, 3=info, 4=hint
 * Codes: parse-error, parse-warning, invalid-directive, spacing, unguarded
 */
interface IncoDiagnostic {
  path: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  source: string;
  message: string;
  code: string;
}

const SEVERITY_MAP: Record<number, vscode.DiagnosticSeverity> = {
  1: vscode.DiagnosticSeverity.Error,
  2: vscode.DiagnosticSeverity.Warning,
  3: vscode.DiagnosticSeverity.Information,
  4: vscode.DiagnosticSeverity.Hint,
};

/**
 * Provides diagnostics for .inco.go files by invoking the
 * `inco diagnose <file>` CLI command and parsing its LSP-compatible
 * JSON output.
 *
 * Replaces the previous client-side regex approach with the richer
 * diagnostics from the inco engine (parse-error, invalid-directive,
 * spacing, unguarded, etc.).
 */
export class IncoDirectiveDiagnostics {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private enabled: boolean;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 300;

  constructor(private context: vscode.ExtensionContext) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("inco");
    this.enabled = vscode.workspace
      .getConfiguration("inco")
      .get<boolean>("diagnostics.enabled", true);
  }

  activate() {
    this.context.subscriptions.push(this.diagnosticCollection);

    // Diagnose already-open documents
    if (this.enabled) {
      for (const doc of vscode.workspace.textDocuments) {
        this.scheduleDiagnose(doc);
      }
    }

    // Diagnose on open
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.enabled) {
          this.scheduleDiagnose(doc);
        }
      })
    );

    // Diagnose on save (`inco diagnose` reads from disk)
    this.context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.enabled) {
          this.scheduleDiagnose(doc);
        }
      })
    );

    // Clear on close
    this.context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri);
      })
    );

    // Respond to config changes
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("inco.diagnostics.enabled")) {
          this.enabled = vscode.workspace
            .getConfiguration("inco")
            .get<boolean>("diagnostics.enabled", true);
          if (!this.enabled) {
            this.diagnosticCollection.clear();
          }
        }
      })
    );
  }

  /**
   * Debounces diagnose calls per-file to avoid thrashing the CLI
   * when rapid saves occur.
   */
  private scheduleDiagnose(doc: vscode.TextDocument) {
    if (!this.isIncoFile(doc)) {
      return;
    }

    const key = doc.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.runDiagnose(doc);
      }, IncoDirectiveDiagnostics.DEBOUNCE_MS)
    );
  }

  /**
   * Invokes `inco diagnose <relative-path>` and maps the JSON output
   * to VS Code diagnostics.
   */
  private async runDiagnose(doc: vscode.TextDocument) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!wsFolder) {
      return;
    }

    const wsDir = wsFolder.uri.fsPath;
    const goModDir = findGoModDir(wsDir) || wsDir;
    const relPath = path.relative(goModDir, doc.uri.fsPath);
    const bin = getIncoExecutablePath();

    try {
      const output = await this.execDiagnose(bin, relPath, goModDir);
      const diags = this.parseDiagnostics(output);
      this.diagnosticCollection.set(doc.uri, diags);
    } catch (err) {
      console.error(`[inco] diagnose error for ${relPath}: ${err}`);
    }
  }

  /**
   * Spawns `inco diagnose <file>` and captures stdout.
   */
  private execDiagnose(
    bin: string,
    file: string,
    cwd: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = cp.spawn(bin, ["diagnose", file], {
        cwd,
        env: this.augmentedEnv(),
      });

      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code) => {
        // `inco diagnose` writes JSON to stdout regardless of exit code.
        // Use stdout if available, otherwise stderr may contain error info.
        resolve(stdout || stderr);
      });

      proc.on("error", reject);
    });
  }

  /**
   * Parses the JSON array from `inco diagnose` into VS Code diagnostics.
   */
  private parseDiagnostics(output: string): vscode.Diagnostic[] {
    try {
      const items: IncoDiagnostic[] = JSON.parse(output);
      if (!Array.isArray(items)) {
        return [];
      }
      return items.map((item) => {
        const range = new vscode.Range(
          item.range.start.line,
          item.range.start.character,
          item.range.end.line,
          item.range.end.character
        );
        const severity =
          SEVERITY_MAP[item.severity] ??
          vscode.DiagnosticSeverity.Information;
        const diag = new vscode.Diagnostic(range, item.message, severity);
        diag.source = item.source || "inco";
        diag.code = item.code;
        return diag;
      });
    } catch {
      // Not valid JSON (e.g. command not found, empty output) — no diagnostics
      return [];
    }
  }

  private augmentedEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const goPath = env.GOPATH || path.join(env.HOME || "", "go");
    const goBin = path.join(goPath, "bin");
    const currentPath = env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
    if (!currentPath.includes(goBin)) {
      env.PATH = `${goBin}:/usr/local/go/bin:${currentPath}`;
    }
    return env;
  }

  private isIncoFile(doc: vscode.TextDocument): boolean {
    const name = doc.fileName;
    if (path.basename(name).startsWith(".inco-fmt-")) {
      return false;
    }
    return name.endsWith(".inco.go") || name.endsWith(".inco");
  }
}
