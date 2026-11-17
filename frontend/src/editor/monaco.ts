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
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, options.onSave);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, options.onQuickOpen);
    return {
      focus: () => editor.focus(),
      revealLine(line: number) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      },
      dispose: () => editor.dispose(),
    };
  },

  mountDiff(element, diskText, live, options): DiffHandle {
    const original = monaco.editor.createModel(diskText, this.languageFor(options.path), uriFor(options.path, 'disk'));
    const diff = monaco.editor.createDiffEditor(element, {
      ...baseOptions,
      originalEditable: false,
      renderSideBySide: !options.narrow,
      minimap: { enabled: false },
    });
    diff.setModel({ original, modified: (live as Model).inner });
    return {
      dispose() {
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
