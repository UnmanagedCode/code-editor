import assert from 'node:assert/strict';
import test from 'node:test';
import { CC_EXEC_CAPS } from '../src/cc/exec.js';
import * as L from '../src/limits.js';

// cc's caps copied from its docs/plugins/runtime.md → Host exec (EXEC_MAX_TIMEOUT_MS, EXEC_MAX_OUTPUT_BYTES, EXEC_BODY_LIMIT).
const CC = { EXEC_MAX_TIMEOUT_MS: 600_000, EXEC_MAX_OUTPUT_BYTES: 128 * 1024 * 1024, EXEC_BODY_LIMIT: 16 * 1024 * 1024 };

test('the client’s copy of cc’s caps matches cc', () => {
  assert.deepEqual(CC_EXEC_CAPS, CC);
});

test('exec timeouts stay within cc’s maximum', () => {
  assert.ok(L.OP_TIMEOUT_MS <= CC.EXEC_MAX_TIMEOUT_MS);
  assert.ok(L.SEARCH_TIMEOUT_MS <= CC.EXEC_MAX_TIMEOUT_MS);
});

test('derived output caps stay within cc’s maximum output', () => {
  for (const n of [L.readOutputBytes(), L.searchOutputBytes(), L.filesOutputBytes(), L.listOutputBytes()]) {
    assert.ok(n > 0 && n <= CC.EXEC_MAX_OUTPUT_BYTES, String(n));
  }
});

test('a maximal save fits cc’s request body: base64 stdin plus the script and envelope under EXEC_BODY_LIMIT', async () => {
  const { OPS_SCRIPT } = await import('../src/fs/script.js');
  const body = L.maxWriteStdinB64() + OPS_SCRIPT.length * 6 + 4096;
  assert.ok(body <= CC.EXEC_BODY_LIMIT, `${body}`);
});

test('the read output cap holds a full MAX_EDIT_BYTES read in base64, and the PUT body limit covers worst-case JSON escaping', () => {
  assert.ok(L.readOutputBytes() >= Math.ceil(L.MAX_EDIT_BYTES / 3) * 4);
  assert.ok(L.WRITE_BODY_LIMIT >= L.MAX_EDIT_BYTES * 6);
});

test('the read cap scales with a smaller edit cap', () => {
  assert.ok(L.readOutputBytes(10) < L.readOutputBytes());
});
