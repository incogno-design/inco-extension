import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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
  const goBinInco = path.join(home, "go", "bin", "inco");

  if (fs.existsSync(goBinInco)) {
    return goBinInco;
  }
  
  // check GOPATH if set
  if (process.env.GOPATH) {
      const gopathBinInco = path.join(process.env.GOPATH, "bin", "inco");
        if (fs.existsSync(gopathBinInco)) {
            return gopathBinInco;
        }
  }

  return "inco";
}
