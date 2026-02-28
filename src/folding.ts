import * as vscode from "vscode";
import { notifyFoldToggled } from "./statusbar";

/** Matches a standalone `// @inco:` or `// @if:` directive line. */
const DIRECTIVE_LINE_RE = /^\s*\/\/\s*@(inco|if):/;

/** Matches an inline directive at the end of a code line: `code // @inco: ...` */
const INLINE_DIRECTIVE_RE = /\S.*\s+(\/\/\s*@(?:inco|if):.*)$/;

/**
 * Provides folding ranges for multi-line @inco: / @if: directive blocks.
 *
 * Fold starts at the first directive line — no conflict with Go's
 * function-body folding (which starts at the `{` line above).
 */
export class IncoFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    let i = 0;

    while (i < document.lineCount) {
      if (!DIRECTIVE_LINE_RE.test(document.lineAt(i).text)) {
        i++;
        continue;
      }

      const start = i;
      i++;

      while (
        i < document.lineCount &&
        DIRECTIVE_LINE_RE.test(document.lineAt(i).text)
      ) {
        i++;
      }

      // Consume trailing blank lines
      while (i < document.lineCount && document.lineAt(i).text.trim() === "") {
        i++;
      }

      const end = i - 1;
      if (end > start) {
        ranges.push(
          new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region)
        );
      }
    }

    return ranges;
  }
}

// ── Decoration-based hiding ─────────────────────────────────────

/** Makes directive text nearly invisible — a faint ghost remains. */
const hiddenType = vscode.window.createTextEditorDecorationType({
  opacity: "0.1",
});

/**
 * Global hide state — applies to ALL files uniformly.
 * true = directives are hidden everywhere.
 */
let globalHidden = false;

/** Query whether directives are currently hidden globally. */
export function isDirectivesHidden(): boolean {
  return globalHidden;
}

/**
 * Toggle visibility of ALL @inco: / @if: directive lines globally.
 *
 * Hide = decoration (opacity 0.1) on every directive line + fold
 *        multi-line blocks so they collapse into a single `…` line.
 * Show = clear decorations + unfold.
 *
 * Applies to every visible editor immediately.
 */
export async function toggleFoldDirectives(): Promise<void> {
  globalHidden = !globalHidden;
  notifyFoldToggled(globalHidden);

  for (const editor of vscode.window.visibleTextEditors) {
    if (globalHidden) {
      await hideDirectives(editor);
    } else {
      await showDirectives(editor);
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * Collect decoration ranges for all directive text that should be hidden.
 * - Standalone directive lines → entire line range
 * - Inline directives (code // @inco:…) → entire line range (dim the whole line)
 * - Trailing blank lines after standalone blocks → entire line range
 *
 * Also returns the first line of each multi-line standalone block for folding.
 */
function collectHideTargets(doc: vscode.TextDocument): {
  decorations: vscode.DecorationOptions[];
  foldLines: number[];
} {
  const decorations: vscode.DecorationOptions[] = [];
  const foldLines: number[] = [];
  let i = 0;

  while (i < doc.lineCount) {
    const lineText = doc.lineAt(i).text;

    // ── Standalone directive block ──
    if (DIRECTIVE_LINE_RE.test(lineText)) {
      const blockStart = i;

      // Collect consecutive standalone directive lines
      while (i < doc.lineCount && DIRECTIVE_LINE_RE.test(doc.lineAt(i).text)) {
        decorations.push({ range: doc.lineAt(i).range });
        i++;
      }

      // Collect trailing blank lines
      while (i < doc.lineCount && doc.lineAt(i).text.trim() === "") {
        decorations.push({ range: doc.lineAt(i).range });
        i++;
      }

      if (i - 1 > blockStart) {
        foldLines.push(blockStart);
      }
      continue;
    }

    // ── Inline directive (code // @inco:…) → dim the entire line ──
    if (INLINE_DIRECTIVE_RE.test(lineText)) {
      decorations.push({ range: doc.lineAt(i).range });
    }

    i++;
  }

  return { decorations, foldLines };
}

async function hideDirectives(editor: vscode.TextEditor) {
  const { decorations, foldLines } = collectHideTargets(editor.document);

  editor.setDecorations(hiddenType, decorations);

  if (foldLines.length > 0) {
    await vscode.commands.executeCommand("editor.fold", {
      selectionLines: foldLines,
    });
  }
}

async function showDirectives(editor: vscode.TextEditor) {
  // Remove invisible decoration
  editor.setDecorations(hiddenType, []);

  // Unfold multi-line blocks
  const doc = editor.document;
  const foldLines: number[] = [];
  let i = 0;

  while (i < doc.lineCount) {
    if (!DIRECTIVE_LINE_RE.test(doc.lineAt(i).text)) {
      i++;
      continue;
    }

    const start = i;
    i++;
    while (i < doc.lineCount && DIRECTIVE_LINE_RE.test(doc.lineAt(i).text)) {
      i++;
    }
    while (i < doc.lineCount && doc.lineAt(i).text.trim() === "") {
      i++;
    }
    if (i - 1 > start) {
      foldLines.push(start);
    }
  }

  if (foldLines.length > 0) {
    await vscode.commands.executeCommand("editor.unfold", {
      selectionLines: foldLines,
    });
  }
}

/**
 * Re-apply hidden state when switching to a new editor.
 * Applies decoration + fold if global hide is active.
 */
export async function reapplyHiddenDecorations(editor: vscode.TextEditor) {
  if (!globalHidden) {
    return;
  }

  await hideDirectives(editor);
}

/**
 * Clear state when a document is closed (no-op now that state is global,
 * but kept for interface compatibility).
 */
export function clearFoldStateOnClose(_uri: vscode.Uri): void {
  // Global state — nothing per-document to clean up.
}
