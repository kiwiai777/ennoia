// CT-0027-04: Pipeline + Dedupe + Migration Tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compareAuthority } from '../core/user-model/write-items-authority.js';

describe('Authority comparison', () => {
  it('reflect > sync(deterministic)', () => {
    assert.equal(compareAuthority('cli:reflect:manual', 'cli:sync:chatgpt-export:conv-123'), true);
  });

  it('sync(deterministic) > sync(llm)', () => {
    assert.equal(compareAuthority('cli:sync:chatgpt-export:conv-123', 'cli:sync:llm:chatgpt-export:conv-123'), true);
  });

  it('sync(llm) < sync(deterministic)', () => {
    assert.equal(compareAuthority('cli:sync:llm:chatgpt-export:conv-123', 'cli:sync:chatgpt-export:conv-123'), false);
  });

  it('same authority: existing wins', () => {
    assert.equal(compareAuthority('cli:reflect:manual', 'cli:reflect:manual'), false);
    assert.equal(compareAuthority('cli:sync:chatgpt-export:conv-1', 'cli:sync:chatgpt-export:conv-2'), false);
  });
});
