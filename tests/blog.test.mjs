import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = 'https://pandacat.com.tw';
const published = 'fixture-published';
const draft = 'fixture-private-draft';
const cover = '/assets/blog/choose-cat-litter-cover.jpg';
const title = '測試：量測貓砂盆';
const teaser = '測試文章摘要。';
const body = '先量入口，再量底部最窄處。\n\n## 量測方法\n\n[貓砂指南](/blog/choose-cat-litter/)';

function source(slug, status, options = {}) {
  const coverUrl = options.coverUrl ?? cover;
  return [
    '---',
    'slug: ' + slug,
    'title: ' + JSON.stringify(title),
    'description: ' + JSON.stringify(teaser),
    'status: ' + status,
    'category: "選購指南"',
    'author: "胖大喵編輯部"',
    'publishedAt: "2025-08-12"',
    'updatedAt: "2025-08-20"',
    'cover: ' + JSON.stringify(coverUrl),
    'coverAlt: "示意封面"',
    '---',
    '',
    options.body ?? body,
    '',
  ].join('\n');
}

function fixture(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'pandacat-blog-test-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const cwd = join(parent, 'repo');
  mkdirSync(cwd);
  for (const name of [
    'scripts', 'content', 'assets', 'blog', 'index.html', 'style.css', 'sitemap.xml',
    'robots.txt', 'package.json', 'package-lock.json', 'vercel.json', 'docs', 'README.md',
  ]) {
    const original = join(root, name);
    if (existsSync(original)) cpSync(original, join(cwd, name), { recursive: true });
  }
  const dependencies = join(root, 'node_modules');
  assert.ok(existsSync(dependencies), 'Run npm ci before testing.');
  symlinkSync(dependencies, join(cwd, 'node_modules'), 'junction');
  return {
    cwd, parent,
    path: (...parts) => join(cwd, ...parts),
    read: (...parts) => readFileSync(join(cwd, ...parts), 'utf8'),
    write: (contents, ...parts) => writeFileSync(join(cwd, ...parts), contents),
    article: (slug, status, options) =>
      writeFileSync(join(cwd, 'content', 'blog', `${slug}.md`), source(slug, status, options)),
  };
}

