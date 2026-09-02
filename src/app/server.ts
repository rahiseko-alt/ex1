/**
 * 画面を返す入口。Cloudflare Workers 上で動かすため、Node の http ではなく
 * fetch ハンドラの形にしている（`export default app` で Hono がその形を満たす）。
 */
import { Hono } from 'hono';

import { customers } from './customers.js';
import type { Env } from './db.js';
import { page } from './layout.js';

export const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.html(
    page(
      '顧客管理',
      `    <h1>顧客管理</h1>
      <p><a href="/customers/new">顧客を登録する</a></p>
      <p><a href="/customers">顧客の一覧を見る</a></p>
      <p><a href="/deals">案件を段階ごとに見る</a></p>`,
    ),
  ),
);

app.route('/', customers);

export default app;
