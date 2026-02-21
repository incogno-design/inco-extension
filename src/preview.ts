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
 * Virtual document provider for shadow files.
 * Uses a custom URI scheme so the Explorer doesn't reveal .inco_cache.
 */
class IncoShadowProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // The real file path is stored in the query parameter
    const realPath = uri.query;
    try {
      return fs.readFileSync(realPath, "utf-8");
    } catch {
      return "// Inco: could not read shadow file";
    }
  }
}

/**
 * Finds the directory containing go.mod, starting from `dir` and also
 * checking immediate subdirectories.
 */
function findGoModDir(dir: string): string | undefined {
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    return dir;
  }
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
 * Reads the overlay.json from .inco_cache/ next to go.mod.
 */
function loadOverlay(workspaceRoot: string): IncoOverlay | undefined {
  const goModDir = findGoModDir(workspaceRoot);
  if (!goModDir) {
    return undefined;
  }
  const overlayPath = path.join(goModDir, ".inco_cache", "overlay.json");
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
  // Register virtual document provider for shadow files
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "inco-shadow",
      new IncoShadowProvider()
    )
  );

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

      // Build a virtual URI for the shadow file so Explorer stays untouched
      const shadowVirtualUri = vscode.Uri.parse(
        `inco-shadow:${path.basename(shadowPath)}?${shadowPath}`
      );
      const relPath = path.relative(workspaceRoot, sourceAbsPath);

      // Open diff view: left = shadow (virtual, read-only), right = source (editable)
      // vscode.diff treats the right side as "modified" which is editable & saveable.
      await vscode.commands.executeCommand(
        "vscode.diff",
        shadowVirtualUri,
        sourceUri,
        `Generated Guard  ↔  ${relPath}`,
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
