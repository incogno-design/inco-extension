import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { getIncoExecutablePath } from "./util";

/**
 * Returns the configured inco executable path.
 */
function getIncoPath(): string {
  return getIncoExecutablePath();
}

/**
 * Returns a copy of process.env with go/inco bin dirs on PATH.
 * Handles the case where PATH is undefined in the extension host.
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
 * Returns the workspace root directory, or undefined.
 */
function getWorkspaceDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Runs an inco CLI command and streams output to the Inco output channel.
 * When silent=true, the output channel won't pop up (used for auto-gen).
 */
function runIncoCommand(
  channel: vscode.OutputChannel,
  args: string[],
  options?: { cwd?: string; silent?: boolean }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const bin = getIncoPath();
    // Default cwd to the go.mod directory (inco gen must run there so
    // .inco_cache lands next to go.mod, matching `go build -overlay`).
    const cwd =
      options?.cwd ||
      findGoModDir(getWorkspaceDir() || ".") ||
      getWorkspaceDir() ||
      ".";
    const proc = cp.spawn(bin, args, {
      cwd,
      shell: true,
      env: augmentedEnv(),
    });

    if (!options?.silent) {
      channel.show(true);
    }
    channel.appendLine(`> ${bin} ${args.join(" ")}`);

    proc.stdout?.on("data", (data: Buffer) => {
      channel.append(data.toString());
    });

    proc.stderr?.on("data", (data: Buffer) => {
      channel.append(data.toString());
    });

    proc.on("close", (code) => {
      channel.appendLine(`\nProcess exited with code ${code ?? 1}`);
      resolve(code ?? 1);
    });

    proc.on("error", (err) => {
      channel.appendLine(`Error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Runs an inco CLI command and captures stdout+stderr as a string.
 * Does not write to the output channel or show any UI.
 */
export function runIncoCommandCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = getIncoPath();
    const cwd =
      findGoModDir(getWorkspaceDir() || ".") ||
      getWorkspaceDir() ||
      ".";
    const proc = cp.spawn(bin, args, {
      cwd,
      shell: true,
      env: augmentedEnv(),
    });

    let output = "";
    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", () => {
      resolve(output);
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

export function registerCommands(context: vscode.ExtensionContext): vscode.OutputChannel {
  const channel = vscode.window.createOutputChannel("Inco");
  context.subscriptions.push(channel);

  // Build-error diagnostics — we run `go build -overlay` ourselves
  // because gopls doesn't support -overlay via buildFlags.
  buildDiagnostics = vscode.languages.createDiagnosticCollection("inco-build");
  context.subscriptions.push(buildDiagnostics);

  const commands: Array<{ id: string; args: string[]; label: string }> = [
    { id: "inco.gen", args: ["gen"], label: "Generating overlay" },
    { id: "inco.build", args: ["build", "./..."], label: "Building" },
    { id: "inco.test", args: ["test", "./..."], label: "Testing" },
    { id: "inco.run", args: ["run", "."], label: "Running" },
    { id: "inco.release", args: ["release"], label: "Releasing guards" },
    {
      id: "inco.releaseClean",
      args: ["release", "clean"],
      label: "Reverting release",
    },
    { id: "inco.clean", args: ["clean"], label: "Cleaning cache" },
  ];

  for (const cmd of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd.id, async () => {
        channel.appendLine(`\n--- ${cmd.label} ---`);
        try {
          const code = await runIncoCommand(channel, cmd.args);
          if (code === 0) {
            vscode.window.showInformationMessage(`inco: ${cmd.label} succeeded.`);
            if (cmd.id === "inco.gen") {
              await postGenSync(true); // manual — immediate
            }
          } else {
            vscode.window.showWarningMessage(
              `inco: ${cmd.label} exited with code ${code}.`
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `inco: ${cmd.label} failed — ${message}`
          );
        }
      })
    );
  }

  // inco.fmt — runs silently, no output panel popup, no toast
  context.subscriptions.push(
    vscode.commands.registerCommand("inco.fmt", async () => {
      channel.appendLine(`\n--- Formatting ---`);
      try {
        await runIncoCommand(channel, ["fmt", "./..."], { silent: true });
      } catch (e) {
        log(`[inco] fmt error: ${e}`);
      }
    })
  );

  // inco.audit — handled by IncoAuditPanel (registered in extension.ts)

  // Expose a silent gen runner for auto-gen (no panel popup, no toast)
  incoChannel = channel;

  // Manual build-check command for debugging
  context.subscriptions.push(
    vscode.commands.registerCommand("inco.checkBuild", async () => {
      channel.show(true);
      channel.appendLine("\n--- Manual Build Check ---");
      log("[inco] manual checkBuild triggered");
      try {
        await checkBuildErrors();
        channel.appendLine("--- Build Check Complete ---");
      } catch (e) {
        log(`[inco] checkBuild error: ${e}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inco.toggleHighlight", async () => {
      const config = vscode.workspace.getConfiguration("inco");
      const current = config.get<boolean>("highlight.enabled", true);
      await config.update(
        "highlight.enabled",
        !current,
        vscode.ConfigurationTarget.Global
      );
    })
  );

  return channel;
}