function cli(f, mode, args = [], success = true) {
  // Execute the same script as the npm commands without a platform-specific shell.
  const run = spawnSync(process.execPath, [join(f.cwd, 'scripts', 'blog.mjs'), mode, ...args], {
    cwd: f.cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const output = [run.stdout, run.stderr].filter(Boolean).join('\n');
  assert.ifError(run.error);
  assert.equal(run.signal, null, output);
  if (success) assert.equal(run.status, 0, output);
  else assert.notEqual(run.status, 0, output);
  return output;
}

function articlePath(slug) {
  return ['blog', slug, 'index.html'];
}

function ld(html) {
  const items = Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    ([, json]) => JSON.parse(json));
  return items.find((item) => item['@type'] === 'BlogPosting');
}

test('Blog pagination caps 10 cards, keeps old URLs, and removes generated stale pages', (t) => {
  const f = fixture(t);
  const list = ['blog', 'index.html'];
  const second = ['blog', 'page', '2', 'index.html'];
  const cards = (html) => [...html.matchAll(/<a href="([^"]+)" class="blog-card__link">/gu)].map((entry) => entry[1]);
  // Isolate the two legacy cards from future real published Markdown articles.
  for (const file of readdirSync(f.path('content', 'blog'))) {
    if (file.endsWith('.md')) rmSync(f.path('content', 'blog', file));
  }
  for (let i = 1; i <= 8; i++) f.article('pagination-fixture-' + i, 'published');
  f.article('pagination-fixture-draft', 'draft');
  cli(f, 'build');
  assert.equal(cards(f.read(...list)).length, 10);
  assert.ok(!f.read(...list).includes('class="blog-pagination"'));
  assert.ok(!existsSync(f.path(...second)));
  assert.ok(!f.read('sitemap.xml').includes('/blog/page/'));

  f.article('pagination-fixture-9', 'published');
  cli(f, 'build');
  cli(f, 'check');
  const firstPage = f.read(...list);
  const secondPage = f.read(...second);
  assert.equal(cards(firstPage).length, 10);
  assert.deepEqual(cards(secondPage), ['/blog/choose-cat-litter/']);
  assert.equal(new Set([...cards(firstPage), ...cards(secondPage)]).size, 11);
  assert.match(firstPage, /<a href="\/blog\/page\/2\/" rel="next">/u);
  assert.match(secondPage, /<a href="\/blog\/" rel="prev">/u);
  assert.match(secondPage, /aria-current="page">第 2／2 頁/u);
  assert.match(secondPage, /rel="canonical" href="https:\/\/pandacat\.com\.tw\/blog\/page\/2\/"/u);
  assert.match(secondPage, /<title>[^<]+第 2 頁/u);
  assert.ok(f.read('sitemap.xml').includes('<loc>' + host + '/blog/page/2/</loc>'));
  assert.ok(!f.read('sitemap.xml').includes('/blog/page/1/'));
  assert.ok(!f.read('sitemap.xml').includes('pagination-fixture-draft'));
  cli(f, 'stage');
  assert.ok(existsSync(f.path('dist', ...second)));
  assert.ok(existsSync(f.path('dist', 'blog', 'choose-cat-litter.html')));
  assert.ok(!existsSync(f.path('dist', 'blog', 'page', '1')));

  f.article('pagination-fixture-9', 'draft');
  assert.match(cli(f, 'check', [], false), /blog\/page\/2\/index\.html \(withdrawn\)/u);
  cli(f, 'build');
  cli(f, 'check');
  cli(f, 'stage');
  assert.equal(cards(f.read(...list)).length, 10);
  assert.ok(!existsSync(f.path(...second)));
  assert.ok(!existsSync(f.path('dist', ...second)));
});

test('lint catches unrendered double asterisks at a Chinese bold callout boundary', (t) => {
  const f = fixture(t);
  const sample = '**下單前先問清楚：**入口高度。';
  const output = join(f.parent, 'cjk-draft-preview');
  f.article(draft, 'draft', { body: sample });
  const hint = /未轉成粗體[\s\S]*加一個空格/u;
  assert.match(cli(f, 'preview', [draft, output], false), hint);
  assert.match(cli(f, 'check', [], false), hint);
  assert.ok(!existsSync(output), 'invalid draft did not create a preview');

  const tick = String.fromCharCode(96);
  const fence = tick.repeat(3);
  const escaped = sample.replaceAll('*', '\\*');
  f.article(draft, 'draft', {
    body: ['**下單前先問清楚：** 入口高度。',
      escaped + '、' + tick + sample + tick, fence + '\n' + sample + '\n' + fence].join('\n\n'),
  });
  cli(f, 'check');
  cli(f, 'preview', [draft, output]);
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  assert.match(html, /<strong>下單前先問清楚：<\/strong> 入口高度。/u);
  assert.ok(html.includes('<code>' + sample + '</code>') && html.includes('<pre><code>' + sample));
});

test('Shopee registry renders exact tracked URLs and refuses unregistered links', (t) => {
  const f = fixture(t);
  const exact = 'https://shopee.tw/universal-link/product/40866222/3665445262?deep_and_web=1&smtt=9&utm_campaign=s40866222_ss_tw_webs_cat-litter-box&utm_content=cat-litter-box-102&utm_medium=seller&utm_source=website';
  const escaped = exact.replaceAll('&', '&amp;');
  const preview = join(f.parent, 'shopee-draft-preview');
  f.article(draft, 'draft', { body: '[前往蝦皮](shopee:cat-litter-box-102)' });
  cli(f, 'preview', [draft, preview]);
  assert.ok(readFileSync(join(preview, 'index.html'), 'utf8').includes('href="' + escaped + '" data-shopee-link="cat-litter-box-102"'));

  f.article(published, 'published', { body: '[前往蝦皮](' + exact + ')' });
  cli(f, 'build');
  cli(f, 'check');
  assert.ok(f.read(...articlePath(published)).includes('href="' + escaped + '" data-shopee-link="cat-litter-box-102"'));

  f.article(draft, 'draft', { body: '[未登錄商品](shopee:not-a-product)' });
  assert.match(cli(f, 'check', [], false), /unknown Shopee link key/u);
  const untrackedFixture = new URL('/product/1/2', exact).href;
  f.article(draft, 'draft', { body: '[沒有追蹤碼](' + untrackedFixture + ')' });
  assert.match(cli(f, 'check', [], false), /registered exact tracked Shopee URL/u);
  const dottedHost = new URL(untrackedFixture);
  dottedHost.hostname += '.';
  f.article(draft, 'draft', { body: '[蝦皮別名](' + dottedHost.href + ')' });
  assert.match(cli(f, 'check', [], false), /registered exact tracked Shopee URL/u);
});

test('litter mat link emits the exact exported tracking URL without table artifacts', (t) => {
  const f = fixture(t);
  const output = join(f.parent, 'litter-mat-preview');
  const exact = 'https://shopee.tw/universal-link/product/40866222/1690471591?deep_and_web=1&smtt=9&utm_campaign=s40866222_ss_tw_webs_shopee-website&utm_content=cat-litter-mat&utm_medium=seller&utm_source=website';
  f.article(draft, 'draft', { body: '[雙層落砂墊](shopee:cat-litter-mat)' });
  cli(f, 'preview', [draft, output]);
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  assert.ok(html.includes('href="' + exact.replaceAll('&', '&amp;') + '" data-shopee-link="cat-litter-mat"'));
});

test('Shopee check rejects raw, altered, and misassigned legacy links', (t) => {
  const f = fixture(t);
  const name = 'index.html';
  const original = f.read(name);
  f.write(original.replace('data-shopee-link="shopee-home" ', ''), name);
  assert.match(cli(f, 'check', [], false), /Shopee link requires data-shopee-link/u);
  f.write(original.replace('utm_source=website', 'utm_source=WEBSITE'), name);
  assert.match(cli(f, 'check', [], false), /index.html/u);
  assert.match(cli(f, 'stage', [], false), /index.html/u);
  cli(f, 'build');
  assert.equal(f.read(name), original);

  const expected = JSON.parse(f.read('scripts', 'shopee-links.json'));
  f.write(original.replace(expected['shopee-home'].url.replaceAll('&', '&amp;'),
    expected['cat-litter-box-105'].url.replaceAll('&', '&amp;')), name);
  assert.match(cli(f, 'check', [], false), /index.html/u);
});

test('new public articles have real consistent HTML, cards and sitemap; legacy paths remain', (t) => {
  const f = fixture(t);
  f.article(published, 'published');
  f.article(draft, 'draft');
  cli(f, 'build');
  cli(f, 'check');
  const html = f.read(...articlePath(published));
  const articleUrl = `${host}/blog/${published}/`;
  assert.match(html, /<html[^>]+\blang="zh-Hant"/i);
  assert.equal((html.match(/<h1(?:\s|>)/gi) ?? []).length, 1);
  assert.match(html, /測試：量測貓砂盆/);
  assert.match(html, /先量入口，再量底部最窄處/);
  assert.ok(html.includes(`href="${articleUrl}"`), 'canonical uses trailing slash');
  assert.ok(html.includes(`content="${articleUrl}"`), 'share URL uses canonical');
  assert.match(html, /href="\/blog\/"[^>]*>[^<]*返回 Blog/);
  const schema = ld(html);
  assert.ok(schema, 'a parsable BlogPosting block is present');
  assert.equal(schema.headline, title);
  assert.match(schema.datePublished, /^2025-08-12/);
  assert.match(schema.dateModified, /^2025-08-20/);
  assert.match(JSON.stringify(schema.image), /choose-cat-litter-cover\.jpg/);
  assert.match(JSON.stringify(schema), /fixture-published\//);
  assert.match(html, /alt="示意封面"/);
  const list = f.read('blog', 'index.html');
  const sitemap = f.read('sitemap.xml');
  assert.ok(list.includes(`href="/blog/${published}/"`));
  assert.ok(sitemap.includes(`<loc>${articleUrl}</loc>`));
  assert.ok(!sitemap.includes(`<loc>${host}/blog/${published}</loc>`));
  assert.ok(!list.includes(draft));
  assert.ok(!sitemap.includes(draft));
  assert.ok(!existsSync(f.path(...articlePath(draft))));
  for (const legacy of ['choose-cat-litter', 'large-cat-cage-guide']) {
    assert.ok(list.includes(`${legacy}/`));
    assert.ok(sitemap.includes(`<loc>${host}/blog/${legacy}/</loc>`));
    assert.ok(existsSync(f.path(...articlePath(legacy))));
    assert.ok(existsSync(f.path('blog', `${legacy}.html`)));
  }
  cli(f, 'stage');
  const vercel = JSON.parse(f.read('vercel.json'));
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.buildCommand, 'npm run blog:stage');
  assert.equal(f.read('dist', ...articlePath(published)), html);
  assert.equal(f.read('dist', 'sitemap.xml'), sitemap);
  assert.ok(existsSync(f.path('dist', 'robots.txt')));
  assert.ok(existsSync(f.path('dist', 'index.html')));
  assert.ok(existsSync(f.path('dist', 'style.css')));
  assert.ok(existsSync(f.path('dist', 'assets', 'blog', 'choose-cat-litter-cover.jpg')));
  assert.ok(!existsSync(f.path('dist', ...articlePath(draft))));
  for (const internal of ['content', 'scripts', 'docs', 'node_modules', 'package.json', '.git']) {
    assert.ok(!existsSync(f.path('dist', internal)), `do not publish ${internal}`);
  }
});

test('preview renders a private draft with noindex and does not touch public outputs', (t) => {
  const f = fixture(t);
  f.article(draft, 'draft');
  cli(f, 'build');
  const sitemap = f.read('sitemap.xml');
  const index = f.read('blog', 'index.html');
  const output = join(f.parent, 'draft-preview');
  assert.match(cli(f, 'preview', [draft, f.path('dist', draft)], false), /outside|temporary/i);
  cli(f, 'preview', [draft, output]);
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  assert.match(html, /先量入口，再量底部最窄處/);
  assert.match(html, /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*\bnoindex\b/i);
  assert.ok(html.includes(`href="${host}/blog/"`), 'isolated preview links to the live Blog, not a missing local list');
  assert.ok(existsSync(join(output, 'style.css')));
  assert.ok(!existsSync(f.path(...articlePath(draft))));
  assert.equal(f.read('sitemap.xml'), sitemap);
  assert.equal(f.read('blog', 'index.html'), index);
});

test('changing a public article to draft cannot leave a stale public route', (t) => {
  const f = fixture(t);
  const unique = 'fixture-only-cover.jpg';
  const coverUrl = '/assets/blog/' + unique;
  cpSync(f.path('assets', 'blog', 'choose-cat-litter-cover.jpg'), f.path('assets', 'blog', unique));
  f.article(published, 'published', { coverUrl });
  cli(f, 'build');
  cli(f, 'stage');
  assert.ok(existsSync(f.path('dist', ...articlePath(published))));
  assert.ok(existsSync(f.path('dist', 'assets', 'blog', unique)));
  f.article(published, 'draft', { coverUrl });
  assert.match(cli(f, 'check', [], false), /withdrawn|stale/i);
  assert.match(cli(f, 'stage', [], false), /withdrawn|stale/i);
  cli(f, 'build');
  cli(f, 'check');
  cli(f, 'stage');
  assert.ok(!existsSync(f.path(...articlePath(published))));
  assert.ok(!existsSync(f.path('dist', ...articlePath(published))));
  assert.ok(!existsSync(f.path('dist', 'assets', 'blog', unique)));
  assert.ok(!f.read('dist', 'sitemap.xml').includes(published));
  assert.ok(!f.read('dist', 'blog', 'index.html').includes(published));
});

test('build is deterministic, check does not overwrite edits, stage fails on stale output', (t) => {
  const f = fixture(t);
  f.article(published, 'published');
  cli(f, 'build');
  const snapshots = [articlePath(published), ['blog', 'index.html'], ['sitemap.xml']]
    .map((path) => ({ path, value: f.read(...path) }));
  cli(f, 'build');
  for (const { path, value } of snapshots) assert.equal(f.read(...path), value);
  const changed = snapshots[0].value.replace('先量入口，再量底部最窄處。', '不應手動改公開 HTML。');
  assert.notEqual(changed, snapshots[0].value);
  f.write(changed, ...articlePath(published));
  assert.match(cli(f, 'check', [], false), /stale/i);
  assert.equal(f.read(...articlePath(published)), changed);
  assert.match(cli(f, 'stage', [], false), /stale/i);
  assert.ok(!existsSync(f.path('dist', ...articlePath(published))));
});

test('check catches a stale sitemap URL and a legacy article back link pointing at itself', (t) => {
  const f = fixture(t);
  cli(f, 'build');
  cli(f, 'check');
  const baseline = f.read('sitemap.xml');
  const malformed = baseline.replace(`${host}/blog/choose-cat-litter/</loc>`, `${host}/blog/choose-cat-litter</loc>`);
  assert.notEqual(malformed, baseline);
  f.write(malformed, 'sitemap.xml');
  assert.match(cli(f, 'check', [], false), /sitemap/i);
  assert.equal(f.read('sitemap.xml'), malformed);
  f.write(baseline, 'sitemap.xml');
  const legacy = articlePath('choose-cat-litter');
  const original = f.read(...legacy);
  const selfLink = original.replace(/(<a\b[^>]*?)href="\/blog\/"([^>]*>[^<]*返回 Blog)/, '$1href="index.html"$2');
  assert.notEqual(selfLink, original, 'mutate the real back link');
  f.write(selfLink, ...legacy);
  cli(f, 'check', [], false);
  assert.equal(f.read(...legacy), selfLink);
});

test('reject missing image and reject any second file declaring the same slug', (t) => {
  const f = fixture(t);
  f.article(published, 'published', { coverUrl: '/assets/blog/missing-fixture-image.png' });
  assert.match(cli(f, 'build', [], false), /missing-fixture-image\.png/);
  assert.ok(!existsSync(f.path(...articlePath(published))));
  f.article(published, 'published');
  f.write(source(published, 'draft'), 'content', 'blog', 'second-slug-fixture.md');
  assert.match(cli(f, 'build', [], false), /slug/i);
  assert.ok(!existsSync(f.path(...articlePath(published))));
});

test('reject a second H1 in the authored body rather than hiding it in HTML', (t) => {
  const f = fixture(t);
  f.article(published, 'published', { body: '# 第二個主標\n\n一般正文。' });
  assert.match(cli(f, 'build', [], false), /H1/i);
  assert.ok(!existsSync(f.path(...articlePath(published))));
});

test('build, check and stage reject missing same-site public destinations', (t) => {
  const f = fixture(t);
  const missing = '/nonexistent-fixture-note/';
  f.article(published, 'published', { body: `正文。\n\n[錯誤站內連結](${missing})` });
  assert.match(cli(f, 'build', [], false), /nonexistent-fixture-note/);
  assert.ok(!existsSync(f.path(...articlePath(published))));
  rmSync(f.path('content', 'blog', `${published}.md`));
  cli(f, 'build');
  const legacy = articlePath('large-cat-cage-guide');
  const original = f.read(...legacy);
  const changed = original.replace('href="/blog/choose-cat-litter/"', `href="${missing}"`);
  assert.notEqual(changed, original, 'mutate a real related article link');
  f.write(changed, ...legacy);
  assert.match(cli(f, 'check', [], false), /nonexistent-fixture-note/);
  assert.match(cli(f, 'stage', [], false), /nonexistent-fixture-note/);
  assert.ok(!existsSync(f.path('dist')));
});

test('check and stage reject noindex on a public legacy article', (t) => {
  const f = fixture(t);
  cli(f, 'build');
  const legacy = articlePath('choose-cat-litter');
  const original = f.read(...legacy);
  const noindex = original.replace('<head>', '<head>\n    <meta name="robots" content="noindex">');
  assert.notEqual(noindex, original, 'mutate the public HTML head');
  f.write(noindex, ...legacy);
  assert.match(cli(f, 'check', [], false), /noindex/i);
  assert.match(cli(f, 'stage', [], false), /noindex/i);
  assert.ok(!existsSync(f.path('dist')));
});

test('Markdown preserves an ordinary HTTPS link and text but does not emit raw elements or unsupported schemes', (t) => {
  const f = fixture(t);
  f.article(published, 'published', {
    body: [
      '普通段落中的 <mark>原樣文字</mark>。',
      '',
      '[可用連結](https://example.org/help) 與 [舊式傳檔連結](ftp://example.org/help)。',
    ].join('\n'),
  });
  cli(f, 'build');
  const html = f.read(...articlePath(published));
  assert.match(html, /href="https:\/\/example\.org\/help"/);
  assert.match(html, /原樣文字/);
  assert.doesNotMatch(html, /<mark>/i);
  assert.doesNotMatch(html, /href=["']ftp:/i);
});

test('desktop and mobile menus both link to the canonical Blog list in staging', (t) => {
  const f = fixture(t);
  cli(f, 'stage');
  const html = f.read('dist', 'index.html');
  const desktop = html.match(/<nav class="header__nav"[^>]*>[\s\S]*?<\/nav>/u)?.[0];
  const mobile = html.match(/<nav class="mobile-nav" id="mobileNav"[^>]*>[\s\S]*?<\/nav>/u)?.[0];
  for (const nav of [desktop, mobile]) {
    assert.ok(nav, 'Expected navigation in staged homepage');
    assert.match(nav, /<a href="\/blog\/"[^>]*>Blog<\/a>/u);
  }
  assert.match(html, /aria-controls="mobileNav"/u);
});
