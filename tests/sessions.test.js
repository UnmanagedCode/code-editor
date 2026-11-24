import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp } from './_app.js';

const row = (over) => ({
  sessionId: 's1', project: 'app', worktree: null, status: 'idle', displayLabel: 'Fix the parser', lastResponseAt: 2000, createdAt: 1000,
  cwd: '/home/someone/app', firstPrompt: 'secret prompt', model: 'x', ...over,
});

test('api/sessions lists live sessions only, projected to the fields the comment picker needs', async (t) => {
  const app = await startApp(t);
  app.fake.state.instances = [
    row({}),
    row({ sessionId: 's2', worktree: { worktreeName: 'w1' }, status: 'busy', displayLabel: 'Refactor', lastResponseAt: null, createdAt: 1500 }),
    row({ sessionId: 's3', status: 'exited' }),
    row({ sessionId: 's4', status: 'crashed' }),
    row({ sessionId: null, status: 'starting' }),
  ];
  const r = await app.get('/api/sessions');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { sessions: [
    { sessionId: 's1', project: 'app', worktree: null, label: 'Fix the parser', status: 'idle', lastActive: 2000 },
    { sessionId: 's2', project: 'app', worktree: 'w1', label: 'Refactor', status: 'busy', lastActive: 1500 },
  ] });
});

test('api/sessions is refused without the CSRF header, like every /api route', async (t) => {
  const app = await startApp(t);
  const r = await app.raw('GET', '/api/sessions');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'REQUEST_REFUSED');
});

test('api/sessions is 503 CONDUCTOR_UNAVAILABLE when cc answers an error, garbage, or is not set', async (t) => {
  const app = await startApp(t);
  app.fake.state.instancesHook = () => ({ status: 500, body: { error: 'x' } });
  assert.equal((await app.get('/api/sessions')).body.code, 'CONDUCTOR_UNAVAILABLE');
  app.fake.state.instancesHook = () => ({ status: 200, body: { not: 'a list' } });
  assert.equal((await app.get('/api/sessions')).body.code, 'CONDUCTOR_UNAVAILABLE');
  delete process.env.CONDUCTOR_URL;
  assert.equal((await app.get('/api/sessions')).status, 503);
});
