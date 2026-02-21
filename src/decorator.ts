import * as vscode from "vscode";

/**
 * Lightweight decorator that highlights @inco: directives subtly.
 * Expression part stays in comment color (untouched).
 *
 *   @inco:     →  #8DA1B9  (muted blue-gray, slightly brighter than comment)
 *   -action(…) →  #C4A882  (warm muted tone)
 */
export class IncoDecorator {
  private readonly keywordType: vscode.TextEditorDecorationType;
  private readonly actionType: vscode.TextEditorDecorationType;

  // Matches `// @inco:` (the keyword part)
  private readonly keywordRe = /(\/\/\s*)(@inco:)/gm;

  // Matches the action suffix like `-panic("msg")` or `-return(0, err)` or `-continue`
  private readonly actionRe =
    /\/\/\s*@inco:.+,\s*(-(?:panic|return|continue|break)(?:\(.+\))?)\s*$/gm;

  constructor() {
    this.keywordType = vscode.window.createTextEditorDecorationType({
      color: "#5CCFE6",
      fontWeight: "bold",
    });

    this.actionType = vscode.window.createTextEditorDecorationType({
      color: "#FFA759",
    });
  }

  activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(this.keywordType, this.actionType);

    // Decorate visible editors on activation
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorate(editor);
    }

    // Re-decorate when editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.decorate(editor);
        }
      })
    );

    // Re-decorate when document content changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document) {
          this.decorate(editor);
        }
      })
    );
  }

  private decorate(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (doc.languageId !== "go" && doc.languageId !== "inco-go") {
      return;
    }

    const text = doc.getText();
    const keywordRanges: vscode.DecorationOptions[] = [];
    const actionRanges: vscode.DecorationOptions[] = [];

    // Find @inco: keywords
    this.keywordRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = this.keywordRe.exec(text)) !== null) {
      const prefixLen = m[1].length;
      const kwStart = m.index + prefixLen;
      const kwEnd = kwStart + m[2].length;
      keywordRanges.push({
        range: new vscode.Range(doc.positionAt(kwStart), doc.positionAt(kwEnd)),
      });
    }

    // Find action parts
    this.actionRe.lastIndex = 0;
    while ((m = this.actionRe.exec(text)) !== null) {
      const actionStr = m[1];
      const actionStart = m.index + m[0].indexOf(actionStr);
      const actionEnd = actionStart + actionStr.length;
      actionRanges.push({
        range: new vscode.Range(
          doc.positionAt(actionStart),
          doc.positionAt(actionEnd)
        ),
      });
    }

    editor.setDecorations(this.keywordType, keywordRanges);
    editor.setDecorations(this.actionType, actionRanges);
  }
}
