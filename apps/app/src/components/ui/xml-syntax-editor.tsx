"use client";

import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { cn } from "@/lib/utils";

interface XmlSyntaxEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

// Syntax highlighting that uses CSS variables from the app's theme system
// This automatically adapts to any theme (dark, light, dracula, nord, etc.)
const syntaxColors = HighlightStyle.define([
  // XML tags - use primary color
  { tag: t.tagName, color: "var(--primary)" },
  { tag: t.angleBracket, color: "var(--muted-foreground)" },

  // Attributes
  { tag: t.attributeName, color: "var(--chart-2, oklch(0.6 0.118 184.704))" },
  { tag: t.attributeValue, color: "var(--chart-1, oklch(0.646 0.222 41.116))" },

  // Strings and content
  { tag: t.string, color: "var(--chart-1, oklch(0.646 0.222 41.116))" },
  { tag: t.content, color: "var(--foreground)" },

  // Comments
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },

  // Special
  { tag: t.processingInstruction, color: "var(--muted-foreground)" },
  { tag: t.documentMeta, color: "var(--muted-foreground)" },
]);

// Editor theme using CSS variables
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "0.875rem",
    fontFamily: "ui-monospace, monospace",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, monospace",
  },
  ".cm-content": {
    padding: "1rem",
    minHeight: "100%",
    caretColor: "var(--primary)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "oklch(0.55 0.25 265 / 0.3)",
    },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
});

// Combine all extensions
const extensions: Extension[] = [
  xml(),
  syntaxHighlighting(syntaxColors),
  editorTheme,
];

export function XmlSyntaxEditor({
  value,
  onChange,
  placeholder,
  className,
  "data-testid": testId,
}: XmlSyntaxEditorProps) {
  return (
    <div className={cn("w-full h-full", className)} data-testid={testId}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        placeholder={placeholder}
        className="h-full [&_.cm-editor]:h-full"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: true,
          autocompletion: true,
          bracketMatching: true,
          indentOnInput: true,
        }}
      />
    </div>
  );
}
