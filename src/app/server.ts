/**
 * 画面を返す入口。Cloudflare Workers 上で動かすため、Node の http ではなく
 * fetch ハンドラの形にしている（`export default { fetch }` が Workers の約束事）。
 */
import { Hono } from 'hono';

export const app = new Hono();

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
  </body>
</html>
`,
  ),
);

export default app;
