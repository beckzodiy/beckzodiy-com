// Worker in front of the static site.
//   POST /api/hit  – the page reports a visit (IP comes from Cloudflare's CF-Connecting-IP header)
//   GET  /admin    – password-protected stats (Basic auth, password = ADMIN_PASSWORD secret)
// Everything else is served from ./public as before.
import { DurableObject } from 'cloudflare:workers'

const KEEP_DAYS = 90 // older visits are deleted
const TZ = '+4 hours' // Dubai, for "per day" grouping
const ADMIN_COOKIE = 'bz_admin' // set when you open /admin, so your own visits are not counted

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, ip TEXT NOT NULL, path TEXT, ref TEXT, ua TEXT)`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_ts ON visits(ts)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_ip ON visits(ip)')
  }

  hit({ ip, path, ref, ua }) {
    const now = Date.now()
    this.sql.exec('INSERT INTO visits (ts, ip, path, ref, ua) VALUES (?, ?, ?, ?, ?)', now, ip, path, ref, ua)
    if (Math.random() < 0.02) this.sql.exec('DELETE FROM visits WHERE ts < ?', now - KEEP_DAYS * 864e5)
  }

  stats(ip) {
    const now = Date.now()
    const q = (s, ...a) => this.sql.exec(s, ...a).toArray()
    const one = (s, ...a) => this.sql.exec(s, ...a).one()
    const range = ms => one('SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits WHERE ts >= ?', now - ms)
    return {
      all: one('SELECT COUNT(*) AS views, COUNT(DISTINCT ip) AS ips FROM visits'),
      d1: range(864e5),
      d7: range(7 * 864e5),
      d30: range(30 * 864e5),
      days: q(`SELECT date(ts / 1000, 'unixepoch', '${TZ}') AS day, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips
               FROM visits WHERE ts >= ? GROUP BY day ORDER BY day`, now - 30 * 864e5),
      ips: q(`SELECT ip, COUNT(*) AS views, MIN(ts) AS first, MAX(ts) AS last
              FROM visits GROUP BY ip ORDER BY last DESC LIMIT 300`),
      refs: q(`SELECT ref, COUNT(*) AS views FROM visits WHERE ref <> '' GROUP BY ref ORDER BY views DESC LIMIT 20`),
      recent: ip
        ? q('SELECT ts, ip, path, ref, ua FROM visits WHERE ip = ? ORDER BY id DESC LIMIT 300', ip)
        : q('SELECT ts, ip, path, ref, ua FROM visits ORDER BY id DESC LIMIT 100'),
    }
  }
}

const stub = env => env.STATS.get(env.STATS.idFromName('main'))
const cut = (s, n) => String(s || '').slice(0, n)
const hasCookie = (req, name) => (req.headers.get('Cookie') || '').split(/;\s*/).some(c => c.startsWith(name + '='))

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    if (url.pathname === '/api/hit') {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      if (!hasCookie(req, ADMIN_COOKIE)) {
        let body = {}
        try { body = JSON.parse(cut(await req.text(), 2000)) } catch {}
        let ref = cut(body.ref, 300)
        try { if (ref && new URL(ref).hostname.endsWith(url.hostname.replace(/^www\./, ''))) ref = '' } catch { ref = '' }
        await stub(env).hit({
          ip: req.headers.get('CF-Connecting-IP') || 'unknown',
          path: cut(body.path, 200) || '/',
          ref,
          ua: cut(req.headers.get('User-Agent'), 300),
        })
      }
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN_PASSWORD) return new Response('Admin is off: set the ADMIN_PASSWORD secret in Cloudflare.', { status: 503 })
      if (!(await authorized(req, env.ADMIN_PASSWORD))) {
        return new Response('Login required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="beckzodiy admin", charset="UTF-8"' } })
      }
      const ip = cut(url.searchParams.get('ip'), 64) || null
      const html = page(await stub(env).stats(ip), ip)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
          'Set-Cookie': `${ADMIN_COOKIE}=1; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`,
        },
      })
    }

    return env.ASSETS.fetch(req)
  },
}

async function authorized(req, password) {
  const h = req.headers.get('Authorization') || ''
  if (!h.startsWith('Basic ')) return false
  let given = ''
  try { given = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0))) } catch { return false }
  given = given.slice(given.indexOf(':') + 1) // any username, only the password matters
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([given, password].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))))
  return crypto.subtle.timingSafeEqual(a, b)
}

// ---------- admin page ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const when = ts => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })
function device(ua) {
  ua = ua || ''
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Telegram/i.test(ua) ? 'Telegram' : /Instagram/.test(ua) ? 'Instagram' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '?'
  return `${br} · ${os}`
}

function page(s, ip) {
  const max = Math.max(1, ...s.days.map(d => d.views))
  const tile = (t, v) => `<div class="tile"><small>${t}</small><b>${v.views}</b><span>${v.ips} unique IPs</span></div>`
  const bars = s.days.map(d => `<div class="bar" title="${d.day}: ${d.views} views, ${d.ips} IPs"><i style="height:${(d.views / max) * 100}%"></i><em>${d.day.slice(5)}</em></div>`).join('')
  const ipRows = s.ips.map(r => `<tr><td><a href="/admin?ip=${encodeURIComponent(r.ip)}">${esc(r.ip)}</a></td><td>${r.views}</td><td>${when(r.first)}</td><td>${when(r.last)}</td></tr>`).join('')
  const recent = s.recent.map(r => `<tr><td>${when(r.ts)}</td><td><a href="/admin?ip=${encodeURIComponent(r.ip)}">${esc(r.ip)}</a></td><td title="${esc(r.ua)}">${esc(device(r.ua))}</td><td class="ref">${esc(r.ref) || '—'}</td></tr>`).join('')
  const refs = s.refs.map(r => `<tr><td class="ref">${esc(r.ref)}</td><td>${r.views}</td></tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Admin · beckzodiy.com</title><style>
