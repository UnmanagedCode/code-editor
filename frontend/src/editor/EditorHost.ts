import { createContext, useContext } from 'react';

/** A text buffer. Dirty = `getAlternativeVersionId()` differs from the version recorded at the last save/load. */
export interface EditorModel {
  getValue(): string;
  setValue(value: string): void;
  getAlternativeVersionId(): number;
  setLanguage(languageId: string): void;
  onDidChangeContent(listener: () => void): { dispose(): void };
  dispose(): void;
}

export interface EditorHandle {
  focus(): void;
  /** Scrolls `line` (1-based) to the centre, puts the cursor at its start, and focuses the editor. */
  revealLine(line: number): void;
  dispose(): void;
}

export interface DiffHandle {
  /** Disposes the diff editor and its original (disk) model, never the live buffer. */
  dispose(): void;
}

export type MountOptions = { readOnly: boolean; narrow: boolean; onSave: () => void; onQuickOpen: () => void };

export type ThemeDefinition = {
  base: 'vs' | 'vs-dark';
  inherit: true;
  rules: [];
  colors: Record<string, string>;
};

/** The narrow surface the UI uses to talk to Monaco; src/editor/monaco.ts is the one implementation. */
export interface EditorHost {
  createModel(path: string, text: string): EditorModel;
  mount(element: HTMLElement, model: EditorModel, options: MountOptions): EditorHandle;
  mountDiff(element: HTMLElement, diskText: string, live: EditorModel, options: { narrow: boolean; path: string }): DiffHandle;
  applyTheme(theme: ThemeDefinition): void;
  languageFor(path: string): string;
}

export const EditorHostContext = createContext<EditorHost | null>(null);

export function useEditorHost(): EditorHost {
  const host = useContext(EditorHostContext);
  if (!host) throw new Error('useEditorHost: no EditorHostContext.Provider above');
  return host;
}
