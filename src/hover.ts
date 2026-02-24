import * as vscode from "vscode";

const INCO_DIRECTIVE_RE =
  /\/\/\s*@inco:\s+(.+?)(?:,\s*-(panic|return|continue|break|log)(?:\((.+)\))?)?\s*$/;

const IF_DIRECTIVE_RE =
  /\/\/\s*@if:\s+(.+?)(?:,\s*-(log)(?:\((.+)\))?)?\s*$/;

export class IncoHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const line = document.lineAt(position.line);

    // Try @inco: first
    const incoMatch = INCO_DIRECTIVE_RE.exec(line.text);
    if (incoMatch) {
      const directiveStart = line.text.indexOf("@inco:");
      if (directiveStart === -1 || position.character < directiveStart - 3) {
        return null;
      }

      const expr = incoMatch[1].trim();
      const action = incoMatch[2] || "panic";
      const actionArgs = incoMatch[3] || "";
      const isInline = line.text.trimStart().startsWith("//") ? false : true;

      const md = new vscode.MarkdownString();
      md.isTrusted = true;

      md.appendMarkdown(`### Inco Directive\n\n`);
      md.appendMarkdown(`| | |\n|---|---|\n`);
      md.appendMarkdown(`| **Assertion** | \`${expr}\` |\n`);
      md.appendMarkdown(`| **Action** | \`-${action}${actionArgs ? `(${actionArgs})` : ""}\` |\n`);
      md.appendMarkdown(`| **Type** | ${isInline ? "Inline" : "Standalone"} |\n\n`);

      md.appendMarkdown(`**Generated guard:**\n\n`);
      md.appendCodeblock(generateIncoGuardPreview(expr, action, actionArgs), "go");

      return new vscode.Hover(
        md,
        new vscode.Range(position.line, directiveStart - 3, position.line, line.text.length)
      );
    }

    // Try @if:
    const ifMatch = IF_DIRECTIVE_RE.exec(line.text);
    if (ifMatch) {
      const directiveStart = line.text.indexOf("@if:");
      if (directiveStart === -1 || position.character < directiveStart - 3) {
        return null;
      }

      const condition = ifMatch[1].trim();
      const action = ifMatch[2] || undefined;
      const actionArgs = ifMatch[3] || "";
      const isInline = line.text.trimStart().startsWith("//") ? false : true;

      const md = new vscode.MarkdownString();
      md.isTrusted = true;

      md.appendMarkdown(`### Inco @if Directive\n\n`);
      md.appendMarkdown(`| | |\n|---|---|\n`);
      md.appendMarkdown(`| **Condition** | \`${condition}\` |\n`);
      if (action) {
        md.appendMarkdown(`| **Action** | \`-${action}${actionArgs ? `(${actionArgs})` : ""}\` |\n`);
      }
      md.appendMarkdown(`| **Type** | ${isInline ? "Inline" : "Standalone"} |\n\n`);

      md.appendMarkdown(`**Generated guard:**\n\n`);
      md.appendCodeblock(generateIfGuardPreview(condition, action, actionArgs), "go");

      return new vscode.Hover(
        md,
        new vscode.Range(position.line, directiveStart - 3, position.line, line.text.length)
      );
    }

    return null;
  }
}

function generateIncoGuardPreview(
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

function generateIfGuardPreview(
  condition: string,
  action: string | undefined,
  actionArgs: string
): string {
  let body = "    // <next statement>";
  if (action === "log") {
    if (actionArgs) {
      body = `    log.Printf(${actionArgs})\n    // <next statement>`;
    } else {
      body = `    log.Printf("@if: ${condition}")\n    // <next statement>`;
    }
  }
  return `if ${condition} {\n${body}\n}`;
}
