import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EditorHostContext } from './editor/EditorHost';
import { monacoHost } from './editor/monaco';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorHostContext.Provider value={monacoHost}>
      <App />
    </EditorHostContext.Provider>
  </StrictMode>,
);
