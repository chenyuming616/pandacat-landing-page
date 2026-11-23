import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parseDocument } from 'yaml';
import { parse } from 'parse5';
import { canonical, cardsEnd, cardsStart, escape, marker, origin, renderArticle, renderCard } from './blog-template.mjs';

const root = realpathSync(process.cwd());
const editorial = 'content/blog';
const legacy = new Map([
  ['choose-cat-litter', {
    publishedAt: '2025-01-10', title: '新手選貓砂完整攻略', category: '貓咪知識',
    description: '選貓砂的 7 個重點一次看懂，從材質、顆粒到除臭效果，教你挑選合適的貓砂',
    cover: '/assets/blog/choose-cat-litter-cover.jpg', tags: ['貓砂', '新手養貓', '用品選購'],
  }],
  ['large-cat-cage-guide', {
    publishedAt: '2025-01-15', title: '大空間貓籠選購指南', category: '用品選購',
    description: '多貓家庭、幼貓隔離必備！選購貓籠的關鍵要點與推薦',
    cover: '/assets/blog/large-cat-cage-cover.jpg', tags: ['貓籠', '多貓家庭', '幼貓'],
  }],
]);
const pageSize = 10;
const pagerStart = '<!-- pandacat:blog-pagination:start -->';
const pagerEnd = '<!-- pandacat:blog-pagination:end -->';
const stablePages = ['index.html', 'style.css', 'robots.txt', 'sitemap.xml', 'blog/index.html'];
const existingArticleHtml = [...legacy.keys()].map((slug) => 'blog/' + slug + '/index.html');
// These checks intentionally reject untrusted control characters in text and URLs.
// eslint-disable-next-line no-control-regex -- C0 controls and DEL cannot appear in article input.
const controlCharacters = /[\u0000-\u001f\u007f]/u;
// eslint-disable-next-line no-control-regex -- URLs must also reject spaces and browser-normalized backslashes.
const unsafeUrlCharacters = /[\u0000-\u0020\u007f\\]/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const assetPattern = /^\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/i;
const coverPattern = /^\/assets\/blog\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:avif|gif|jpe?g|png|webp)$/i;
const fields = new Set(['slug', 'title', 'description', 'status', 'publishedAt', 'updatedAt', 'category', 'author', 'authorUrl', 'cover', 'coverAlt']);
let shopeeLinks;
const pathFor = (name) => resolve(root, name);
const fail = (message) => { throw new Error(message); };
const read = (name) => readFileSync(regular(name), 'utf8');

function inside(parent, child) {
  const distance = relative(parent, child);
  return distance !== '' && distance !== '..' && !distance.startsWith('..' + sep) && !isAbsolute(distance);
}

function regular(name) {
  const path = pathFor(name);
  if (!inside(root, path) || !existsSync(path) || !lstatSync(path).isFile() || realpathSync(path) !== path)
    fail('Expected a regular repository file: ' + name);
  return path;
}

function date(value, key) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(key + ' must be a real YYYY-MM-DD date');
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value || value.startsWith('0000'))
    fail(key + ' must be a real YYYY-MM-DD date');
  return value;
}

function httpsUrl(value) {
  try {
    const u = new URL(value);
    return /^https:\/\//i.test(value) && u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isShopeeUrl(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value, origin).hostname.replace(/\.$/u, '');
    return /(?:^|\.)shopee\.[a-z.]+$|^(?:shope\.ee|shp\.ee)$/i.test(hostname);
  } catch { return false; }
}

function trackedShopee(key, context) {
  const link = Object.hasOwn(shopeeLinks, key) ? shopeeLinks[key] : null;
  if (!link?.url) fail(context + ' unknown Shopee link key: ' + key);
  return link.url;
}

