/**
 * 画面を返す入口。Cloudflare Workers 上で動かすため、Node の http ではなく
 * fetch ハンドラの形にしている（`export default app` で Hono がその形を満たす）。
 */
import { Hono } from 'hono';

import { customers } from './customers.js';
import type { Env } from './db.js';

export const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.html(
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>顧客管理</title>
  </head>
  <body>
    <h1>顧客管理</h1>
    <p><a href="/customers/new">顧客を登録する</a></p>
  </body>
</html>
`,
  ),
);

app.route('/', customers);

export default app;
