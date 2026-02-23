import * as vscode from "vscode";

const DIRECTIVE_RE =
  /\/\/\s*@inco:\s+(.+?)(?:,\s*-(panic|return|continue|break|log)(?:\((.+)\))?)?\s*$/;

export class IncoHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const line = document.lineAt(position.line);
    const match = DIRECTIVE_RE.exec(line.text);
    if (!match) {
      return null;
    }

    // Only show hover when cursor is on or after the // @inco: part
    const directiveStart = line.text.indexOf("@inco:");
    if (directiveStart === -1 || position.character < directiveStart - 3) {
      return null;
    }

    const expr = match[1].trim();
    const action = match[2] || "panic";
    const actionArgs = match[3] || "";

    const isInline = line.text.trimStart().startsWith("//") ? false : true;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown(`### Inco Directive\n\n`);
    md.appendMarkdown(`| | |\n|---|---|\n`);
    md.appendMarkdown(`| **Assertion** | \`${expr}\` |\n`);
    md.appendMarkdown(`| **Action** | \`-${action}${actionArgs ? `(${actionArgs})` : ""}\` |\n`);
    md.appendMarkdown(`| **Type** | ${isInline ? "Inline" : "Standalone"} |\n\n`);

    md.appendMarkdown(`**Generated guard:**\n\n`);
    md.appendCodeblock(generateGuardPreview(expr, action, actionArgs), "go");

    return new vscode.Hover(
      md,
      new vscode.Range(position.line, directiveStart - 3, position.line, line.text.length)
    );
  }
}

function generateGuardPreview(
  expr: string,
  action: string,
  actionArgs: string
): string {
  const negated = `!(${expr})`;

  switch (action) {
    case "panic":
      if (actionArgs) {
        return `if ${negated} {\n    panic(${actionArgs})\n}`;
      }
      return `if ${negated} {\n    panic("inco violation: ${expr}")\n}`;

    case "return":
      if (actionArgs) {
        return `if ${negated} {\n    return ${actionArgs}\n}`;
      }
      return `if ${negated} {\n    return\n}`;

    case "continue":
      return `if ${negated} {\n    continue\n}`;

    case "break":
      return `if ${negated} {\n    break\n}`;

    case "log":
      if (actionArgs) {
        return `if ${negated} {\n    log.Printf(${actionArgs})\n}`;
      }
      return `if ${negated} {\n    log.Printf("inco violation: ${expr}")\n}`;

    default:
      return `if ${negated} {\n    panic("inco violation: ${expr}")\n}`;
  }
}
