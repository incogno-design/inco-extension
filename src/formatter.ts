import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { getIncoExecutablePath } from "./util";

/** Shared output channel — set by registerFormatter. */
let log: (msg: string) => void = console.log;

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
 * Runs a formatting command on a temp file placed next to the source file
 * (so it stays inside the Go module). The command modifies the file in-place
 * (like `gofmt -w` / `inco fmt`), and we read the result back.
 */
function fmtViaFile(
  cmd: string,
  args: string[],
  text: string,
  sourceFilePath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    // Place temp file next to source so it's inside the Go module
    const dir = path.dirname(sourceFilePath);
    const tmpName = `.inco-fmt-${Date.now()}-${path.basename(sourceFilePath)}`;
    const tmpFile = path.join(dir, tmpName);

    try {
      fs.writeFileSync(tmpFile, text, "utf-8");
    } catch (e) {
      log(`[inco fmt] failed to write temp file: ${e}`);
      resolve(null);
      return;
    }

    const proc = cp.spawn(cmd, [...args, tmpFile], {
      env: augmentedEnv(),
      cwd: dir,
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const formatted = fs.readFileSync(tmpFile, "utf-8");
          resolve(formatted);
        } catch (e) {
          log(`[inco fmt] read-back error: ${e}`);
          resolve(null);
        }
      } else {
        if (stderr) {
          log(`[inco fmt] ${cmd} ${args.join(" ")} failed (code ${code}): ${stderr.trim()}`);
        }
        resolve(null);
      }
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    });

    proc.on("error", (err) => {
      log(`[inco fmt] ${cmd} spawn error: ${err.message}`);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve(null);
    });
  });
}

/**
 * Formats text by trying `inco fmt <file>` first (in-place, includes
 * gofmt + directive spacing), falling back to `gofmt -w <file>` if
 * inco fmt fails.
 *
 * Temp file is placed next to the source file (inside the Go module).
 */
async function formatText(text: string, sourceFilePath: string): Promise<string> {
  const t0 = Date.now();

  // 1) Try inco fmt <file> (in-place: gofmt -w → spacing → gofmt -w)
  const bin = getIncoExecutablePath();
  const incoResult = await fmtViaFile(bin, ["fmt"], text, sourceFilePath);
  if (incoResult !== null) {
    log(`[inco fmt] formatted via inco fmt (${Date.now() - t0}ms)`);
    return incoResult;
  }

  // 2) Fallback: gofmt -w <file> (in-place)
  log("[inco fmt] inco fmt failed, falling back to gofmt");
  const gofmtResult = await fmtViaFile("gofmt", ["-w"], text, sourceFilePath);
  if (gofmtResult !== null) {
    log(`[inco fmt] formatted via gofmt fallback (${Date.now() - t0}ms)`);
    return gofmtResult;
  }

  log(`[inco fmt] gofmt also failed, returning original text (${Date.now() - t0}ms)`);
  return text;
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
    log(`[inco fmt] provideDocumentFormattingEdits: ${document.fileName}`);
    const formatted = await formatText(document.getText(), document.fileName);
    return fullDocumentEdit(document, formatted);
  }
}

/**
 * Registers the inco formatter for .inco.go files and a
 * willSaveTextDocument hook that runs `inco fmt` before save.
 */
export function registerFormatter(
  context: vscode.ExtensionContext,
  channel?: vscode.OutputChannel
) {
  // Wire up logging to the Inco output channel if available
  if (channel) {
    log = (msg: string) => {
      const ts = new Date().toISOString().slice(11, 23);
      const line = `[${ts}] ${msg}`;
      console.log(line);
      channel.appendLine(line);
    };
  }

  // Document selector: .inco.go files use 'inco' language
  const selector: vscode.DocumentSelector = [
    { language: "inco", scheme: "file" },
  ];

  const provider = new IncoFormattingProvider();

  // Register as the formatting provider for .inco.go files
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider)
  );

  log("[inco] formatter registered for *.inco.go files");
}
