import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { EditorHostContext } from '@/editor/EditorHost';
import { makeFakeHost } from './fakeEditorHost';

/** Renders `ui` with a fake EditorHost in context; returns the fake, a user-event instance and the render result. */
export function renderWithHost(ui: ReactElement) {
  const fake = makeFakeHost();
  const user = userEvent.setup();
  const utils = render(<EditorHostContext.Provider value={fake.host}>{ui}</EditorHostContext.Provider>);
  return { fake, user, ...utils };
}