function verifyShopeeRegistry() {
  shopeeLinks = JSON.parse(read('scripts/shopee-links.json'));
  const seen = new Set();
  for (const [key, entry] of Object.entries(shopeeLinks)) {
    if (!entry || !slugPattern.test(key) || typeof entry.label !== 'string' || !entry.label.trim() || !httpsUrl(entry.url))
      fail('Invalid Shopee registry entry: ' + key);
    const url = new URL(entry.url);
    const params = url.searchParams;
    const pathMatches = key === 'shopee-home' ? url.pathname === '/universal-link/xuanling67' :
      /^\/universal-link\/product\/40866222\/\d+$/u.test(url.pathname);
    if (url.origin !== 'https://shopee.tw' || !pathMatches || url.hash ||
        [...params.keys()].join(',') !== 'deep_and_web,smtt,utm_campaign,utm_content,utm_medium,utm_source' ||
        params.get('deep_and_web') !== '1' || params.get('smtt') !== '9' ||
        !/^s40866222_ss_tw_webs_[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(params.get('utm_campaign') || '') ||
        params.get('utm_content') !== key || params.get('utm_medium') !== 'seller' ||
        params.get('utm_source') !== 'website' || seen.has(entry.url))
      fail('Shopee registry requires an exact supplied tracked link for: ' + key);
    seen.add(entry.url);
  }
}

function safeLink(value) {
  if (!value || unsafeUrlCharacters.test(value)) return false;
  if (value.startsWith('shopee:')) return true;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/') && !value.startsWith('//')) {
    try {
      const decoded = decodeURIComponent(value.split(/[?#]/u, 1)[0]);
      return !decoded.startsWith('//') && !decoded.includes('\\') && !controlCharacters.test(decoded) && !decoded.split('/').some((part) => part === '.' || part === '..');
    } catch { return false; }
  }
  try {
    const u = new URL(value);
    return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(u.protocol) && Boolean(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const brokenCjkBold = /(?<!\*)\*\*\p{Script=Han}[^*\r\n]{0,80}[：；！？。]\*\*(?=\p{Script=Han})/u;
// Inspect rendered text before markdown-it merges intentionally escaped characters/entities into text.
markdown.core.ruler.before('text_join', 'pandacat_cjk_bold', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const broken = token.children?.find((child) => child.type === 'text' && brokenCjkBold.test(child.content));
    if (broken) {
      const line = token.map ? '（內文第 ' + (token.map[0] + 1) + ' 行附近）' : '';
      fail((state.env.articleSource || 'Markdown') + line +
        '：偵測到未轉成粗體的 ** 標記。請在全形標點後的收尾 ** 和下一個中文字間加一個空格。');
    }
  }
});
const defaultImage = markdown.renderer.rules.image;
const defaultLink = markdown.renderer.rules.link_open;
markdown.validateLink = safeLink;
markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
  const image = tokens[idx].attrGet('src');
  if (!coverPattern.test(image || ''))
    fail('Markdown images must use a local /assets/blog/ file: ' + image);
  regular(image.slice(1));
  const alt = self.renderInlineAsText(tokens[idx].children || [], options, env);
  if (!alt.trim()) fail('Markdown images require nonempty alt text: ' + image);
  if (env.preview) tokens[idx].attrSet('src', '.' + image);
  return defaultImage(tokens, idx, options, env, self);
};
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  let href = tokens[idx].attrGet('href');
  if (href.startsWith('shopee:') || isShopeeUrl(href)) {
    const key = href.startsWith('shopee:') ? href.slice('shopee:'.length) :
      Object.keys(shopeeLinks).find((entry) => shopeeLinks[entry].url === href);
    if (!key) fail('Use a registered exact tracked Shopee URL or shopee:<key>');
    href = trackedShopee(key, 'Markdown');
    tokens[idx].attrSet('href', href);
    tokens[idx].attrSet('data-shopee-link', key);
  }
  if (env.preview && href.startsWith('/assets/')) tokens[idx].attrSet('href', '.' + href);
  else if (env.preview && href.startsWith('/')) tokens[idx].attrSet('href', origin + href);
  // Catch typoed article routes, including draft routes. Check syntax independent of external URL availability.
  if (!env.preview) {
    const url = new URL(href, origin);
    if (url.origin === origin && url.pathname.startsWith('/blog/') && url.pathname !== '/blog/') {
      const match = url.pathname.match(/^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/);
      if (!match || !env.publishedSlugs.has(match[1])) fail('Use an existing canonical article URL for internal Blog links: ' + href);
    }
  }
  return defaultLink ? defaultLink(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

function parsePost(filename) {
  const name = editorial + '/' + filename;
  const block = read(name).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---[ \t]*\n([\s\S]*)$/);
  if (!block) fail(name + ' requires YAML front matter delimited by --- and Markdown content');
  const document = parseDocument(block[1], { uniqueKeys: true, strict: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length)
    fail(name + ': ' + [...document.errors, ...document.warnings].map((problem) => problem.message).join('; '));
  const data = document.toJS({ maxAliasCount: 0 });
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(name + ' front matter must be a mapping');
  for (const key of Object.keys(data)) if (!fields.has(key)) fail(name + ' unknown front matter field: ' + key);
  const post = {};
  for (const key of fields) {
    if (Object.hasOwn(data, key)) {
      if (typeof data[key] !== 'string' || !data[key].trim() || controlCharacters.test(data[key]))
        fail(name + ' ' + key + ' must be nonempty, single-line text');
      post[key] = data[key].trim();
    }
  }
  for (const key of ['slug', 'title', 'description', 'status', 'category', 'author'])
    if (!post[key]) fail(name + ' is missing ' + key);
  if (!slugPattern.test(post.slug) || post.slug.length > 80 || filename !== post.slug + '.md' ||
      legacy.has(post.slug) || ['index', 'page'].includes(post.slug))
    fail(name + ' has invalid, reserved, or filename-mismatched slug: ' + post.slug);
  if (!['draft', 'published'].includes(post.status)) fail(name + ' status must be draft or published');
  if (post.status === 'published') {
    for (const key of ['publishedAt', 'cover', 'coverAlt'])
      if (!post[key]) fail(name + ' published article is missing ' + key);
  }
  if (post.publishedAt) date(post.publishedAt, name + ' publishedAt');
  if (post.updatedAt) {
    date(post.updatedAt, name + ' updatedAt');
    if (!post.publishedAt || post.updatedAt < post.publishedAt) fail(name + ' updatedAt must not be before publishedAt');
  }
  if (post.authorUrl && (!httpsUrl(post.authorUrl) || unsafeUrlCharacters.test(post.authorUrl)))
    fail(name + ' authorUrl must be a clean https:// URL without credentials');
  if (Boolean(post.cover) !== Boolean(post.coverAlt)) fail(name + ' requires cover and coverAlt together');
  if (post.cover) {
    if (!coverPattern.test(post.cover)) fail(name + ' cover must be a local /assets/blog/ image');
    regular(post.cover.slice(1));
  }
  if (!block[2].trim()) fail(name + ' has no Markdown body');
  const tokens = markdown.parse(block[2], { articleSource: name });
  if (tokens.some((token) => token.type === 'heading_open' && token.tag === 'h1'))
    fail(name + ' Markdown H1 is not allowed; title from metadata is the H1');
  return { ...post, markdown: block[2] };
}

function loadPosts() {
  const folder = pathFor(editorial);
  if (!existsSync(folder) || !lstatSync(folder).isDirectory() || realpathSync(folder) !== folder)
    fail('Expected real editorial directory: ' + editorial);
  return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.name.endsWith('.md'))
    .map((entry) => parsePost(entry.name))
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.slug.localeCompare(b.slug, 'en'));
}

function pageName(slug) { return 'blog/' + slug + '/index.html'; }

function listRoute(page) { return page === 1 ? '/blog/' : '/blog/page/' + page + '/'; }

function listPages(posts) {
  const cards = [
    ...posts,
    ...[...legacy].map(([slug, entry]) => ({ ...entry, slug, coverAlt: entry.title })),
  ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug, 'en'));
  return Array.from({ length: Math.max(1, Math.ceil(cards.length / pageSize)) }, (_, idx) => ({
    number: idx + 1,
    route: listRoute(idx + 1),
    file: listRoute(idx + 1).slice(1) + 'index.html',
    cards: cards.slice(idx * pageSize, (idx + 1) * pageSize),
  }));
}

function sitemap(posts, pagination) {
  const siteDate = '2025-12-29';
  const blogDate = [siteDate, ...posts.map((post) => post.updatedAt || post.publishedAt)].sort().at(-1);
  const entries = [[origin + '/', siteDate], [origin + '/blog/', blogDate],
    ...pagination.slice(1).map((page) => [origin + page.route]),
    ...[...legacy].map(([slug, entry]) => [canonical(slug), entry.publishedAt]),
    ...posts.map((post) => [canonical(post.slug), post.updatedAt || post.publishedAt])];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(([url, modified]) =>
      '  <url>\n    <loc>' + escape(url) + '</loc>\n' +
      (modified ? '    <lastmod>' + modified + '</lastmod>\n' : '') + '  </url>\n').join('') +
    '</urlset>\n';
}

function replaceRegion(source, startMarker, endMarker, html, indent) {
  if (source.split(startMarker).length !== 2 || source.split(endMarker).length !== 2)
    fail('blog/index.html needs exactly one start and end marker for ' + startMarker);
  const start = source.indexOf(startMarker) + startMarker.length;
  const end = source.indexOf(endMarker);
  if (end <= start) fail('blog/index.html has out-of-order markers for ' + startMarker);
  return source.slice(0, start) + '\n' + html + indent + source.slice(end);
}

function paginationMarkup(page, count) {
  if (count < 2) return '';
  const nav = (target, rel, label) =>
    '                <a href="' + listRoute(target) + '" rel="' + rel + '">' + label + '</a>\n';
  return '            <nav class="blog-pagination" aria-label="Blog 分頁">\n' +
    (page > 1 ? nav(page - 1, 'prev', '← 上一頁') : '') +
    '                <span aria-current="page">第 ' + page + '／' + count + ' 頁</span>\n' +
    (page < count ? nav(page + 1, 'next', '下一頁 →') : '') +
    '            </nav>\n';
}

function renderListing(source, page, count) {
  source = replaceRegion(source, cardsStart, cardsEnd, page.cards.map(renderCard).join(''), '                ');
  source = replaceRegion(source, pagerStart, pagerEnd, paginationMarkup(page.number, count), '            ');
  if (page.number === 1) return source;
  const suffix = '（第 ' + page.number + ' 頁）';
  const url = origin + page.route;
  return source
    .replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + marker)
    .replace('</title>', suffix + '</title>')
    .replace('href="' + origin + '/blog/"', 'href="' + url + '"')
    .replace('property="og:url" content="' + origin + '/blog/"', 'property="og:url" content="' + url + '"')
    .replace(/(property="og:title" content="[^"]*)"/u, '$1' + suffix + '"')
    .replace('"@type": "Blog"', '"@type": "CollectionPage"')
    .replace('"url": "' + origin + '/blog/"', '"url": "' + url + '"')
    .replace('>胖大喵 Blog</h1>', '>胖大喵 Blog' + suffix + '</h1>');
}

