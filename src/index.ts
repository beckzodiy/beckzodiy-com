import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

type Bindings = {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS: Fetcher
  ADMIN_SECRET_KEY: string
  SITE_URL?: string
}

type Article = {
  id: number
  title: string
  slug: string
  content_html: string
  author: string
  created_at: string
  updated_at: string
}

type ArticleSummary = Pick<Article, 'title' | 'slug' | 'author' | 'created_at'> & { excerpt_html: string }

const SITE_NAME = 'beckzodiy.com'
const SITE_DESCRIPTION = 'Writing and ideas from beckzodiy.com'
const PAGE_SIZE = 20
const RESERVED_SLUGS = new Set(['admin1225', 'api', 'media'])
const ADSENSE = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9358054569018430" crossorigin="anonymous"></script>'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', secureHeaders())

// One canonical host: send www traffic to the apex domain.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.hostname.startsWith('www.') && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
    url.hostname = url.hostname.slice(4)
    return c.redirect(url.toString(), 301)
  }
  await next()
})

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))

const jsonError = (message: string, status: 400 | 401 | 404 | 409 | 500 = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } })

async function isAdmin(request: Request, secret: string) {
  if (!secret) return false
  const encoder = new TextEncoder()
  // Compare fixed-length digests so the check does not leak the key through timing.
  const [given, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('authorization') || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${secret}`)),
  ])
  const a = new Uint8Array(given), b = new Uint8Array(expected)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const requireAdmin = async (c: any, next: () => Promise<void>) => {
  if (!(await isAdmin(c.req.raw, c.env.ADMIN_SECRET_KEY))) return c.json({ error: 'Unauthorized' }, 401)
  await next()
}

app.use('/api/upload', requireAdmin)
app.use('/api/admin/*', requireAdmin)
app.use('/api/articles', async (c, next) => c.req.method === 'GET' ? next() : requireAdmin(c, next))
app.use('/api/articles/*', async (c, next) => c.req.method === 'GET' ? next() : requireAdmin(c, next))

app.get('/api/articles', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, title, slug, author, created_at, updated_at FROM articles ORDER BY created_at DESC'
  ).all<Omit<Article, 'content_html'>>()
  return c.json({ articles: result.results })
})

app.get('/api/search', async (c) => {
  const query = (c.req.query('q') || '').trim().slice(0, 100)
  if (query.length < 2) return c.json({ articles: [] })
  const pattern = likePattern(query)
  const result = await c.env.DB.prepare(
    `SELECT id, title, slug, author, created_at, updated_at
     FROM articles
     WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR content_html LIKE ? ESCAPE '\\'
     ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 30`
  ).bind(pattern, pattern, pattern, pattern).all<Omit<Article, 'content_html'>>()
  return c.json({ articles: result.results, query })
})

app.get('/api/admin/session', (c) => c.json({ authenticated: true }))

app.get('/api/articles/:slug', async (c) => {
  const article = await getArticle(c.env.DB, c.req.param('slug'))
  return article ? c.json({ article }) : c.json({ error: 'Article not found' }, 404)
})

app.post('/api/articles', async (c) => {
  const input = await readArticleInput(c.req.raw)
  if ('error' in input) return jsonError(input.error)
  try {
    const slug = await availableSlug(c.env.DB, input.slug)
    const result = await c.env.DB.prepare(
      `INSERT INTO articles (title, slug, content_html, author) VALUES (?, ?, ?, ?)`
    ).bind(input.title, slug, input.content_html, input.author).run()
    const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(result.meta.last_row_id).first<Article>()
    return c.json({ article }, 201)
  } catch (error) {
    return jsonError(String(error).includes('UNIQUE') ? 'That slug is already in use' : 'Unable to create article', String(error).includes('UNIQUE') ? 409 : 500)
  }
})

app.put('/api/articles/:slug', async (c) => {
  const currentSlug = c.req.param('slug')
  const input = await readArticleInput(c.req.raw)
  if ('error' in input) return jsonError(input.error)
  try {
    const result = await c.env.DB.prepare(
      `UPDATE articles SET title = ?, slug = ?, content_html = ?, author = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = ?`
    ).bind(input.title, input.slug, input.content_html, input.author, currentSlug).run()
    if (!result.meta.changes) return jsonError('Article not found', 404)
    return c.json({ article: await getArticle(c.env.DB, input.slug) })
  } catch (error) {
    return jsonError(String(error).includes('UNIQUE') ? 'That slug is already in use' : 'Unable to update article', String(error).includes('UNIQUE') ? 409 : 500)
  }
})

app.delete('/api/articles/:slug', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM articles WHERE slug = ?').bind(c.req.param('slug')).run()
  return result.meta.changes ? c.body(null, 204) : c.json({ error: 'Article not found' }, 404)
})

app.post('/api/upload', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'A file field is required' }, 400)
  if (!file.type.startsWith('image/')) return c.json({ error: 'Only images are allowed' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Images must be 10 MB or smaller' }, 400)
  const extension = safeExtension(file.name, file.type)
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name } })
  // Root-relative so images keep working on every hostname the Worker is served from.
  return c.json({ url: `/media/${key}`, key }, 201)
})

app.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.slice('/media/'.length))
  const object = await c.env.MEDIA.get(key)
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  // Uploaded files (SVG in particular) must never run script on this origin.
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  if (c.req.header('if-none-match') === object.httpEtag) return new Response(null, { status: 304, headers })
  return new Response(object.body, { headers })
})

app.get('/sitemap.xml', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT slug, updated_at FROM articles ORDER BY created_at DESC').all<Pick<Article, 'slug' | 'updated_at'>>()
  const base = siteBase(c)
  const home = `<url><loc>${xml(`${base}/`)}</loc>${results[0] ? `<lastmod>${xml(results[0].updated_at)}</lastmod>` : ''}</url>`
  const urls = results.map((a) => `<url><loc>${xml(`${base}/${encodeURIComponent(a.slug)}`)}</loc><lastmod>${xml(a.updated_at)}</lastmod></url>`).join('')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${home}${urls}</urlset>`, 200, { 'content-type': 'application/xml; charset=UTF-8' })
})

