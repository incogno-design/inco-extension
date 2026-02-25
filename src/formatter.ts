import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as os from "os";
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
 * Pipes `text` through a command via stdin → stdout and returns the output.
 * If the command exits non-zero or errors, resolves with `null`.
 */
function pipeThrough(
  cmd: string,
  args: string[],
  text: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = cp.spawn(cmd, args, {
      shell: true,
      env: augmentedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && stdout.length > 0) {
        resolve(stdout);
      } else {
        if (stderr) {
          log(`[inco fmt] ${cmd} ${args.join(" ")} failed (code ${code}): ${stderr.trim()}`);
        }
        resolve(null);
      }
    });

    proc.on("error", (err) => {
      log(`[inco fmt] ${cmd} spawn error: ${err.message}`);
      resolve(null);
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * Formats text by trying `inco fmt` first (stdin → stdout),
 * falling back to `gofmt` if inco fmt fails.
 *
 * Both `inco fmt` and `gofmt` support reading from stdin when
 * no file arguments are given.
 */
async function formatText(text: string): Promise<string> {
  // 1) Try inco fmt (stdin/stdout, no file arg = read stdin)
  const bin = getIncoExecutablePath();
  const incoResult = await pipeThrough(bin, ["fmt"], text);
  if (incoResult !== null) {
    log("[inco fmt] formatted via inco fmt");
    return incoResult;
  }

  // 2) Fallback: gofmt (always reads stdin when no file arg)
  log("[inco fmt] inco fmt failed, falling back to gofmt");
  const gofmtResult = await pipeThrough("gofmt", [], text);
  if (gofmtResult !== null) {
    log("[inco fmt] formatted via gofmt fallback");
    return gofmtResult;
  }

  log("[inco fmt] gofmt also failed, returning original text");
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
    const formatted = await formatText(document.getText());
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
      console.log(msg);
      channel.appendLine(msg);
    };
  }

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

      log(`[inco fmt] onWillSave: ${e.document.fileName}`);

      e.waitUntil(
        formatText(e.document.getText()).then((formatted) =>
          fullDocumentEdit(e.document, formatted)
        )
      );
    })
  );

  log("[inco] formatter registered for *.inco.go files");
}