let incoChannel: vscode.OutputChannel | undefined;
let buildDiagnostics: vscode.DiagnosticCollection | undefined;

/** Log to both console and the Inco output channel. */
function log(msg: string): void {
  console.log(msg);
  incoChannel?.appendLine(msg);
}

/**
 * Runs `inco gen` silently — output goes to the channel but
 * the panel won't pop up. Used by auto-gen on save/idle.
 *
 * Post-gen pipeline:
 *   1. syncGoplsOverlay — push `-overlay` flag into gopls settings so
 *      it uses the shadow files for completions / hover / diagnostics.
 *   2. checkBuildErrors — run `go build -overlay` ourselves and map
 *      errors back to the source. Acts as a fallback for compile errors
 *      that gopls might miss (or if gopls isn't installed).
 */
export async function runGenSilent(): Promise<void> {
  log("[inco] runGenSilent called");
  if (!incoChannel) {
    log("[inco] runGenSilent: no channel, aborting");
    return;
  }
  try {
    const code = await runIncoCommand(incoChannel, ["gen"], { silent: true });
    log(`[inco] inco gen exit code: ${code}`);
    if (code === 0) {
      await postGenSync();
    }
  } catch (e) {
    log(`[inco] runGenSilent error: ${e}`);
  }
}

/**
 * Shared post-gen pipeline used by both the manual `inco.gen` command
 * and the silent auto-gen.
 *
 * When `immediate` is true (manual command), runs synchronously.
 * When false (auto-gen on save), debounces with a 1.5s delay so that
 * rapid successive saves don't thrash gopls with config reloads.
 */
let postGenTimer: ReturnType<typeof setTimeout> | undefined;
const POST_GEN_DEBOUNCE_MS = 1500;

async function postGenSync(immediate = false): Promise<void> {
  if (immediate) {
    // Manual command — run now, cancel any pending debounce
    if (postGenTimer) {
      clearTimeout(postGenTimer);
      postGenTimer = undefined;
    }
    await doPostGenSync();
    return;
  }

  // Auto-gen — debounce so gopls isn't thrashed
  if (postGenTimer) {
    clearTimeout(postGenTimer);
  }
  postGenTimer = setTimeout(() => {
    postGenTimer = undefined;
    doPostGenSync().catch((e) => {
      log(`[inco] debounced postGenSync error: ${e}`);
    });
  }, POST_GEN_DEBOUNCE_MS);
}

async function doPostGenSync(): Promise<void> {
  // 1) gopls overlay — main provider (real-time / incremental)
  //    Wrapped in try/catch so a gopls error never blocks build-check.
  try {
    await syncGoplsOverlay();
  } catch (e) {
    log(`[inco] syncGoplsOverlay error (non-fatal): ${e}`);
  }
  // 2) go build -overlay — fallback provider (compile-error catch-all)
  await checkBuildErrors();
}

