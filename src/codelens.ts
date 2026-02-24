import * as vscode from "vscode";

const INCO_DIRECTIVE_RE = /\/\/\s*@inco:\s+/;
const IF_DIRECTIVE_RE = /\/\/\s*@if:\s+/;

export class IncoCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    let incoCount = 0;
    let ifCount = 0;

    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (INCO_DIRECTIVE_RE.test(text)) {
        incoCount++;
      }
      if (IF_DIRECTIVE_RE.test(text)) {
        ifCount++;
      }
    }

    const directiveCount = incoCount + ifCount;

    if (directiveCount > 0) {
      // Add a lens at the top of the file
      const range = new vscode.Range(0, 0, 0, 0);

      const parts: string[] = [];
      if (incoCount > 0) {
        parts.push(`${incoCount} inco`);
      }
      if (ifCount > 0) {
        parts.push(`${ifCount} if`);
      }

      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(shield) ${parts.join(" + ")} directive${directiveCount > 1 ? "s" : ""}`,
          command: "",
        })
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(play) Gen",
          command: "inco.gen",
          tooltip: "Generate inco overlay",
        })
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(checklist) Audit",
          command: "inco.audit",
          tooltip: "Run inco audit",
        })
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(open-preview) Preview",
          command: "inco.preview",
          tooltip: "Side-by-side diff: source ↔ generated guard",
        })
      );
    }

    return lenses;
  }
}
