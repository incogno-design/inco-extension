import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Overlay JSON structure produced by `inco gen`.
 */
interface IncoOverlay {
  Replace: Record<string, string>;
}

/**
 * Reads the overlay.json from .inco_cache/ in the workspace root.
 */
function loadOverlay(workspaceRoot: string): IncoOverlay | undefined {
  const overlayPath = path.join(workspaceRoot, ".inco_cache", "overlay.json");
  if (!fs.existsSync(overlayPath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(overlayPath, "utf-8");
    return JSON.parse(raw) as IncoOverlay;
  } catch {
    return undefined;
  }
}

/**
 * Given a source file path, find its shadow file path from the overlay.
 */
function findShadowPath(
  sourceAbsPath: string,
  workspaceRoot: string
): string | undefined {
  const overlay = loadOverlay(workspaceRoot);
  if (!overlay) {
    return undefined;
  }

  // overlay.Replace keys are absolute paths
  if (overlay.Replace[sourceAbsPath]) {
    return overlay.Replace[sourceAbsPath];
  }

  // Try matching by basename as fallback
  for (const [src, shadow] of Object.entries(overlay.Replace)) {
    if (path.resolve(src) === path.resolve(sourceAbsPath)) {
      return shadow;
    }
  }

  return undefined;
}

/**
 * Registers the `inco.preview` command which opens a side-by-side diff
 * between the source .inco.go file and its generated shadow file.
 */
export function registerPreviewCommand(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("inco.preview", async (uri?: vscode.Uri) => {
      // Determine the source file
      const sourceUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!sourceUri) {
        vscode.window.showWarningMessage("Inco: No file open to preview.");
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("Inco: File is not in a workspace.");
        return;
      }

      const workspaceRoot = workspaceFolder.uri.fsPath;
      const sourceAbsPath = sourceUri.fsPath;

      // Find the shadow file
      let shadowPath = findShadowPath(sourceAbsPath, workspaceRoot);

      // If no shadow found, try running inco gen first
      if (!shadowPath) {
        const runGen = await vscode.window.showInformationMessage(
          "Inco: No generated shadow file found. Run 'inco gen' first?",
          "Run Gen",
          "Cancel"
        );
        if (runGen === "Run Gen") {
          await vscode.commands.executeCommand("inco.gen");
          // Try again after gen
          shadowPath = findShadowPath(sourceAbsPath, workspaceRoot);
        }
        if (!shadowPath) {
          vscode.window.showWarningMessage(
            "Inco: No shadow file for this source. Ensure it contains @inco: directives."
          );
          return;
        }
      }

      // Verify shadow file exists
      if (!fs.existsSync(shadowPath)) {
        vscode.window.showErrorMessage(
          `Inco: Shadow file not found at ${shadowPath}. Try running 'inco gen'.`
        );
        return;
      }

      const shadowUri = vscode.Uri.file(shadowPath);
      const relPath = path.relative(workspaceRoot, sourceAbsPath);

      // Open diff view: left = source, right = shadow (generated)
      await vscode.commands.executeCommand(
        "vscode.diff",
        sourceUri,
        shadowUri,
        `${relPath}  ↔  Generated Guard`,
        { preview: true }
      );
    })
  );

  // Also register the reverse: preview from CodeLens or editor title
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "inco.previewFromEditor",
      async () => {
        await vscode.commands.executeCommand("inco.preview");
      }
    )
  );
}