function orphanGenerated(expected) {
  const entries = readdirSync(pathFor('blog'), { withFileTypes: true });
  const articleOrphans = entries.flatMap((entry) => {
    if (!entry.isDirectory() || legacy.has(entry.name)) return [];
    const name = pageName(entry.name);
    if (!expected.has(name) && existsSync(pathFor(name)) && read(name).includes(marker)) return [name];
    return [];
  });
  const folder = pathFor('blog/page');
  if (!entries.some((entry) => entry.name === 'page')) return articleOrphans;
  if (!lstatSync(folder).isDirectory() || realpathSync(folder) !== folder) fail('Unsafe Blog pagination directory');
  const pageOrphans = readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) return [];
    const file = 'blog/page/' + entry.name + '/index.html';
    return !expected.has(file) && existsSync(pathFor(file)) && read(file).includes(marker) ? [file] : [];
  });
  return [...articleOrphans, ...pageOrphans];
}

function plan(posts) {
  const published = posts.filter((post) => post.status === 'published');
  const pagination = listPages(published);
  const publishedSlugs = new Set([...legacy.keys(), ...published.map((post) => post.slug)]);
  const sourceHtml = readdirSync(pathFor(editorial), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => editorial + '/' + entry.name);
  const expected = new Map([['sitemap.xml', sitemap(published, pagination)]]);
  for (const name of ['index.html', ...existingArticleHtml, ...sourceHtml]) {
    const source = read(name).replace(/\r\n/g, '\n');
    expected.set(name, syncShopeeHtml(source, name));
  }
  const listing = syncShopeeHtml(read('blog/index.html').replace(/\r\n/g, '\n'), 'blog/index.html');
  for (const page of pagination) {
    if (page.number > 1) {
      const path = pathFor(page.file);
      const parent = dirname(path);
      if (existsSync(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
        fail('Refusing to write to an unsafe Blog page directory: ' + parent);
      if (existsSync(path) && !read(page.file).includes(marker))
        fail('Refusing to overwrite an unmanaged Blog page: ' + page.file);
    }
    expected.set(page.file, renderListing(listing, page, pagination.length));
  }

  for (const post of published) {
    const name = pageName(post.slug);
    const path = pathFor(name);
    if (existsSync(path) && !read(name).includes(marker)) fail('Refusing to overwrite an unmanaged article: ' + name);
    const folder = dirname(path);
    if (existsSync(folder) && (!lstatSync(folder).isDirectory() || realpathSync(folder) !== folder))
      fail('Refusing to write to an unsafe article directory: ' + folder);
    try {
      const body = markdown.render(post.markdown, { publishedSlugs });
      expected.set(name, renderArticle(post, body));
    } catch (error) {
      fail(post.slug + ': ' + error.message);
    }
  }
  // Drafts are never written here; fail invalid image syntax early for all authoring states.
  for (const post of posts.filter((item) => item.status === 'draft')) {
    try {
      markdown.render(post.markdown, { preview: true });
    } catch (error) {
      fail(post.slug + ': ' + error.message);
    }
  }
  return { expected, orphan: orphanGenerated(expected), published, pagination };
}

function check(planData) {
  const { expected, orphan } = planData;
  const stale = [...expected].flatMap(([name, value]) => {
    if (!existsSync(pathFor(name))) return [name];
    return read(name).replace(/\r\n/g, '\n') !== value ? [name] : [];
  });
  if (stale.length || orphan.length)
    fail('Stale generated Blog output. Run npm run blog:build and review the diff.\n' +
      [...stale, ...orphan.map((name) => name + ' (withdrawn)')].join('\n'));
  return inspectPublic(planData.published, planData.pagination);
}

function build({ expected, orphan, published, pagination }) {
  inspectPublic(published, pagination, expected);
  for (const [name, value] of expected) {
    const path = pathFor(name);
    if (existsSync(path) && read(name).replace(/\r\n/g, '\n') === value) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, { flag: existsSync(path) ? 'w' : 'wx' });
  }
  for (const name of orphan) rmSync(regular(name));
  console.log('Blog generated: ' + published.length + ' Markdown article(s) published.');
}

function websiteFiles(published, pagination) {
  return [...stablePages, ...[...legacy.keys()].flatMap((slug) => ['blog/' + slug + '.html', pageName(slug)]),
    ...pagination.slice(1).map((page) => page.file),
    ...published.map((post) => pageName(post.slug))];
}

function elementList(node) {
  return [...(node.tagName ? [node] : []), ...(node.childNodes || []).flatMap(elementList)];
}

function attr(node, name) { return node.attrs?.find((item) => item.name === name)?.value; }
function classes(node) { return (attr(node, 'class') || '').split(/\s+/u); }
function textContent(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join('');
}

function syncShopeeHtml(source, name) {
  const edits = [];
  for (const node of elementList(parse(source, { sourceCodeLocationInfo: true }))) {
    if (node.tagName !== 'a') continue;
    const key = attr(node, 'data-shopee-link');
    const href = attr(node, 'href');
    if (!key) {
      if (isShopeeUrl(href) || href?.startsWith('shopee:')) fail(name + ' Shopee link requires data-shopee-link');
      continue;
    }
    const destination = trackedShopee(key, name);
    const location = node.sourceCodeLocation?.attrs?.href;
    if (!location) fail(name + ' registered Shopee anchor requires an href attribute');
    if (href !== destination) edits.push({ ...location, value: 'href="' + escape(destination) + '"' });
  }
  for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset))
    source = source.slice(0, edit.startOffset) + edit.value + source.slice(edit.endOffset);
  return source;
}