:root{color-scheme:dark;--bg:#04050c;--card:#0c1020;--line:#1c2340;--txt:#e6e9f5;--mut:#8890b0;--acc:#2fe6a7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;padding:24px;max-width:1100px;margin:auto}
h1{font-size:20px;margin:0 0 18px}h2{font-size:15px;margin:28px 0 10px;color:var(--mut);font-weight:600}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.tile small{color:var(--mut);display:block}.tile b{font-size:28px;display:block}.tile span{color:var(--mut);font-size:12px}
.chart{display:flex;align-items:flex-end;gap:3px;height:160px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 12px 26px}
.bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;position:relative}
.bar i{display:block;background:var(--acc);border-radius:3px 3px 0 0;min-height:2px}
.bar em{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%) rotate(-45deg);font-size:9px;color:var(--mut);font-style:normal;white-space:nowrap}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--mut);font-weight:600}td.ref{max-width:360px;overflow:hidden;text-overflow:ellipsis}tr:last-child td{border-bottom:0}
.empty{color:var(--mut);padding:14px}
</style></head><body>
<h1>beckzodiy.com · visitors</h1>
${ip ? `<p>Showing visits from <b>${esc(ip)}</b> · <a href="/admin">back to all</a></p>` : `
<div class="tiles">${tile('Last 24 hours', s.d1)}${tile('Last 7 days', s.d7)}${tile('Last 30 days', s.d30)}${tile(`All time (${KEEP_DAYS}-day log)`, s.all)}</div>
<h2>Views per day (Dubai time)</h2>
${s.days.length ? `<div class="chart">${bars}</div>` : '<div class="wrap empty">No visits yet.</div>'}
<h2>IP addresses (${s.ips.length}${s.ips.length === 300 ? '+' : ''})</h2>
<div class="wrap">${ipRows ? `<table><tr><th>IP</th><th>Views</th><th>First seen</th><th>Last seen</th></tr>${ipRows}</table>` : '<div class="empty">No visits yet.</div>'}</div>
<h2>Where they came from (referrers)</h2>
<div class="wrap">${refs ? `<table><tr><th>Referrer</th><th>Views</th></tr>${refs}</table>` : '<div class="empty">No referrers yet (direct visits only).</div>'}</div>`}
<h2>${ip ? 'Visits' : 'Latest visits'}</h2>
<div class="wrap">${recent ? `<table><tr><th>Time</th><th>IP</th><th>Device</th><th>Referrer</th></tr>${recent}</table>` : '<div class="empty">Nothing yet.</div>'}</div>
<p style="color:var(--mut);margin-top:24px;font-size:12px">Your own visits are not counted on this browser.</p>
</body></html>`
}
