import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { getIncoExecutablePath } from "./util";

/**
 * Returns a copy of process.env with go/inco bin dirs on PATH.
 */
function augmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const goPath = env.GOPATH || path.join(env.HOME || "", "go");
  const goBin = path.join(goPath, "bin");
  const localBin = "/usr/local/go/bin";
  const currentPath = env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin";
  if (!currentPath.includes(goBin)) {
    env.PATH = `${goBin}:${localBin}:${currentPath}`;
  }
  return env;
}

/**
 * Runs `inco fmt` on a file and returns the formatted content.
 *
 * Strategy: write the document text to a temp file, run `inco fmt <tempfile>`,
 * read the result back. This mirrors how `go fmt` works (in-place formatting)
 * while keeping the editor buffer clean.
 */
function runIncoFmt(text: string, fileName: string): Promise<string> {
  return new Promise((resolve) => {
    const bin = getIncoExecutablePath();
    const tmpDir = os.tmpdir();
    const baseName = path.basename(fileName);
    const tmpFile = path.join(tmpDir, `inco-fmt-${Date.now()}-${baseName}`);

    fs.writeFileSync(tmpFile, text, "utf-8");

    const proc = cp.spawn(bin, ["fmt", tmpFile], {
      shell: true,
      env: augmentedEnv(),
    });

    let stderr = "";

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      try {
        if (code === 0) {
          const formatted = fs.readFileSync(tmpFile, "utf-8");
          resolve(formatted);
        } else {
          // inco fmt failed — fallback to go fmt
          console.log(`[inco] inco fmt exited with code ${code}: ${stderr}`);
          resolve(runGoFmt(text, tmpFile));
        }
      } catch {
        // Clean up and fallback
        resolve(runGoFmt(text, tmpFile));
      }
    });

    proc.on("error", (err) => {
      console.log(`[inco] inco fmt error: ${err.message}`);
      // inco binary not found — fallback to go fmt
      resolve(runGoFmt(text, tmpFile));
    });
  });
}

/**
 * Fallback: runs `gofmt` on the temp file.
 * Cleans up the temp file after finishing.
 */
function runGoFmt(text: string, tmpFile: string): Promise<string> {
  return new Promise((resolve) => {
    // Re-write original text in case inco fmt partially modified the file
    try {
      fs.writeFileSync(tmpFile, text, "utf-8");
    } catch {
      resolve(text);
      return;
    }

    const proc = cp.spawn("gofmt", ["-w", tmpFile], {
      shell: true,
      env: augmentedEnv(),
    });

    proc.on("close", (code) => {
      try {
        if (code === 0) {
          const formatted = fs.readFileSync(tmpFile, "utf-8");
          resolve(formatted);
        } else {
          console.log(`[inco] gofmt fallback exited with code ${code}`);
          resolve(text);
        }
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    });

    proc.on("error", (err) => {
      console.log(`[inco] gofmt fallback error: ${err.message}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve(text);
    });
  });
}

/**
 * Full-document replace edit: replaces the entire document content.
 */
function fullDocumentEdit(
  document: vscode.TextDocument,
  newText: string
): vscode.TextEdit[] {
  if (newText === document.getText()) {
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  return [vscode.TextEdit.replace(fullRange, newText)];
}

/**
 * Document formatting provider that runs `inco fmt` on .inco.go files.
 */
export class IncoFormattingProvider
  implements vscode.DocumentFormattingEditProvider
{
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument
  ): Promise<vscode.TextEdit[]> {
    const formatted = await runIncoFmt(
      document.getText(),
      document.fileName
    );
    return fullDocumentEdit(document, formatted);
  }
}

/**
 * Registers the inco formatter for .inco.go files and a
 * willSaveTextDocument hook that runs `inco fmt` before save.
 */
export function registerFormatter(context: vscode.ExtensionContext) {
  // Document selector: only .inco.go files (language is "go" via files.associations)
  const selector: vscode.DocumentSelector = [
    { language: "go", scheme: "file", pattern: "**/*.inco.go" },
  ];

  const provider = new IncoFormattingProvider();

  // Register as the formatting provider for .inco.go files
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider)
  );

  // Format before save — applies to .inco.go files only
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (!e.document.fileName.endsWith(".inco.go")) {
        return;
      }

      const config = vscode.workspace.getConfiguration("inco");
      if (!config.get<boolean>("formatOnSave", true)) {
        return;
      }

      e.waitUntil(
        runIncoFmt(e.document.getText(), e.document.fileName).then(
          (formatted) => fullDocumentEdit(e.document, formatted)
        )
      );
    })
  );

  console.log("[inco] formatter registered for *.inco.go files");
}
