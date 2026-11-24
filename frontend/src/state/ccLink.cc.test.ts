// Gated (`CC_CHECKOUT=<code-conductor checkout> npm run test:cc`): cc's real viewLinkHash accepts exactly the hashes the
// fixture table records, so the encoding Code Editor documents and emits is the one cc's transcript links honour.
import { viewLinkHash } from 'cc-route'; // aliased to $CC_CHECKOUT/web/src/state/route.ts by vitest.cc.config.ts
import { describe, expect, it } from 'vitest';
import { CC_LINK_FIXTURES } from '../test/ccLinkFixtures';

describe('cc’s viewLinkHash on the deep-link table', () => {
  for (const f of CC_LINK_FIXTURES) {
    // Invariant: cc turns each link into exactly the recorded hash (or refuses it), so the decoder test's input is cc's own output.
    it(`${f.name}`, () => {
      expect(viewLinkHash(f.link)).toBe(f.hash);
    });
  }
});
