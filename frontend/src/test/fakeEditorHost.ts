import type { DiffHandle, EditorHandle, EditorHost, EditorModel, MountOptions, ThemeDefinition } from '@/editor/EditorHost';

export class FakeModel implements EditorModel {
  value: string;
  version = 1;
  language: string;
  disposed = false;
  listeners = new Set<() => void>();
  constructor(readonly path: string, text: string, language: string) { this.value = text; this.language = language; }
  getValue() { return this.value; }
  setValue(v: string) { this.value = v; this.version++; this.fire(); }
  getAlternativeVersionId() { return this.version; }
  setLanguage(l: string) { this.language = l; }
  onDidChangeContent(l: () => void) { this.listeners.add(l); return { dispose: () => { this.listeners.delete(l); } }; }
  dispose() { this.disposed = true; this.listeners.clear(); }
  /** What typing does: a new text and a new version. */
  type(v: string) { this.setValue(v); }
  /** Undo back to a previous version (the alternative version id returns to its old value). */
  undoTo(v: string, version: number) { this.value = v; this.version = version; this.fire(); }
  private fire() { for (const l of [...this.listeners]) l(); }
}

export type FakeMount = { element: HTMLElement; model: FakeModel; options: MountOptions; revealed: number[]; disposed: boolean };
export type FakeDiff = { element: HTMLElement; diskText: string; live: FakeModel; path: string; disposed: boolean };

const LANGS: Record<string, string> = { ts: 'typescript', js: 'javascript', md: 'markdown', json: 'json', txt: 'plaintext' };

/** An EditorHost that records what the UI asks of it; tests drive the "editor" through `models` and `mounts`. */
export function makeFakeHost() {
  const models: FakeModel[] = [];
  const mounts: FakeMount[] = [];
  const diffs: FakeDiff[] = [];
  const themes: ThemeDefinition[] = [];
  const languageFor = (path: string) => LANGS[path.split('.').pop() ?? ''] ?? 'plaintext';
  const host: EditorHost = {
    createModel(path, text) { const m = new FakeModel(path, text, languageFor(path)); models.push(m); return m; },
    mount(element, model, options): EditorHandle {
      const mount: FakeMount = { element, model: model as FakeModel, options, revealed: [], disposed: false };
      mounts.push(mount);
      element.dataset.mounted = (model as FakeModel).path;
      return { focus() {}, revealLine(l) { mount.revealed.push(l); }, dispose() { mount.disposed = true; } };
    },
    mountDiff(element, diskText, live, o): DiffHandle {
      const diff: FakeDiff = { element, diskText, live: live as FakeModel, path: o.path, disposed: false };
      diffs.push(diff);
      return { dispose() { diff.disposed = true; } };
    },
    applyTheme(t) { themes.push(t); },
    languageFor,
  };
  return {
    host, models, mounts, diffs, themes,
    modelFor: (path: string) => models.filter((m) => m.path === path).at(-1)!,
    lastMount: () => mounts.at(-1)!,
    liveMounts: () => mounts.filter((m) => !m.disposed),
  };
}
