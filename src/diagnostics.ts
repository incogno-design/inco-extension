import * as vscode from "vscode";

/**
 * Regex matching @inco: directive action suffix.
 *
 * Uses greedy .+ for expression (matches Go's actionRe behavior:
 * backtracks to find the LAST top-level ", -action...").
 * Action args also use greedy .+ to match Go's (.+) group.
 */

const VALID_ACTIONS = new Set(["panic", "return", "continue", "break", "log"]);

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
    if (document.languageId !== "go") {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    // Matches lines where @inco: is at the START of the comment body
    // (after // and optional whitespace), mirroring Go's ^@inco:\s+(.+)$
    const directiveLineRe = /\/\/\s*(@inco:)(\s+.*)?$/;

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      const lineMatch = directiveLineRe.exec(text);
      if (!lineMatch) {
        continue;
      }

      const atIncoIndex = text.indexOf(lineMatch[1], text.indexOf("//"));
      const commentStart = text.lastIndexOf("//", atIncoIndex);

      // Check that @inco: is the first thing in the comment body
      const between = text.substring(commentStart + 2, atIncoIndex).trim();
      if (between.length > 0) {
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
            `Inco: unknown action '-${actionMatch[1]}'. Valid actions: -panic, -return, -continue, -break, -log`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}
