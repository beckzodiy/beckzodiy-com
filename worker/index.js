// Worker in front of the static site.
//   POST /api/hit      – the page reports a visit (IP comes from Cloudflare's CF-Connecting-IP header)
//   POST /api/update   – how far the visitor scrolled and whether they turned sound on
//   POST /api/consent  – answer to the consent banner (shown only in CONSENT_COUNTRIES)
//   GET  /admin        – password-protected stats (Basic auth, password = ADMIN_PASSWORD secret)
// Everything else is served from ./public as before.
import { DurableObject } from 'cloudflare:workers'

const KEEP_DAYS = 90 // older visits are deleted
const TZ = '+4 hours' // Dubai, for "per day" grouping
const ADMIN_COOKIE = 'bz_admin' // set when you open /admin, so your own visits are not counted
const CONSENT_COOKIE = 'bz_consent' // 'yes' or 'no'
// Visitors from these countries (by Cloudflare's IP lookup) must say OK before anything is stored.
// Add more two-letter codes here, or use ['*'] to ask everyone.
const CONSENT_COUNTRIES = ['AE']

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, ip TEXT NOT NULL, path TEXT, ref TEXT, ua TEXT)`)
    for (const col of ['vid TEXT', 'scroll INTEGER', 'sound INTEGER']) {
      try { this.sql.exec(`ALTER TABLE visits ADD COLUMN ${col}`) } catch {} // already there
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_ts ON visits(ts)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_ip ON visits(ip)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS visits_vid ON visits(vid)')
  }

  hit({ vid, ip, path, ref, ua }) {
    const now = Date.now()
    this.sql.exec('INSERT INTO visits (ts, vid, ip, path, ref, ua, scroll, sound) VALUES (?, ?, ?, ?, ?, ?, 0, 0)', now, vid, ip, path, ref, ua)
    if (Math.random() < 0.02) this.sql.exec('DELETE FROM visits WHERE ts < ?', now - KEEP_DAYS * 864e5)
  }

  update({ vid, scroll, sound }) {
    this.sql.exec(
      'UPDATE visits SET scroll = MAX(COALESCE(scroll, 0), ?), sound = MAX(COALESCE(sound, 0), ?) WHERE vid = ? AND ts > ?',
      scroll, sound, vid, Date.now() - 864e5,
    )
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
      // only visits recorded since scroll/sound tracking started (scroll is NULL on older rows)
      eng: one(`SELECT COUNT(*) AS n, AVG(scroll) AS avg, SUM(scroll >= 90) AS done, SUM(sound) AS snd
                FROM visits WHERE ts >= ? AND scroll IS NOT NULL`, now - 30 * 864e5),
      days: q(`SELECT date(ts / 1000, 'unixepoch', '${TZ}') AS day, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips
               FROM visits WHERE ts >= ? GROUP BY day ORDER BY day`, now - 30 * 864e5),
      ips: q(`SELECT ip, COUNT(*) AS views, MIN(ts) AS first, MAX(ts) AS last, MAX(scroll) AS scroll, MAX(sound) AS sound
              FROM visits GROUP BY ip ORDER BY last DESC LIMIT 300`),
      refs: q(`SELECT ref, COUNT(*) AS views FROM visits WHERE ref <> '' GROUP BY ref ORDER BY views DESC LIMIT 20`),
      recent: ip
        ? q('SELECT ts, ip, path, ref, ua, scroll, sound FROM visits WHERE ip = ? ORDER BY id DESC LIMIT 300', ip)
        : q('SELECT ts, ip, path, ref, ua, scroll, sound FROM visits ORDER BY id DESC LIMIT 100'),
    }
  }
}

const stub = env => env.STATS.get(env.STATS.idFromName('main'))
const cut = (s, n) => String(s || '').slice(0, n)
const cookie = (req, name) => {
  for (const c of (req.headers.get('Cookie') || '').split(/;\s*/)) if (c.startsWith(name + '=')) return c.slice(name.length + 1)
  return null
}
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
const consentCookie = v => `${CONSENT_COOKIE}=${v}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`
async function body(req) {
  try { return JSON.parse(cut(await req.text(), 2000)) || {} } catch { return {} }
}
function visitFrom(req, b, host) {
  let ref = cut(b.ref, 300)
  try { if (ref && new URL(ref).hostname.endsWith(host.replace(/^www\./, ''))) ref = '' } catch { ref = '' }
  return {
    vid: cut(b.vid, 64) || crypto.randomUUID(),
    ip: req.headers.get('CF-Connecting-IP') || 'unknown',
    path: cut(b.path, 200) || '/',
    ref,
    ua: cut(req.headers.get('User-Agent'), 300),
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const p = url.pathname

    if (p.startsWith('/api/')) {
      if (req.method !== 'POST') return new Response(null, { status: 405 })
      const admin = cookie(req, ADMIN_COOKIE) === '1'
      const b = await body(req)

      if (p === '/api/hit') {
        if (admin) return json({ logged: false })
        const consent = cookie(req, CONSENT_COOKIE)
        const country = env.DEV_COUNTRY || req.cf?.country || ''
        const needs = CONSENT_COUNTRIES.includes('*') || CONSENT_COUNTRIES.includes(country)
        if (consent === 'no') return json({ logged: false })
        if (needs && consent !== 'yes') return json({ ask: true })
        await stub(env).hit(visitFrom(req, b, url.hostname))
        return json({ logged: true })
      }

      if (p === '/api/consent') {
        if (!b.yes) return json({ logged: false }, { 'Set-Cookie': consentCookie('no') })
        if (!admin) await stub(env).hit(visitFrom(req, b, url.hostname))
        return json({ logged: !admin }, { 'Set-Cookie': consentCookie('yes') })
      }

      if (p === '/api/update') {
        const vid = cut(b.vid, 64)
        const scroll = Math.max(0, Math.min(100, Math.round(Number(b.scroll) || 0)))
        if (vid && !admin) await stub(env).update({ vid, scroll, sound: b.sound ? 1 : 0 })
        return new Response(null, { status: 204 })
      }

      return new Response(null, { status: 404 })
    }

    if (p === '/admin' || p.startsWith('/admin/')) {
      if (!env.ADMIN_PASSWORD) return new Response('Admin is off: set the ADMIN_PASSWORD secret in Cloudflare.', { status: 503 })
      if (!(await authorized(req, env.ADMIN_PASSWORD))) {
        return new Response('Login required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="beckzodiy admin", charset="UTF-8"' } })
      }
      const ip = cut(url.searchParams.get('ip'), 64) || null
      return new Response(adminPage(await stub(env).stats(ip), ip), {
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

// ---------- pages ----------
const BASE_CSS = `:root{color-scheme:dark;--bg:#04050c;--card:#0c1020;--line:#1c2340;--txt:#e6e9f5;--mut:#8890b0;--acc:#2fe6a7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 ui-sans-serif,system-ui,sans-serif;padding:24px;max-width:1100px;margin:auto}
h1{font-size:20px;margin:0 0 18px}h2{font-size:15px;margin:28px 0 10px;color:var(--mut);font-weight:600}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}`

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const when = ts => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%'
const scrollCell = v => v == null ? '<td class="mut">—</td>' : `<td><span class="sbar"><i style="width:${v}%"></i></span>${v}%</td>`
const soundCell = v => v == null ? '<td class="mut">—</td>' : v ? '<td class="on">on</td>' : '<td class="mut">off</td>'
function device(ua) {
  ua = ua || ''
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Telegram/i.test(ua) ? 'Telegram' : /Instagram/.test(ua) ? 'Instagram' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '?'
  return `${br} · ${os}`
}

function adminPage(s, ip) {
  const max = Math.max(1, ...s.days.map(d => d.views))
  const tile = (t, big, sub) => `<div class="tile"><small>${t}</small><b>${big}</b><span>${sub}</span></div>`
  const vt = (t, v) => tile(t, v.views, `${v.ips} unique IPs`)
  const e = s.eng
  const bars = s.days.map(d => `<div class="bar" title="${d.day}: ${d.views} views, ${d.ips} IPs"><i style="height:${(d.views / max) * 100}%"></i><em>${d.day.slice(5)}</em></div>`).join('')
  const ipRows = s.ips.map(r => `<tr><td><a href="/admin?ip=${encodeURIComponent(r.ip)}">${esc(r.ip)}</a></td><td>${r.views}</td>${scrollCell(r.scroll)}${soundCell(r.sound)}<td>${when(r.first)}</td><td>${when(r.last)}</td></tr>`).join('')
  const recent = s.recent.map(r => `<tr><td>${when(r.ts)}</td><td><a href="/admin?ip=${encodeURIComponent(r.ip)}">${esc(r.ip)}</a></td>${scrollCell(r.scroll)}${soundCell(r.sound)}<td title="${esc(r.ua)}">${esc(device(r.ua))}</td><td class="ref">${esc(r.ref) || '—'}</td></tr>`).join('')
  const refs = s.refs.map(r => `<tr><td class="ref">${esc(r.ref)}</td><td>${r.views}</td></tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Admin · beckzodiy.com</title><style>${BASE_CSS}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.tiles+.tiles{margin-top:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.tile small{color:var(--mut);display:block}.tile b{font-size:28px;display:block}.tile span{color:var(--mut);font-size:12px}
.chart{display:flex;align-items:flex-end;gap:3px;height:160px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 12px 26px}
.bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;position:relative}
.bar i{display:block;background:var(--acc);border-radius:3px 3px 0 0;min-height:2px}
.bar em{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%) rotate(-45deg);font-size:9px;color:var(--mut);font-style:normal;white-space:nowrap}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--mut);font-weight:600}td.ref{max-width:320px;overflow:hidden;text-overflow:ellipsis}tr:last-child td{border-bottom:0}
.mut{color:var(--mut)}.on{color:var(--acc);font-weight:600}
.sbar{display:inline-block;width:48px;height:6px;border-radius:3px;background:var(--line);margin-right:8px;vertical-align:middle;overflow:hidden}
.sbar i{display:block;height:100%;background:var(--acc)}
.empty{color:var(--mut);padding:14px}
</style></head><body>
<h1>beckzodiy.com · visitors</h1>
${ip ? `<p>Showing visits from <b>${esc(ip)}</b> · <a href="/admin">back to all</a></p>` : `
<div class="tiles">${vt('Last 24 hours', s.d1)}${vt('Last 7 days', s.d7)}${vt('Last 30 days', s.d30)}${vt(`All time (${KEEP_DAYS}-day log)`, s.all)}</div>
<div class="tiles">
${tile('Avg. scrolled (30 days)', e.n ? Math.round(e.avg) + '%' : '—', `of the page, ${e.n} visits`)}
${tile('Scrolled to the end', e.n ? pctOf(e.done, e.n) : '—', `${e.done || 0} visits reached 90%+`)}
${tile('Turned sound on', e.n ? pctOf(e.snd, e.n) : '—', `${e.snd || 0} visits`)}
</div>
<h2>Views per day (Dubai time)</h2>
${s.days.length ? `<div class="chart">${bars}</div>` : '<div class="wrap empty">No visits yet.</div>'}
<h2>IP addresses (${s.ips.length}${s.ips.length === 300 ? '+' : ''})</h2>
<div class="wrap">${ipRows ? `<table><tr><th>IP</th><th>Views</th><th>Max scrolled</th><th>Sound</th><th>First seen</th><th>Last seen</th></tr>${ipRows}</table>` : '<div class="empty">No visits yet.</div>'}</div>
<h2>Where they came from (referrers)</h2>
<div class="wrap">${refs ? `<table><tr><th>Referrer</th><th>Views</th></tr>${refs}</table>` : '<div class="empty">No referrers yet (direct visits only).</div>'}</div>`}
<h2>${ip ? 'Visits' : 'Latest visits'}</h2>
<div class="wrap">${recent ? `<table><tr><th>Time</th><th>IP</th><th>Scrolled</th><th>Sound</th><th>Device</th><th>Referrer</th></tr>${recent}</table>` : '<div class="empty">Nothing yet.</div>'}</div>
<p class="mut" style="margin-top:24px;font-size:12px">Your own visits are not counted on this browser. UAE visitors are only counted after they press OK on the consent banner. "—" = visit recorded before scroll/sound tracking.</p>
</body></html>`
}