function inspectPublic(published, pagination, overrides = new Map()) {
  const assets = new Set();
  const lists = new Map(pagination.map((page) => [page.route, page]));
  const routes = new Map([
    ['/', 'index.html'], ...pagination.map((page) => [page.route, page.file]),
    ...[...legacy.keys()].flatMap((slug) => [
      ['/blog/' + slug + '/', pageName(slug)],
      ['/blog/' + slug + '.html', 'blog/' + slug + '.html'],
    ]),
    ...published.map((post) => ['/blog/' + post.slug + '/', pageName(post.slug)]),
  ]);
  const pages = new Map([...routes].map(([route, name]) => {
    const nodes = elementList(parse(overrides.get(name) ?? read(name)));
    return [route, { name, nodes, ids: new Set(nodes.map((n) => attr(n, 'id')).filter(Boolean)) }];
  }));
  const resources = new Set(['/style.css', '/robots.txt', '/sitemap.xml']);
  for (const resource of resources) regular(resource.slice(1));

  function addAsset(url, context) {
    if (!assetPattern.test(url.pathname)) fail(context + ' unsupported asset: ' + url.pathname);
    assets.add(url.pathname.slice(1));
    regular(url.pathname.slice(1));
  }

  function localReference(value, route, context) {
    if (!value) return;
    let url;
    try { url = new URL(value, origin + route); }
    catch { fail(context + ' invalid URL: ' + value); }
    if (url.origin !== origin) return;
    if (url.pathname.startsWith('/assets/')) {
      addAsset(url, context);
      return;
    }
    if (resources.has(url.pathname)) return;
    const target = pages.get(url.pathname);
    if (!target) fail(context + ' invalid internal link: ' + value + ' resolves to ' + url.pathname);
    if (url.hash) {
      let hash;
      try { hash = decodeURIComponent(url.hash.slice(1)); }
      catch { fail(context + ' invalid fragment: ' + value); }
      if (!target.ids.has(hash)) fail(context + ' missing anchor: ' + value);
    }
  }

  for (const [route, { name, nodes }] of pages) {
    const old = route.endsWith('.html');
    const canonicalUrl = old ? origin + route.slice(0, -5) + '/' : origin + route;
    const links = nodes.filter((node) => node.tagName === 'a');
    const canonicals = nodes.filter((node) => node.tagName === 'link' && attr(node, 'rel') === 'canonical');
    if (canonicals.length !== 1 || attr(canonicals[0], 'href') !== canonicalUrl)
      fail(name + ' must have one canonical pointing to ' + canonicalUrl);

    if (old) {
      const refresh = nodes.find((node) => node.tagName === 'meta' && (attr(node, 'http-equiv') || '').toLowerCase() === 'refresh');
      const destination = canonicalUrl.slice(origin.length);
      if (!refresh || attr(refresh, 'content') !== '0; url=' + destination ||
          !links.some((node) => attr(node, 'href') === destination))
        fail(name + ' legacy redirect and fallback must point to ' + destination);
    } else {
      const headings = nodes.filter((node) => node.tagName === 'h1');
      if (headings.length !== 1 || !textContent(headings[0]).trim())
        fail(name + ' must have one nonempty H1');
      const indexBlocked = nodes.some((node) => node.tagName === 'meta' &&
        ['robots', 'googlebot', 'bingbot', 'oai-searchbot'].includes((attr(node, 'name') || '').toLowerCase()) &&
        /(?:^|[\s,])(?:noindex|none)(?=$|[\s,])/iu.test(attr(node, 'content') || ''));
      if (indexBlocked) fail(name + ' public page must not contain a noindex or none robots directive');
      const html = nodes.find((node) => node.tagName === 'html');
      if (!/^zh-(?:TW|Hant(?:-TW)?)$/u.test(attr(html, 'lang') || ''))
        fail(name + ' must declare Traditional Chinese as the document language');
    }

    if (route.startsWith('/blog/') && !lists.has(route) && !old) {
      const back = links.filter((node) => classes(node).includes('blog-article__back') || /返回\s*Blog/u.test(textContent(node)));
      if (!back.length || back.some((node) => attr(node, 'href') !== '/blog/'))
        fail(name + ' back links must point to /blog/');
      const article = nodes.filter((node) => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json').map((script) => {
        try { return JSON.parse(textContent(script)); }
        catch { fail(name + ' has malformed JSON-LD'); }
      }).find((item) => item && ['Article', 'BlogPosting'].includes(item['@type']));
      if (!article?.headline) fail(name + ' is missing valid Article or BlogPosting structured data');
      const generated = published.find((post) => canonical(post.slug) === canonicalUrl);
      if (generated && (
        article['@type'] !== 'BlogPosting' || article.mainEntityOfPage?.['@id'] !== canonicalUrl ||
        article.headline !== generated.title || article.description !== generated.description ||
        article.datePublished !== generated.publishedAt || article.dateModified !== (generated.updatedAt || generated.publishedAt) ||
        article.author?.name !== generated.author || article.image?.[0] !== origin + generated.cover
      )) fail(name + ' BlogPosting must match the canonical article and front matter');
      if (generated) {
        const meta = (key) => nodes.find((node) => node.tagName === 'meta' &&
          (attr(node, 'property') || attr(node, 'name')) === key);
        const dates = nodes.filter((node) => node.tagName === 'time' && attr(node, 'datetime') === textContent(node))
          .map((node) => textContent(node));
        const byline = nodes.find((node) => classes(node).includes('blog-article__author'));
        if (
          textContent(nodes.find((node) => node.tagName === 'h1')) !== generated.title ||
          attr(meta('description'), 'content') !== generated.description ||
          attr(meta('og:url'), 'content') !== canonicalUrl || attr(meta('og:image'), 'content') !== origin + generated.cover ||
          !dates.includes(generated.publishedAt) || (generated.updatedAt && !dates.includes(generated.updatedAt)) ||
          !byline || textContent(byline) !== '作者：' + generated.author
        ) fail(name + ' H1, visible byline/dates, description and social metadata must match its front matter');
      }
    }

    const listing = lists.get(route);
    if (listing) {
      const ogUrl = nodes.filter((node) => node.tagName === 'meta' && attr(node, 'property') === 'og:url');
      if (ogUrl.length !== 1 || attr(ogUrl[0], 'content') !== canonicalUrl)
        fail(name + ' listing social URL must match its canonical');
      const actual = links.filter((node) => classes(node).includes('blog-card__link')).map((node) => {
        try { return new URL(attr(node, 'href'), origin + route).href; }
        catch { fail(name + ' has an invalid Blog card link'); }
      });
      const expected = listing.cards.map((post) => canonical(post.slug));
      if (actual.length !== expected.length || expected.some((url, index) => url !== actual[index]))
        fail(name + ' cards must link in date order to each expected article for this Blog page');
      const pager = nodes.filter((node) => node.tagName === 'nav' && classes(node).includes('blog-pagination'));
      if (pager.length !== (pagination.length > 1 ? 1 : 0)) fail(name + ' has invalid Blog pagination navigation');
      if (pager.length) {
        const controls = elementList(pager[0]);
        const current = controls.filter((node) => attr(node, 'aria-current') === 'page');
        const navLinks = controls.filter((node) => node.tagName === 'a');
        const expectedLinks = [
          ...(listing.number > 1 ? [['prev', listRoute(listing.number - 1)]] : []),
          ...(listing.number < pagination.length ? [['next', listRoute(listing.number + 1)]] : []),
        ];
        if (attr(pager[0], 'aria-label') !== 'Blog 分頁' || current.length !== 1 ||
            !textContent(current[0]).includes(listing.number + '／' + pagination.length) ||
            navLinks.length !== expectedLinks.length || expectedLinks.some(([rel, href], index) =>
              attr(navLinks[index], 'rel') !== rel || attr(navLinks[index], 'href') !== href))
          fail(name + ' has invalid or inaccessible Blog pagination links');
      }
    }

    for (const node of nodes) {
      const href = attr(node, 'href');
      const key = attr(node, 'data-shopee-link');
      if (node.tagName === 'a' && (key || isShopeeUrl(href) || href?.startsWith('shopee:')) &&
          (!key || href !== trackedShopee(key, name)))
        fail(name + ' Shopee link must exactly match its registry key');
      for (const key of ['href', 'src', 'poster']) localReference(attr(node, key), route, name);
      const srcset = attr(node, 'srcset');
      if (srcset) for (const candidate of srcset.split(',')) localReference(candidate.trim().split(/\s+/u)[0], route, name);
      if (node.tagName === 'meta' && ['og:image', 'twitter:image'].includes(attr(node, 'property') || attr(node, 'name')))
        localReference(attr(node, 'content'), route, name);
    }
  }

  for (const match of read('style.css').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/giu))
    localReference(match[1] || match[2] || match[3], '/style.css', 'style.css');

  return [...assets].sort();
}

