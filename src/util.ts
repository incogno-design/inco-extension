import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const isWindows = process.platform === "win32";

/**
 * Returns the name candidates for an executable, appending `.exe` on Windows.
 */
function executableCandidates(base: string): string[] {
  if (isWindows) {
    return [base + ".exe", base + ".cmd", base];
  }
  return [base];
}

/**
 * Check if any executable candidate exists at the given directory + name.
 */
function findExecutable(dir: string, name: string): string | undefined {
  for (const candidate of executableCandidates(path.join(dir, name))) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function getIncoExecutablePath(): string {
  const config = vscode.workspace.getConfiguration("inco");
  const bin = config.get<string>("executablePath") || "inco";

  if (bin !== "inco") {
    return bin;
  }

  // If the user hasn't changed the default setting, check if ~/go/bin/inco exists
  // and prioritize it if the command "inco" is not found in PATH or just as a fallback.
  // We'll prioritize `~/go/bin/inco` if it exists, as it's the standard Go install location
  // and often missed in PATH.

  const home = os.homedir();
  const found = findExecutable(path.join(home, "go", "bin"), "inco");
  if (found) {
    return found;
  }

  // check GOPATH if set
  if (process.env.GOPATH) {
    const gopathFound = findExecutable(path.join(process.env.GOPATH, "bin"), "inco");
    if (gopathFound) {
      return gopathFound;
    }
  }

  return "inco";
}

/**
 * Returns a copy of process.env with go/inco bin dirs on PATH.
 * Cross-platform: uses correct PATH separator and home directory.
 */
export function augmentedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = os.homedir();
  const goPath = env.GOPATH || path.join(home, "go");
  const goBin = path.join(goPath, "bin");
  const sep = path.delimiter; // ":" on Unix, ";" on Windows

  const pathKey = isWindows
    ? Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "Path"
    : "PATH";
  const currentPath =
    env[pathKey] || (isWindows ? "" : "/usr/bin:/bin:/usr/sbin:/sbin");

  if (!currentPath.includes(goBin)) {
    const extraDirs = isWindows
      ? [goBin]
      : [goBin, "/usr/local/go/bin"];
    env[pathKey] = extraDirs.join(sep) + sep + currentPath;
  }
  return env;
}
