import { createContext, useContext } from 'react';
import type { LineRange } from '@/lib/ccLink';

/** A text buffer. Dirty = `getAlternativeVersionId()` differs from the version recorded at the last save/load. */
export interface EditorModel {
  getValue(): string;
  setValue(value: string): void;
  getAlternativeVersionId(): number;
  setLanguage(languageId: string): void;
  onDidChangeContent(listener: () => void): { dispose(): void };
  dispose(): void;
}

/** A non-empty selection: the lines it covers and exactly its text. */
export type Selection = { range: LineRange; text: string };

export interface EditorHandle {
  focus(): void;
  /**
   * Scrolls `start`..`end` (1-based; `end` null = one line) to the centre, puts the cursor at the start, focuses the editor,
   * and highlights the whole lines until the next edit or reveal.
   */
  revealRange(start: number, end: number | null): void;
  /** The primary selection, or null when it is empty. A selection ending at column 1 does not cover that last line. */
  getSelection(): Selection | null;
  dispose(): void;
}

export interface DiffHandle {
  /** Disposes the diff editor and its original (disk) model, never the live buffer. */
  dispose(): void;
}

export type DiffOptions = { narrow: boolean; path: string; /** Ctrl/Cmd+S in the diff's editable (live) side. */ onSave: () => void; /** Ctrl/Cmd+P in the diff's editable side. */ onQuickOpen: () => void };

export type MountOptions = {
  readOnly: boolean; narrow: boolean; onSave: () => void; onQuickOpen: () => void;
  /** The editor's "Comment on selection…" action (context menu and its keybinding). */
  onComment: () => void;
  /** Whether the selection is non-empty, on every change. */
  onSelectionChange: (hasSelection: boolean) => void;
};

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
  mountDiff(element: HTMLElement, diskText: string, live: EditorModel, options: DiffOptions): DiffHandle;
  applyTheme(theme: ThemeDefinition): void;
  languageFor(path: string): string;
}

export const EditorHostContext = createContext<EditorHost | null>(null);

export function useEditorHost(): EditorHost {
  const host = useContext(EditorHostContext);
  if (!host) throw new Error('useEditorHost: no EditorHostContext.Provider above');
  return host;
}