app.get('/feed.xml', async (c) => {
  const base = siteBase(c)
  const { results } = await c.env.DB.prepare(
    'SELECT title, slug, author, created_at, substr(content_html, 1, 1200) AS excerpt_html FROM articles ORDER BY created_at DESC LIMIT 30'
  ).all<ArticleSummary>()
  const items = results.map((a) => {
    const link = xml(`${base}/${encodeURIComponent(a.slug)}`)
    return `<item><title>${xml(a.title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(a.created_at).toUTCString()}</pubDate>${a.author ? `<dc:creator>${xml(a.author)}</dc:creator>` : ''}<description>${xml(excerpt(a.excerpt_html, 300))}</description></item>`
  }).join('')
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${SITE_NAME}</title><link>${xml(base)}/</link><description>${xml(SITE_DESCRIPTION)}</description><atom:link href="${xml(base)}/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`,
    200,
    { 'content-type': 'application/rss+xml; charset=UTF-8', 'cache-control': 'public, max-age=600' }
  )
})

app.get('/robots.txt', (c) => {
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteBase(c)}/sitemap.xml\n`)
})

// Home: the same server-rendered page for people and crawlers — latest articles, search and paging.
app.get('/', async (c) => {
  const base = siteBase(c)
  const query = (c.req.query('q') || '').trim().slice(0, 100)
  const searching = query.length >= 2
  const page = Math.min(Math.max(parseInt(c.req.query('page') || '1', 10) || 1, 1), 500)
  const offset = (page - 1) * PAGE_SIZE
  const columns = 'title, slug, author, created_at, substr(content_html, 1, 1200) AS excerpt_html'

  let rows: ArticleSummary[]
  if (searching) {
    const pattern = likePattern(query)
    rows = (await c.env.DB.prepare(
      `SELECT ${columns} FROM articles
       WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR content_html LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(pattern, pattern, pattern, pattern, PAGE_SIZE + 1, offset).all<ArticleSummary>()).results
  } else {
    rows = (await c.env.DB.prepare(
      `SELECT ${columns} FROM articles ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(PAGE_SIZE + 1, offset).all<ArticleSummary>()).results
  }

  const hasNext = rows.length > PAGE_SIZE
  const articles = rows.slice(0, PAGE_SIZE)
  const pageUrl = (n: number) => {
    const params = new URLSearchParams()
    if (searching) params.set('q', query)
    if (n > 1) params.set('page', String(n))
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  }

  const list = articles.map((a) => {
    const summary = excerpt(a.excerpt_html, 170)
    return `<a class="card" href="/${encodeURIComponent(a.slug)}"><h2>${escapeHtml(a.title)}</h2>${summary ? `<p class="excerpt">${escapeHtml(summary)}</p>` : ''}<p class="article-meta">${escapeHtml(a.author || 'Anonymous')} · ${timeTag(a.created_at)}</p></a>`
  }).join('')
  const empty = searching
    ? `<p class="muted empty">No articles found for “${escapeHtml(query)}”. <a href="/">See all articles</a></p>`
    : '<p class="muted empty">Nothing published yet.</p>'
  const pager = page > 1 || hasNext
    ? `<nav class="pager" aria-label="Pagination">${page > 1 ? `<a rel="prev" href="${escapeHtml(pageUrl(page - 1))}">← Newer</a>` : '<span></span>'}${hasNext ? `<a rel="next" href="${escapeHtml(pageUrl(page + 1))}">Older →</a>` : ''}</nav>`
    : ''
  const heading = searching ? `Results for “${escapeHtml(query)}”` : page > 1 ? `Articles · page ${page}` : 'Latest'

  const body = `<main class="home"><section class="hero"><h1 class="wordmark">beckzodiy</h1><p>Search stories and ideas</p><form class="search search-large" action="/" method="get" role="search"><span aria-hidden="true">⌕</span><input type="search" name="q" value="${escapeHtml(query)}" placeholder="Search ${SITE_NAME}" aria-label="Search articles" autocomplete="off" minlength="2"><button type="submit">Search</button></form></section><section class="article-list"><p class="section-label">${heading}</p>${list || empty}${pager}</section></main>`

  return c.html(layout({
    title: searching ? `${query} — ${SITE_NAME}` : page > 1 ? `Articles, page ${page} — ${SITE_NAME}` : SITE_NAME,
    description: SITE_DESCRIPTION,
    canonical: `${base}${searching ? '/' : pageUrl(page)}`,
    robots: searching ? 'noindex, follow' : undefined,
    head: `<meta property="og:type" content="website"><meta name="twitter:card" content="summary">${
      !searching && page === 1 ? `<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${base}/`, potentialAction: { '@type': 'SearchAction', target: `${base}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' } })}</script>` : ''
    }`,
    body,
  }))
})

app.get('/admin1225', async (c) => {
  const url = new URL('/admin1225/', c.req.url)
  const asset = await c.env.ASSETS.fetch(new Request(url, c.req.raw))
  return new Response(asset.body, asset)
})

app.get('/:slug', async (c, next) => {
  const slug = c.req.param('slug')
  if (slug.includes('.') || RESERVED_SLUGS.has(slug)) return next()
  const article = await getArticle(c.env.DB, slug)
  if (!article) return next()
  return c.html(articleDocument(article, siteBase(c)))
})

app.all('*', async (c) => {
  // Asset binding responses have immutable headers. Clone the response so
  // downstream Hono middleware (for example secureHeaders) can safely add to it.
  const asset = await c.env.ASSETS.fetch(c.req.raw)
  if (asset.status === 404) return c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.html(notFoundDocument(), 404)
  return new Response(asset.body, asset)
})

function siteBase(c: { env: Bindings; req: { url: string } }) {
  return (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '')
}

async function getArticle(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first<Article>()
}

// Two articles may share a title: add -2, -3, … instead of rejecting the second one.
async function availableSlug(db: D1Database, slug: string) {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? slug : `${slug.slice(0, 96)}-${n}`
    if (RESERVED_SLUGS.has(candidate)) continue
    const taken = await db.prepare('SELECT 1 AS taken FROM articles WHERE slug = ?').bind(candidate).first()
    if (!taken) return candidate
  }
  return `${slug.slice(0, 90)}-${crypto.randomUUID().slice(0, 8)}`
}

async function readArticleInput(request: Request): Promise<Omit<Article, 'id' | 'created_at' | 'updated_at'> | { error: string }> {
  let body: any
  try { body = await request.json() } catch { return { error: 'Expected a JSON request body' } }
  const title = String(body.title || '').trim().slice(0, 200)
  const author = String(body.author || '').trim().slice(0, 120)
  const content_html = String(body.content_html || '').trim()
  const slug = slugify(String(body.slug || title))
  if (!title) return { error: 'Title is required' }
  if (!slug) return { error: 'A valid slug is required' }
  if (content_html.length > 1_000_000) return { error: 'Article content is too large' }
  return { title, author, content_html, slug }
}

// Keeps letters and digits from any script, so non-Latin titles still get a readable URL.
function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/([a-z])[\u0300-\u036f]+/g, '$1').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '')
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}

function safeExtension(name: string, type: string) {
  const known: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' }
  return known[type] || name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'img'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!)
}

function xml(value: string) { return escapeHtml(value) }

// JSON for an inline <script>: "<" is escaped so article text can never close the tag.
function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

function plainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*$/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function excerpt(html: string, length: number) {
  const text = plainText(html)
  if (text.length <= length) return text
  const cut = text.slice(0, length)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), length - 30)).replace(/[\s.,;:!?-]+$/, '')}…`
}

function firstImage(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] || ''
}

function timeTag(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `<time datetime="${escapeHtml(iso)}">${label}</time>`
}

// The first image is likely above the fold; every later one loads lazily.
function lazyImages(html: string) {
  let index = 0
  return html.replace(/<img\b(?![^>]*\bloading=)/gi, (tag) => index++ === 0 ? `${tag} decoding="async"` : `${tag} loading="lazy" decoding="async"`)
}

function layout(options: { title: string; description: string; canonical?: string; robots?: string; head?: string; body: string }) {
  const title = escapeHtml(options.title)
  const description = escapeHtml(options.description)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}">${options.robots ? `<meta name="robots" content="${options.robots}">` : ''}${options.canonical ? `<link rel="canonical" href="${escapeHtml(options.canonical)}"><meta property="og:url" content="${escapeHtml(options.canonical)}">` : ''}<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:site_name" content="${SITE_NAME}"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">${options.head || ''}<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="/feed.xml"><script src="/theme.js"></script><script src="/fx3d.js" defer></script><link rel="stylesheet" href="/styles.css">${ADSENSE}</head><body><header class="site-head"><a href="/">${SITE_NAME}</a><button class="theme-toggle" data-theme-toggle aria-label="Switch color theme">☾</button></header>${options.body}<footer class="site-foot"><span>© ${new Date().getUTCFullYear()} ${SITE_NAME}</span><a href="/feed.xml">RSS</a></footer></body></html>`
}

function notFoundDocument() {
  return layout({
    title: `Page not found — ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    robots: 'noindex',
    body: '<main class="home not-found"><h1>Page not found</h1><p class="muted">That page does not exist or has been removed.</p><p><a class="back-link" href="/">← All articles</a></p></main>',
  })
}

function articleDocument(article: Article, base: string) {
  const author = escapeHtml(article.author)
  const text = plainText(article.content_html)
  const description = excerpt(article.content_html, 160) || article.title
  const canonical = `${base}/${encodeURIComponent(article.slug)}`
  const rawImage = firstImage(article.content_html)
  const image = rawImage ? new URL(rawImage.replace(/&amp;/g, '&'), `${base}/`).toString() : ''
  const publishedIso = article.created_at
  const modifiedIso = article.updated_at || article.created_at
  const minutes = Math.max(1, Math.round(text.split(' ').filter(Boolean).length / 220))

  const structured = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description,
    url: canonical,
    mainEntityOfPage: canonical,
    datePublished: publishedIso,
    dateModified: modifiedIso,
    author: article.author ? { '@type': 'Person', name: article.author } : { '@type': 'Organization', name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: base },
    ...(image ? { image } : {}),
  })

  const head = `<meta property="og:type" content="article"><meta property="article:published_time" content="${escapeHtml(publishedIso)}"><meta property="article:modified_time" content="${escapeHtml(modifiedIso)}">${article.author ? `<meta property="article:author" content="${author}">` : ''}${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:image" content="${escapeHtml(image)}">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><script type="application/ld+json">${structured}</script>`
  const byline = [author, timeTag(publishedIso), `${minutes} min read`].filter(Boolean).join(' · ')
  const body = `<main class="article-shell"><article><h1>${escapeHtml(article.title)}</h1><p class="byline">${byline}</p><div class="story">${lazyImages(article.content_html)}</div></article><nav class="article-actions"><a class="back-link" href="/">← All articles</a></nav></main>`

  return layout({ title: `${article.title} — ${SITE_NAME}`, description, canonical, head, body })
}

export default app
