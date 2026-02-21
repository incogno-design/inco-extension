import * as vscode from "vscode";
import * as cp from "child_process";

/**
 * Returns the configured inco executable path.
 */
function getIncoPath(): string {
  const config = vscode.workspace.getConfiguration("inco");
  return config.get<string>("executablePath") || "inco";
}

/**
 * Returns the workspace root directory, or undefined.
 */
function getWorkspaceDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Runs an inco CLI command and streams output to the Inco output channel.
 */
function runIncoCommand(
  channel: vscode.OutputChannel,
  args: string[],
  cwd?: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const bin = getIncoPath();
    const proc = cp.spawn(bin, args, {
      cwd: cwd || getWorkspaceDir() || ".",
      shell: true,
    });

    channel.show(true);
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

export function registerCommands(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel("Inco");
  context.subscriptions.push(channel);

  const commands: Array<{ id: string; args: string[]; label: string }> = [
    { id: "inco.gen", args: ["gen"], label: "Generating overlay" },
    { id: "inco.build", args: ["build", "./..."], label: "Building" },
    { id: "inco.test", args: ["test", "./..."], label: "Testing" },
    { id: "inco.run", args: ["run", "."], label: "Running" },
    { id: "inco.audit", args: ["audit"], label: "Auditing contracts" },
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
            vscode.window.showInformationMessage(`Inco: ${cmd.label} succeeded.`);
          } else {
            vscode.window.showWarningMessage(
              `Inco: ${cmd.label} exited with code ${code}.`
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Inco: ${cmd.label} failed — ${message}`
          );
        }
      })
    );
  }
}
