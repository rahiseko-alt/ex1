import { describe, expect, it } from 'vitest';

import { main } from './index.js';

describe('main', () => {
  it('例外を投げずに実行できる', () => {
    expect(() => main()).not.toThrow();
  });
});
