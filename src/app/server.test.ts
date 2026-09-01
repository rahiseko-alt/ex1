import { describe, expect, it } from 'vitest';

import app from './server.js';

describe('画面の入口', () => {
  it('トップページに「顧客管理」の見出しが出る', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('<h1>顧客管理</h1>');
  });
});
