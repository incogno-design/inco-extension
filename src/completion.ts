import * as vscode from "vscode";

export class IncoCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const line = document.lineAt(position.line);
    const textUpToCursor = line.text.substring(0, position.character);

    // 1. Check if we are inside an inco directive
    const directiveMatch = textUpToCursor.match(/\/\/\s*@(inco|if):.+/);
    if (!directiveMatch) {
      return undefined;
    }

    // 2. We only suggest actions if we are past the expression part, usually signaled by a comma
    //    or if the user explicitly typed a dash (which might mean they skipped comma? No, syntax requires comma)
    //    We check for a comma before the cursor.
    const commaIndex = textUpToCursor.lastIndexOf(",");
    if (commaIndex === -1) {
      // No comma, so we are still in expression. But maybe user wants to add comma+action?
      // Strict behavior: only trigger if comma exists.
      return undefined;
    }

    // Check if the comma is actually part of the directive args syntax (not part of expression string)
    // Simple check: is the comma after the directive start? Yes, `directiveMatch` ensures we are in directive line.
    
    // Determine if we should suggest actions (starting with -)
    // If text after comma is just whitespace -> suggest "-panic", "-return"
    // If text after comma is whitespace + "-" -> suggest "-panic", "-return" (VS Code filters by prefix "-")
    
    const textAfterComma = textUpToCursor.substring(commaIndex + 1);
    if (!/^\s*-?$/.test(textAfterComma) && !/^\s*-\w*$/.test(textAfterComma)) {
        // If there's more text (like arguments to action), don't suggest new actions
        // unless we are still typing the action name
        return undefined;
    }

    const items: vscode.CompletionItem[] = [];

    // Helper to create items
    const createItem = (label: string, insertText: string, doc: string) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
      item.insertText = new vscode.SnippetString(insertText);
      item.documentation = new vscode.MarkdownString(doc);
      // Adjust range if user already typed "-" to avoid duplication?
      // VS Code handles this if range is not specified (defaults to current word).
      // If text is `... -`, current word is `-`. 
      // If insertText is `-panic`, VS Code replaces `-` with `-panic`. Correct.
      // If text is `... `, current word is empty. 
      // If insertText is `-panic`, VS Code appends `-panic`. Correct.
      items.push(item);
    };

    // Note: Use leading space in label/insertText?
    // If user typed `,`, we want `, -panic`.
    // If user typed `, `, we want `-panic`.
    // Let's assume user types space after comma.
    // If not, we could include space in snippet, but that might double space.
    // Let's stick to standard `-action` and let user manage spacing (or formatter fixes it).
    
    createItem("-panic", "-panic", "Panic with default message");
    createItem("-panic(msg)", "-panic(\"${1:msg}\")", "Panic with custom message");
    createItem("-return", "-return", "Return (bare)");
    createItem("-return(val)", "-return(${1:val})", "Return with value(s)");
    createItem("-log", "-log(${1:args})", "Log message (non-fatal)");
    createItem("-continue", "-continue", "Continue loop");
    createItem("-break", "-break", "Break loop");

    return items;
  }
}
