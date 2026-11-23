export const origin = 'https://pandacat.com.tw';
export const marker = '<!-- pandacat:blog-generated -->';
export const cardsStart = '<!-- pandacat:blog-cards:start -->';
export const cardsEnd = '<!-- pandacat:blog-cards:end -->';
export const canonical = (slug) => `${origin}/blog/${slug}/`;
export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/[<>&\u2028\u2029]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const brandAuthors = new Set(['胖大喵', '胖大喵 Pandacat', '胖大喵編輯部']);
const publisher = { '@type': 'Organization', name: '胖大喵 Pandacat', url: origin + '/' };

export function renderArticle(post, body, preview = false) {
  const { title, description, category, author, authorUrl, cover, coverAlt, publishedAt, updatedAt, slug } = post;
  const e = escape;
  const url = canonical(slug);
  const titleTag = `${title}｜胖大喵`;
  const authorDisplay = authorUrl ? `<a href="${e(authorUrl)}">${e(author)}</a>` : e(author);
  const date = publishedAt ? `\n        <span>發布：<time datetime="${publishedAt}">${publishedAt}</time></span>` : '';
  const updated = updatedAt && updatedAt !== publishedAt ?
    `\n        <span>更新：<time datetime="${updatedAt}">${updatedAt}</time></span>` : '';
  const image = cover ? `<figure class="article-image"><img src="${preview ? '.' : ''}${e(cover)}" alt="${e(coverAlt)}"></figure>` : '';
  const previewNote = preview ? '<p role="note"><strong>內部草稿預覽，尚未發布。</strong></p>\n      ' : '';
  const metadata = preview ? '<meta name="robots" content="noindex, nofollow">' :
    `<link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="zh_TW">
  <meta property="og:site_name" content="胖大喵 Pandacat">
  <meta property="og:title" content="${e(titleTag)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${origin}${e(cover)}">
  <meta property="og:image:alt" content="${e(coverAlt)}">
  <meta property="article:published_time" content="${publishedAt}">${updatedAt ?
    `\n  <meta property="article:modified_time" content="${updatedAt}">` : ''}
  <script type="application/ld+json">
${jsonForScript({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': url + '#article',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: title,
    description,
    image: [origin + cover],
    datePublished: publishedAt,
    dateModified: updatedAt || publishedAt,
    author: { '@type': brandAuthors.has(author) ? 'Organization' : 'Person', name: author, ...(authorUrl ? { url: authorUrl } : brandAuthors.has(author) ? { url: publisher.url } : {}) },
    publisher,
    inLanguage: 'zh-Hant',
  })}
  </script>`;
  const local = preview ? '.' : '';
  const analyticsHead = preview ? '' : `
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
  var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!=='dataLayer'?'&l='+l:'';j.async=true;
  j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-PQG5SMQQ');</script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-69346X9ZKE"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
  gtag('js',new Date());gtag('config','G-69346X9ZKE');</script>`;
  const analyticsBody = preview ? '' : `
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PQG5SMQQ" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
  const navigation = preview ? '' : `
      <nav aria-label="主要導航"><a class="header__nav-link active" href="/blog/">Blog</a></nav>`;
  const back = `
        <a href="${preview ? origin : ''}/blog/" class="blog-article__back">${preview ? '瀏覽正式 Blog ↗' : '← 返回 Blog'}</a>`;
  return `<!doctype html>
${marker}
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${preview ? '[草稿] ' : ''}${e(titleTag)}</title>
  <meta name="description" content="${e(description)}">
  ${metadata}
  <link rel="icon" href="${local}/assets/favicon.ico">
  <link rel="stylesheet" href="${local}/style.css">${analyticsHead}
</head>
<body>${analyticsBody}
  <header class="header" id="header">
    <div class="container header__inner">
      <a class="header__logo" href="${preview ? '#' : '/'}" aria-label="胖大喵首頁">
        <img src="${local}/assets/logo-header.png" alt="胖大喵 Pandacat Logo" width="220" height="56">
      </a>${navigation}
    </div>
  </header>
  <main class="blog-article blog-article--generated">
    <div class="container">
      <div class="blog-article__meta">${back}
        <div class="blog-article__info">
          <span class="blog-article__category">${e(category)}</span>
          <span class="blog-article__author">作者：${authorDisplay}</span>${date}${updated}
        </div>
      </div>
      <article class="blog-content">
      ${previewNote}<h1>${e(title)}</h1>
      ${image}
${body.trimEnd()}
      </article>
    </div>
  </main>
</body>
</html>
`;
}

export function renderCard(post) {
  const e = escape;
  const tags = post.tags?.length ? '\n                            <div class="blog-card__tags">\n' +
    post.tags.map((tag) => '                                <span class="blog-card__tag">' + e(tag) + '</span>\n').join('') +
    '                            </div>' : '';
  return `                <article class="blog-card">
                    <a href="/blog/${post.slug}/" class="blog-card__link">
                        <div class="blog-card__image">
                            <img src="${e(post.cover)}" alt="${e(post.coverAlt)}" loading="lazy">
                        </div>
                        <div class="blog-card__content">
                            <div class="blog-card__meta">
                                <span class="blog-card__category">${e(post.category)}</span>
                                <time class="blog-card__date" datetime="${post.publishedAt}">${post.publishedAt}</time>
                            </div>
                            <h2 class="blog-card__title">${e(post.title)}</h2>
                            <p class="blog-card__summary">${e(post.description)}</p>${tags}
                        </div>
                    </a>
                </article>
`;
}
