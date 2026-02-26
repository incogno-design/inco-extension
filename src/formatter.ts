import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";

/**
 * DocumentFormattingProvider for .inco.go files.
 *
 * Pipeline (mirrors `inco fmt`):
 *   1. gofmt — standard Go formatting
 *   2. FormatDirectiveSpacing — normalize blank lines around @inco:/@if:
 *   3. gofmt — re-format after spacing adjustments
 *
 * Everything runs via stdin/stdout so the editor buffer is formatted
 * in-place without touching disk.
 */
export class IncoFormattingProvider
  implements vscode.DocumentFormattingEditProvider
{
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    // Only format .inco.go files; let the Go extension handle plain .go.
    if (
      !document.fileName.endsWith(".inco.go") &&
      !document.fileName.endsWith(".inco")
    ) {
      return [];
    }

    const src = document.getText();

    return this.format(src, token).then((formatted) => {
      if (token.isCancellationRequested || formatted === src) {
        return [];
      }
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(src.length)
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    });
  }

  /**
   * Full formatting pipeline: gofmt → directive spacing → gofmt.
   * Respects CancellationToken to abort early when user cancels.
   */
  private async format(
    src: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    // 1. First gofmt pass.
    let result = await this.runGofmt(src);
    if (token.isCancellationRequested) { return src; }

    // 2. Directive spacing normalization.
    const spaced = formatDirectiveSpacing(result);

    // 3. Second gofmt only if spacing changed.
    if (spaced !== result) {
      result = await this.runGofmt(spaced);
    } else {
      result = spaced;
    }

    return token.isCancellationRequested ? src : result;
  }

  /**
   * Runs `gofmt` with stdin/stdout (no -w flag, no file mutation).
   * Falls back to the original source on error.
   */
  private runGofmt(src: string): Promise<string> {
    return new Promise((resolve) => {
      const proc = cp.spawn("gofmt", [], {
        env: augmentedEnv(),
      });

      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (code === 0 && stdout) {
          resolve(stdout);
        } else {
          // gofmt failed (syntax error, etc.) — return original.
          resolve(src);
        }
      });

      proc.on("error", () => {
        // gofmt not found — return original.
        resolve(src);
      });

      proc.stdin?.write(src);
      proc.stdin?.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Directive spacing — TypeScript port of FormatDirectiveSpacing
// ---------------------------------------------------------------------------

/**
 * Regex matching @inco: or @if: directives in comments.
 * Must be at the start of the comment body (after // and optional whitespace).
 */
const DIRECTIVE_RE = /\/\/\s*@(?:inco|if):\s+/;

/**
 * Adjusts blank lines around directive comments in a Go source string.
 *
 * Rules (matching the Go implementation in format.inco.go):
 *   1. Between consecutive directives: all blank lines are removed.
 *   2. After a directive block, before non-directive code: exactly one
 *      blank line is ensured.
 *   3. After a directive, before a closing brace '}': no blank line.
 *
 * Returns src unchanged if no directives are found.
 */
function formatDirectiveSpacing(src: string): string {
  const lines = src.split("\n");

  // Collect 1-based line numbers that contain directives.
  const directiveLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (DIRECTIVE_RE.test(lines[i])) {
      directiveLines.add(i + 1); // 1-based
    }
  }

  if (directiveLines.size === 0) {
    return src;
  }

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const lineNum = i + 1; // 1-based
    out.push(lines[i]);

    if (directiveLines.has(lineNum)) {
      // Skip blank lines after this directive.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") {
        j++;
      }

      // Determine what follows.
      const atEnd = j >= lines.length;
      const nextIsDirective = !atEnd && directiveLines.has(j + 1);
      const nextIsBrace =
        !atEnd && lines[j].trimStart().startsWith("}");

      // Insert exactly one blank line only before non-directive,
      // non-brace code.
      if (!atEnd && !nextIsDirective && !nextIsBrace) {
        out.push("");
      }

      i = j;
    } else {
      i++;
    }
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function augmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const goPath = env.GOPATH || path.join(env.HOME || "", "go");
  const goBin = path.join(goPath, "bin");
  const currentPath = env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  if (!currentPath.includes(goBin)) {
    env.PATH = `${goBin}:/usr/local/go/bin:${currentPath}`;
  }
  return env;
}
