import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { installMatchMedia, media } from './media';

// Any network call a test did not mock fails it loudly.
beforeEach(() => {
  media.narrow = false;
  media.coarse = false;
  installMatchMedia();
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => { throw new Error(`unmocked fetch: ${String(url)}`); }));
  window.history.replaceState(null, '', '/');
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-cc-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Radix and Monaco-adjacent code expect these browser APIs.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
