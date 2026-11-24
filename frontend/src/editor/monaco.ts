// The ONLY module that imports monaco-editor: everything else talks to the EditorHost interface (EditorHost.ts).
import './monacoEnv';
import * as monaco from 'monaco-editor';
import type { DiffHandle, EditorHandle, EditorHost, EditorModel, MountOptions, ThemeDefinition } from './EditorHost';
import { languageForPath } from './language';

const THEME = 'cc-editor';

// There is no project context for the language services, so semantic checks would only report false errors.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });

let counter = 0;
// A fresh URI per model: a renamed tab keeps its model, and a new file may later reuse the old path.
const uriFor = (path: string, tag: string) => monaco.Uri.from({ scheme: 'file', path: `/${path}`, query: `${tag}${counter++}` });

class Model implements EditorModel {
  constructor(readonly inner: monaco.editor.ITextModel) {}
  getValue() { return this.inner.getValue(); }
  setValue(value: string) { this.inner.setValue(value); }
  getAlternativeVersionId() { return this.inner.getAlternativeVersionId(); }
  setLanguage(languageId: string) { monaco.editor.setModelLanguage(this.inner, languageId); }
  onDidChangeContent(listener: () => void) { return this.inner.onDidChangeContent(listener); }
  dispose() { this.inner.dispose(); }
}

const shortcut = (editor: monaco.editor.IStandaloneCodeEditor, id: string, label: string, keybinding: number, run: () => void) =>
  editor.addAction({ id, label, keybindings: [keybinding], run: () => run() });

const baseOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  scrollBeyondLastLine: false,
  fontSize: 13,
  fontFamily: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
  theme: THEME,
  renderWhitespace: 'selection',
  tabSize: 2,
};

export const monacoHost: EditorHost = {
  createModel(path, text) {
    return new Model(monaco.editor.createModel(text, this.languageFor(path), uriFor(path, 'm')));
  },

  mount(element: HTMLElement, model: EditorModel, options: MountOptions): EditorHandle {
    const editor = monaco.editor.create(element, {
      ...baseOptions,
      model: (model as Model).inner,
      readOnly: options.readOnly,
      minimap: { enabled: !options.narrow },
      wordWrap: options.narrow ? 'on' : 'off',
    });
    // addAction (unlike addCommand) returns a disposable: a command left registered after its editor is gone throws in
    // the next editor that receives the key.
    const actions = [
      shortcut(editor, 'code-editor.save', 'Save', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, options.onSave),
      shortcut(editor, 'code-editor.quickOpen', 'Quick open', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, options.onQuickOpen),
      editor.addAction({
        id: 'code-editor.comment', label: 'Comment on selection…',
        // Ctrl/Cmd+K Ctrl/Cmd+M: Monaco binds no Ctrl+K chord to M.
        keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM)],
        contextMenuGroupId: 'navigation', contextMenuOrder: 100,
        run: () => options.onComment(),
      }),
    ];
    const highlight = editor.createDecorationsCollection();
    const listeners = [
      editor.onDidChangeCursorSelection((e) => options.onSelectionChange(!e.selection.isEmpty())),
      editor.onDidChangeModelContent(() => highlight.clear()),
    ];
    return {
      focus: () => editor.focus(),
      revealRange(start: number, end: number | null) {
        const lines = editor.getModel()?.getLineCount() ?? 1;
        const first = Math.min(start, lines);
        const last = Math.min(end ?? start, lines);
        editor.revealLinesInCenter(first, last);
        editor.setPosition({ lineNumber: first, column: 1 });
        highlight.set([{ range: new monaco.Range(first, 1, last, 1), options: { isWholeLine: true, className: 'cc-ref-highlight' } }]);
        editor.focus();
      },
      getSelection() {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model || sel.isEmpty()) return null;
        const start = sel.startLineNumber;
        const endLine = sel.endColumn === 1 && sel.endLineNumber > start ? sel.endLineNumber - 1 : sel.endLineNumber;
        return { range: { start, end: endLine > start ? endLine : null }, text: model.getValueInRange(sel) };
      },
      dispose() {
        for (const a of [...actions, ...listeners]) a.dispose();
        highlight.clear();
        editor.dispose();
      },
    };
  },

  mountDiff(element, diskText, live, options): DiffHandle {
    const original = monaco.editor.createModel(diskText, this.languageFor(options.path), uriFor(options.path, 'disk'));
    const diff = monaco.editor.createDiffEditor(element, {
      ...baseOptions,
      originalEditable: false,
      // The gutter hunk menus are not needed here (the live side is edited directly), and their menu context keys outlive a disposed diff editor.
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
      renderSideBySide: !options.narrow,
      minimap: { enabled: false },
    });
    diff.setModel({ original, modified: (live as Model).inner });
    // Ctrl/Cmd+S and Ctrl/Cmd+P from the editable side work like in the plain editor.
    const modified = diff.getModifiedEditor();
    const shortcuts = [
      shortcut(modified, 'code-editor.diff.save', 'Save', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, options.onSave),
      shortcut(modified, 'code-editor.diff.quickOpen', 'Quick open', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, options.onQuickOpen),
    ];
    return {
      dispose() {
        for (const a of shortcuts) a.dispose();
        diff.dispose();
        original.dispose();
      },
    };
  },

  applyTheme(theme: ThemeDefinition) {
    monaco.editor.defineTheme(THEME, theme);
    monaco.editor.setTheme(THEME);
  },

  languageFor(path) {
    return languageForPath(path, monaco.languages.getLanguages());
  },
};
