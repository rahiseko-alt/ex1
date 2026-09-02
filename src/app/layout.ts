/**
 * どのページも同じ枠で出すための組み立て。
 *
 * 画面ごとに `<html>` から書くと、ページによってメニューが無かったり
 * 見た目がずれたりする。枠はここ1箇所だけにしてある。
 */

/**
 * 画面に出す前に、記号を安全な書き方へ直す。
 * 顧客名に `<` が入っていても、画面の作りが壊れないようにするため。
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 上のメニュー1つぶん。並びはこの配列が正本。 */
export const MENU: readonly { href: string; label: string }[] = [
  { href: '/customers', label: '顧客' },
  { href: '/deals', label: '案件' },
];

/**
 * ページ1枚。`body` には `<main>` の中身だけを渡す。
 *
 * 見た目は `public/style.css` に分けてある（wrangler.toml の `[assets]` で
 * そのまま返される）。TypeScript の中に埋めると、色を変えるたびに
 * 画面の組み立て側を触ることになるため。
 */
export function page(title: string, body: string): string {
  const menu = MENU.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`).join(
    '\n          ',
  );

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header class="site-header">
      <div class="inner">
        <a class="site-title" href="/">顧客管理</a>
        <nav class="site-nav">
          ${menu}
        </nav>
      </div>
    </header>
    <main>
${body}
    </main>
  </body>
</html>
`;
}