function copy(name, destination) {
  const output = join(destination, name);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(regular(name), output);
}

function stage(planData) {
  const assets = check(planData);
  const names = websiteFiles(planData.published, planData.pagination);
  const out = pathFor('dist');
  if (existsSync(out) && (!lstatSync(out).isDirectory() || realpathSync(out) !== out))
    fail('Refusing to replace unsafe dist path');
  const temporary = mkdtempSync(pathFor('.blog-stage-'));
  try {
    for (const name of [...names, ...assets]) copy(name, temporary);
    rmSync(out, { recursive: true, force: true });
    renameSync(temporary, out);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log('Staged ' + names.length + ' public page/resource file(s) and ' + assets.length + ' referenced asset(s) in dist/.');
}

function preview(posts, slug, directory) {
  const post = posts.find((item) => item.slug === slug && item.status === 'draft');
  if (!post) fail('No draft found for slug: ' + slug);
  const safeTemp = realpathSync(tmpdir());
  if (!directory || !isAbsolute(directory)) fail('Provide an absolute OS temp preview directory (fresh or empty)');
  const output = resolve(directory);
  if (!inside(safeTemp, output) || output === root || inside(root, output) || inside(output, root))
    fail('Preview output must be outside the repository and under the OS temporary directory');
  const parent = dirname(output);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory() || realpathSync(parent) !== parent ||
      (existsSync(output) && (!lstatSync(output).isDirectory() || realpathSync(output) !== output || readdirSync(output).length)))
    fail('Preview output parent must be real; destination must be fresh or an empty real directory');
  const body = markdown.render(post.markdown, { preview: true });
  const assets = new Set(['assets/favicon.ico', 'assets/logo-header.png']);
  if (post.cover) assets.add(post.cover.slice(1));
  for (const match of body.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    if (!assetPattern.test('/' + match[1])) fail('Invalid preview asset ' + match[1]);
    assets.add(match[1]);
  }
  for (const name of assets) regular(name);
  mkdirSync(output, { recursive: true });
  for (const name of ['style.css', ...assets]) copy(name, output);
  writeFileSync(join(output, 'index.html'), renderArticle(post, body, true), { flag: 'wx' });
  console.log('Private, non-indexable preview: ' + join(output, 'index.html'));
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['build', 'check', 'stage', 'preview'].includes(command) || (command === 'preview' ? args.length !== 2 : args.length !== 0))
    fail('Usage: node scripts/blog.mjs build|check|stage OR preview <slug> <absolute-temp-directory>');
  verifyShopeeRegistry();
  const posts = loadPosts();
  if (command === 'preview') preview(posts, ...args);
  else {
    const data = plan(posts);
    if (command === 'build') build(data);
    else if (command === 'stage') stage(data);
    else {
      check(data);
      console.log('Blog check passed.');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
