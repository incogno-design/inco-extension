import * as vscode from "vscode";

const DIRECTIVE_RE = /\/\/\s*@inco:\s+/;

export class IncoCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    let directiveCount = 0;

    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (DIRECTIVE_RE.test(text)) {
        directiveCount++;
      }
    }

    if (directiveCount > 0) {
      // Add a lens at the top of the file
      const range = new vscode.Range(0, 0, 0, 0);

      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(shield) ${directiveCount} inco contract${directiveCount > 1 ? "s" : ""}`,
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
