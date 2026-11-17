import { describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('api', () => {
  it('sends the X-Code-Editor header on every request (a cross-site GET cannot), keeping the caller’s own headers', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('api/roots');
    await api('api/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
    const sent = fetchMock.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].headers as Record<string, string>);
    expect(sent[0]['x-code-editor']).toBe('1');
    expect(sent[1]).toMatchObject({ 'x-code-editor': '1', 'content-type': 'application/json' });
  });

  it('refuses a root-relative path, which would reach cc rather than this plugin', async () => {
    await expect(api('/api/roots')).rejects.toThrow(/root-relative/);
  });
});
