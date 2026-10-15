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

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', secureHeaders())
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))

const jsonError = (message: string, status: 400 | 401 | 404 | 409 | 500 = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } })

const isAdmin = (request: Request, secret: string) => {
  const authorization = request.headers.get('authorization') || ''
  return Boolean(secret) && authorization === `Bearer ${secret}`
}

const requireAdmin = async (c: any, next: () => Promise<void>) => {
  if (!isAdmin(c.req.raw, c.env.ADMIN_SECRET_KEY)) return c.json({ error: 'Unauthorized' }, 401)
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
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
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
    const result = await c.env.DB.prepare(
      `INSERT INTO articles (title, slug, content_html, author) VALUES (?, ?, ?, ?)`
    ).bind(input.title, input.slug, input.content_html, input.author).run()
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
  const origin = new URL(c.req.url).origin
  return c.json({ url: `${origin}/media/${key}`, key }, 201)
})

app.get('/media/*', async (c) => {
  const key = c.req.path.slice('/media/'.length)
  const object = await c.env.MEDIA.get(key)
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
})

app.get('/sitemap.xml', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT slug, updated_at FROM articles ORDER BY created_at DESC').all<Pick<Article, 'slug' | 'updated_at'>>()
  const base = (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '')
  const urls = results.map((a) => `<url><loc>${xml(`${base}/${a.slug}`)}</loc><lastmod>${xml(a.updated_at)}</lastmod></url>`).join('')
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 200, { 'content-type': 'application/xml; charset=UTF-8' })
})

app.get('/robots.txt', (c) => {
  const base = (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '')
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/upload\nDisallow: /api/articles\nSitemap: ${base}/sitemap.xml\n`)
})

// Serve a server-side rendered homepage for search engines.
// The static public/index.html (JS-driven search) is served for real browsers by the ASSETS fallback.
app.get('/', async (c) => {
  const ua = c.req.header('user-agent') || ''
  const isBot = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|applebot/i.test(ua)
  if (!isBot) return c.env.ASSETS.fetch(c.req.raw).then(r => new Response(r.body, r))

  const base = (c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '')
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, slug, author, created_at FROM articles ORDER BY created_at DESC LIMIT 100'
  ).all<Omit<Article, 'content_html' | 'updated_at'>>()

  const articleItems = results.map(a =>
    `<li><a href="${base}/${encodeURIComponent(a.slug)}">${escapeHtml(a.title)}</a>${a.author ? ` <span>by ${escapeHtml(a.author)}</span>` : ''}</li>`
  ).join('')

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>beckzodiy.com</title><meta name="description" content="Writing and ideas from beckzodiy.com"><link rel="canonical" href="${base}/"><meta property="og:type" content="website"><meta property="og:title" content="beckzodiy.com"><meta property="og:description" content="Writing and ideas from beckzodiy.com"><meta property="og:url" content="${base}/"><meta property="og:site_name" content="beckzodiy.com"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="beckzodiy.com"><meta name="twitter:description" content="Writing and ideas from beckzodiy.com"><link rel="stylesheet" href="/styles.css"></head><body><header class="site-head"><a href="/">beckzodiy.com</a></header><main class="home"><h1>Articles</h1><ul>${articleItems}</ul></main></body></html>`
  return c.html(html)
})

app.get('/:slug', async (c, next) => {
  const slug = c.req.param('slug')
  if (slug.includes('.')) return next()
  const article = await getArticle(c.env.DB, slug)
  if (!article) return next()
  return c.html(articleDocument(article, c.env.SITE_URL || new URL(c.req.url).origin))
})

app.get('/admin1225', async (c) => {
  const url = new URL('/admin1225/', c.req.url)
  const asset = await c.env.ASSETS.fetch(new Request(url, c.req.raw))
  return new Response(asset.body, asset)
})

app.all('*', async (c) => {
  // Asset binding responses have immutable headers. Clone the response so
  // downstream Hono middleware (for example secureHeaders) can safely add to it.
  const asset = await c.env.ASSETS.fetch(c.req.raw)
  return new Response(asset.body, asset)
})

async function getArticle(db: D1Database, slug: string) {
  return db.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first<Article>()
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

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
}

function safeExtension(name: string, type: string) {
  const known: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' }
  return known[type] || name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'img'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!)
}

function xml(value: string) { return escapeHtml(value) }

function plainText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function firstImage(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] || ''
}

function articleDocument(article: Article, siteUrl: string) {
  const base = siteUrl.replace(/\/$/, '')
  const title = escapeHtml(article.title)
  const author = escapeHtml(article.author)
  const description = escapeHtml(plainText(article.content_html).slice(0, 160))
  const canonical = `${base}/${encodeURIComponent(article.slug)}`
  const image = firstImage(article.content_html)
  const publishedIso = article.created_at
  const modifiedIso = article.updated_at || article.created_at

  // JSON-LD Article schema for Google rich results
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: plainText(article.content_html).slice(0, 160),
    url: canonical,
    datePublished: publishedIso,
    dateModified: modifiedIso,
    author: article.author ? { '@type': 'Person', name: article.author } : { '@type': 'Organization', name: 'beckzodiy.com' },
    publisher: { '@type': 'Organization', name: 'beckzodiy.com', url: base },
    ...(image ? { image } : {}),
  })

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — beckzodiy.com</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="article"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="beckzodiy.com"><meta property="article:published_time" content="${publishedIso}"><meta property="article:modified_time" content="${modifiedIso}">${article.author ? `<meta property="article:author" content="${author}">` : ''}${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><script type="application/ld+json">${jsonLd}</script><script src="/theme.js"></script><link rel="stylesheet" href="/styles.css"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9358054569018430" crossorigin="anonymous"></script></head><body data-slug="${escapeHtml(article.slug)}"><header class="site-head"><a href="/">beckzodiy.com</a><button class="theme-toggle" data-theme-toggle aria-label="Switch color theme">☾</button></header><main class="article-shell"><article><h1>${title}</h1>${author ? `<p class="byline">${author}</p>` : ''}<div class="story">${article.content_html}</div></article></main></body></html>`
}

export default app
