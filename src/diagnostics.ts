import * as vscode from "vscode";

/**
 * Regex matching @inco: directive comments.
 *
 * Groups:
 *   1 — the boolean expression
 *   2 — (optional) action name: panic|return|continue|break
 *   3 — (optional) action arguments
 */

const VALID_ACTIONS = new Set(["panic", "return", "continue", "break"]);

export class IncoDirectiveDiagnostics {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private enabled: boolean;

  constructor(private context: vscode.ExtensionContext) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("inco");
    this.enabled = vscode.workspace
      .getConfiguration("inco")
      .get<boolean>("diagnostics.enabled", true);
  }

  activate() {
    this.context.subscriptions.push(this.diagnosticCollection);

    // Analyze open documents
    if (this.enabled) {
      for (const doc of vscode.workspace.textDocuments) {
        this.analyzeDocument(doc);
      }
    }

    // Analyze on open
    this.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.enabled) {
          this.analyzeDocument(doc);
        }
      })
    );

    // Analyze on change
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.enabled) {
          this.analyzeDocument(e.document);
        }
      })
    );

    // Clear on close
    this.context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri);
      })
    );

    // Respond to config changes
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("inco.diagnostics.enabled")) {
          this.enabled = vscode.workspace
            .getConfiguration("inco")
            .get<boolean>("diagnostics.enabled", true);
          if (!this.enabled) {
            this.diagnosticCollection.clear();
          }
        }
      })
    );
  }

  private analyzeDocument(document: vscode.TextDocument) {
    if (
      document.languageId !== "go" &&
      document.languageId !== "inco-go"
    ) {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      // Look for @inco: pattern
      const atIncoIndex = text.indexOf("@inco:");
      if (atIncoIndex === -1) {
        continue;
      }

      // Check it's inside a comment
      const commentStart = text.lastIndexOf("//", atIncoIndex);
      if (commentStart === -1) {
        continue;
      }

      const afterColon = text.substring(atIncoIndex + 6).trim();

      // Empty expression
      if (!afterColon) {
        diagnostics.push(
          new vscode.Diagnostic(
            new vscode.Range(i, atIncoIndex, i, text.length),
            "Inco: missing expression after @inco:",
            vscode.DiagnosticSeverity.Error
          )
        );
        continue;
      }

      // Check for invalid action
      const actionMatch = afterColon.match(
        /,\s*-([\w]+)(?:\(.*\))?\s*$/
      );
      if (actionMatch && !VALID_ACTIONS.has(actionMatch[1])) {
        const actionStart = text.indexOf(`-${actionMatch[1]}`);
        diagnostics.push(
          new vscode.Diagnostic(
            new vscode.Range(i, actionStart, i, actionStart + actionMatch[1].length + 1),
            `Inco: unknown action '-${actionMatch[1]}'. Valid actions: -panic, -return, -continue, -break`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}