// ---------------------------------------------------------------------------
// gopls overlay sync
// ---------------------------------------------------------------------------

/**
 * Updates the gopls workspace configuration to include
 * `-overlay=<abs>/.inco_cache/overlay.json` in `build.buildFlags`.
 *
 * This tells gopls to use the shadow files for analysis, which gives
 * you completions, hover, and (sometimes) diagnostics that account for
 * the injected guard blocks.
 *
 * If the overlay file doesn't exist (e.g. after `inco clean`),
 * the flag is removed so gopls falls back to the original sources.
 */
async function syncGoplsOverlay(): Promise<void> {
  const wsDir = getWorkspaceDir();
  if (!wsDir) {
    return;
  }

  // .inco_cache lives next to go.mod, not necessarily at workspace root
  const goModDir = findGoModDir(wsDir);
  if (!goModDir) {
    return;
  }

  const overlayPath = path.join(goModDir, ".inco_cache", "overlay.json");
  const overlayExists = fs.existsSync(overlayPath);

  const gopls = vscode.workspace.getConfiguration("gopls");

  // Check if gopls configuration section is available at all.
  // In some environments (devcontainers, remote), the Go extension
  // may not be installed or may not expose this config key.
  const inspection = gopls.inspect<string[]>("build.buildFlags");
  if (!inspection) {
    log("[inco] gopls.build.buildFlags not available in this environment, skipping overlay sync");
    return;
  }

  const current: string[] = gopls.get<string[]>("build.buildFlags") || [];

  // Strip any existing -overlay flag
  const filtered = current.filter((f) => !f.startsWith("-overlay="));

  // Add the current overlay flag only if the file exists
  if (overlayExists) {
    filtered.push(`-overlay=${overlayPath}`);
  }

  // Only write if something changed
  const changed =
    filtered.length !== current.length ||
    filtered.some((f, i) => f !== current[i]);

  if (changed) {
    try {
      await gopls.update(
        "build.buildFlags",
        filtered,
        vscode.ConfigurationTarget.Workspace
      );
    } catch (e) {
      // Silently skip if the config section isn't registered
      log(`[inco] gopls.build.buildFlags update skipped: ${e}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Build-error diagnostics  (fallback — `go build -overlay`)
// ---------------------------------------------------------------------------

/**
 * After `inco gen`, runs `go build -overlay=... ./...` silently.
 * Shadow files contain `//line` directives that map errors back to the
 * original .inco.go source files. We parse the compiler output and
 * show errors as VSCode diagnostics on the original files.
 *
 * This is the fallback path — it always works regardless of whether
 * gopls is installed or whether it properly handles `-overlay`.
 */
async function checkBuildErrors(): Promise<void> {
  const config = vscode.workspace.getConfiguration("inco");
  if (!config.get<boolean>("buildCheck", true)) {
    return;
  }

  const wsDir = getWorkspaceDir();
  if (!wsDir || !buildDiagnostics) {
    return;
  }

  // `go build` must run from the directory containing go.mod,
  // and .inco_cache lives next to go.mod (same cwd as `inco gen`).
  const goModDir = findGoModDir(wsDir);
  if (!goModDir) {
    return;
  }

  const overlayPath = path.join(goModDir, ".inco_cache", "overlay.json");
  if (!fs.existsSync(overlayPath)) {
    buildDiagnostics.clear();
    return;
  }

  try {
    // Clear directive-line cache so edited files are re-scanned
    _directiveLineCache.clear();

    log(`[inco buildCheck] cwd=${goModDir} overlay=${overlayPath}`);
    const output = await runGoCheck(goModDir, overlayPath);
    log(`[inco buildCheck] output: ${output || "(empty)"}`);

    const diags = parseGoErrors(output, wsDir);
    log(`[inco buildCheck] parsed ${diags.size} file(s) with errors`);
    for (const [fp, dd] of diags) {
      log(`[inco buildCheck]   ${fp}: ${dd.length} diagnostic(s)`);
    }

    // Clear old build diagnostics
    buildDiagnostics.clear();

    // Set new diagnostics grouped by file
    for (const [filePath, fileDiags] of diags) {
      buildDiagnostics.set(vscode.Uri.file(filePath), fileDiags);
    }
    log(`[inco buildCheck] diagnostics applied`);
  } catch (e) {
    log(`[inco buildCheck] ERROR: ${e}`);
  }
}

/**
 * Finds the directory containing go.mod, starting from `dir` and also
 * checking immediate subdirectories (handles mono-repo layouts where
 * the workspace root is one level above go.mod).
 */
export function findGoModDir(dir: string): string | undefined {
  // Check dir itself
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    return dir;
  }
  // Check immediate children
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const child = path.join(dir, entry.name);
        if (fs.existsSync(path.join(child, "go.mod"))) {
          return child;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Runs `go build -overlay=<overlay> ./...` and captures combined output.
 * Uses `-gcflags=-e` to report all errors (not just first 10).
 */
function runGoCheck(cwd: string, overlayPath: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = cp.spawn(
      "go",
      ["build", `-overlay=${overlayPath}`, "-gcflags=-e", "./..."],
      { cwd, shell: true, env: augmentedEnv() }
    );

    let output = "";
    proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("close", () => resolve(output));
    proc.on("error", () => resolve(output));
  });
}

/**
 * Parses Go compiler error output and maps errors back to source .inco.go
 * files with correct line numbers.
 *
 * Two scenarios for error file paths:
 *   A) `//line` worked → path is the original .inco.go source file
 *   B) `//line` didn't work (indented in function body) → path is the
 *      shadow file inside .inco_cache/
 *
 * For (B) we reverse-lookup via overlay.json to find the source file,
 * then read the shadow file to find the nearest preceding `//line`
 * directive to recover the correct source line number.
 *
 * Returns a Map: absolute source file path → Diagnostic[]
 */
function parseGoErrors(
  output: string,
  wsDir: string
): Map<string, vscode.Diagnostic[]> {
  const result = new Map<string, vscode.Diagnostic[]>();

  // Build reverse map: shadow absolute path → source absolute path
  const goModDir = findGoModDir(wsDir);
  const reverseOverlay = buildReverseOverlay(goModDir || wsDir);

  // Go error format: file.go:line:col: message  OR  file.go:line: message
  const errorRe = /^(.+?\.go):(\d+)(?::(\d+))?: (.+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = errorRe.exec(output)) !== null) {
    const rawFile = m[1];
    const errorLine = parseInt(m[2], 10) - 1; // 0-based
    const message = m[4];

    // Skip summary / package lines
    if (message.startsWith("too many errors") || message.startsWith("#")) {
      continue;
    }

    // Resolve to absolute path
    const absFile = path.isAbsolute(rawFile)
      ? rawFile
      : path.resolve(goModDir || wsDir, rawFile);

    let sourceFile: string;
    let sourceLine: number;

    if (absFile.endsWith(".inco.go") || absFile.endsWith(".inco")) {
      // Case A: //line worked — error points at source file directly
      sourceFile = absFile;
      // Snap to nearest @inco: directive in source
      const snapped = snapToDirectiveLine(sourceFile, errorLine);
      sourceLine = snapped !== -1 ? snapped : errorLine;
    } else if (reverseOverlay.has(absFile)) {
      // Case B: error points at shadow file — reverse-lookup source
      sourceFile = reverseOverlay.get(absFile)!;
      // Find line in source by reading //line directives from shadow
      const mapped = mapShadowLineToSource(absFile, errorLine);
      if (mapped !== -1) {
        // Snap to nearest @inco: directive
        const snapped = snapToDirectiveLine(sourceFile, mapped);
        sourceLine = snapped !== -1 ? snapped : mapped;
      } else {
        sourceLine = errorLine;
      }
    } else {
      // Not an inco file — skip (gopls handles regular .go errors)
      continue;
    }

    // Only keep errors in workspace files
    if (!sourceFile.startsWith(wsDir)) {
      continue;
    }

    const diag = new vscode.Diagnostic(
      new vscode.Range(sourceLine, 0, sourceLine, Number.MAX_SAFE_INTEGER),
      message,
      vscode.DiagnosticSeverity.Error
    );
    diag.source = "inco";

    // Deduplicate
    const existing = result.get(sourceFile) || [];
    const dup = existing.some(
      (d) => d.range.start.line === sourceLine && d.message === message
    );
    if (!dup) {
      existing.push(diag);
      result.set(sourceFile, existing);
    }
  }

  return result;
}

/**
 * Builds a reverse map from overlay.json: shadow path → source path.
 */
function buildReverseOverlay(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  const overlayPath = path.join(dir, ".inco_cache", "overlay.json");
  try {
    const raw = fs.readFileSync(overlayPath, "utf-8");
    const overlay = JSON.parse(raw) as { Replace: Record<string, string> };
    for (const [source, shadow] of Object.entries(overlay.Replace)) {
      result.set(shadow, source);
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Given an error at `shadowLine` (0-based) in a shadow file, find the
 * corresponding source line by scanning backwards for the nearest
 * `//line /path/to/file.go:N` directive.
 *
 * Returns the 0-based source line, or -1 if no //line found.
 */
function mapShadowLineToSource(
  shadowPath: string,
  shadowLine: number
): number {
  try {
    const content = fs.readFileSync(shadowPath, "utf-8");
    const lines = content.split("\n");
    const lineRe = /^\s*\/\/line\s+.+:(\d+)\s*$/;

    // Scan backwards from errorLine to find nearest //line
    for (let i = shadowLine; i >= 0; i--) {
      const m = lineRe.exec(lines[i]);
      if (m) {
        // //line sets the NEXT line to that number.
        // So source line = directive_line_number + (shadowLine - i - 1)
        const declaredLine = parseInt(m[1], 10) - 1; // 0-based
        const offset = shadowLine - i - 1;
        return declaredLine + offset;
      }
    }
  } catch {
    // ignore
  }
  return -1;
}

// Cache to avoid re-reading the same file many times during one parse run.
const _directiveLineCache = new Map<string, number[]>();

/**
 * Given an error at `errorLine` (0-based) in `filePath`, find the nearest
 * `@inco:` directive at or before that line.  Returns the 0-based directive
 * line, or -1 if none found within a reasonable range.
 *
 * This corrects the line-number drift caused by Go's error-recovery
 * jumping past `//line` directives in the shadow file.
 */
function snapToDirectiveLine(filePath: string, errorLine: number): number {
  let directiveLines = _directiveLineCache.get(filePath);

  if (!directiveLines) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const re = /\/\/\s*@inco:\s+/;
      directiveLines = [];
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          directiveLines.push(i);
        }
      }
      _directiveLineCache.set(filePath, directiveLines);
    } catch {
      return -1;
    }
  }

  if (directiveLines.length === 0) {
    return -1;
  }

  // If the error is exactly on a directive line, return it directly.
  if (directiveLines.includes(errorLine)) {
    return errorLine;
  }

  // Find the nearest directive at or before errorLine.
  let nearest = -1;
  for (const dl of directiveLines) {
    if (dl <= errorLine) {
      nearest = dl;
    } else {
      break;
    }
  }

  if (nearest === -1) {
    return -1;
  }

  // Only snap if within a reasonable range.
  // Guard blocks are 3 lines, but Go's error recovery can skip much further.
  // Use a generous upper bound of 30 lines.
  if (errorLine - nearest <= 30) {
    return nearest;
  }

  return -1;
}
