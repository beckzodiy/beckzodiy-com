// Admin dashboard: KPI tiles, a views/visitors line chart and top-lists. No chart library.
const nf = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }) } catch { return null } })()
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']]

let currentDays = Number(localStorage.getItem('beckzodiy_stats_days')) || 30
let resizeObserver = null

export async function renderStats(root, api) {
  root.innerHTML = `<div class="stats-bar"><div class="range" role="group" aria-label="Date range">${RANGES.map(([d, label]) => `<button type="button" data-days="${d}" aria-pressed="${d === currentDays}">${label}</button>`).join('')}</div><button type="button" class="quiet" data-refresh title="Refresh">↻ Refresh</button></div><div data-stats-body><p class="muted">Loading stats…</p></div>`
  root.querySelectorAll('[data-days]').forEach(b => b.onclick = () => {
    currentDays = Number(b.dataset.days)
    localStorage.setItem('beckzodiy_stats_days', currentDays)
    root.querySelectorAll('[data-days]').forEach(x => x.setAttribute('aria-pressed', x === b))
    load(root, api)
  })
  root.querySelector('[data-refresh]').onclick = () => load(root, api)
  await load(root, api)
}

async function load(root, api) {
  const body = root.querySelector('[data-stats-body]')
  body.classList.add('loading')
  try {
    const data = await api(`/api/admin/stats?days=${currentDays}`)
    body.innerHTML = view(data)
    drawChart(body.querySelector('[data-chart]'), data.series)
  } catch (error) {
    body.innerHTML = `<p class="muted">${esc(error.message)}</p>`
  } finally { body.classList.remove('loading') }
}

function delta(now, before) {
  if (!before) return now ? '<span class="delta">new</span>' : ''
  const pct = Math.round(((now - before) / before) * 100)
  const sign = pct > 0 ? '▲' : pct < 0 ? '▼' : '•'
  return `<span class="delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}" title="vs previous ${currentDays} days">${sign} ${Math.abs(pct)}%</span>`
}

function view({ totals: t, series, top, sources }) {
  const tile = (label, value, extra = '') => `<div class="tile"><p class="tile-label">${label}</p><p class="tile-value">${nf.format(value)}</p>${extra}</div>`
  const avg = series.length ? t.views / series.length : 0
  return `
  <div class="tiles">
    ${tile('Views', t.views, delta(t.views, t.previousViews))}
    ${tile('Visitors', t.visitors, delta(t.visitors, t.previousVisitors))}
    ${tile('Today', t.today, `<span class="delta">avg ${avg < 10 ? avg.toFixed(1) : nf.format(Math.round(avg))}/day</span>`)}
    ${tile('All-time views', t.allTime)}
    ${tile('Articles', t.articles)}
  </div>
  <section class="panel">
    <div class="panel-head"><h2>Views &amp; visitors</h2><div class="legend"><span><i class="sw s1"></i>Views</span><span><i class="sw s2"></i>Visitors</span></div></div>
    <div class="chart" data-chart></div>
    <details class="chart-table"><summary>Show as table</summary><table><thead><tr><th>Day</th><th>Views</th><th>Visitors</th></tr></thead><tbody>${series.slice().reverse().map(d => `<tr><td>${fmtDay(d.day)}</td><td>${nf.format(d.views)}</td><td>${nf.format(d.visitors)}</td></tr>`).join('')}</tbody></table></details>
  </section>
  <div class="panels">
    ${barList('Top pages', top.map(r => ({ label: r.title, href: r.slug === '/' ? '/' : '/' + encodeURIComponent(r.slug), views: r.views })), 'wide')}
    ${barList('Referrers', sources.referrer.map(r => ({ label: r.value, views: r.views })))}
    ${barList('Countries', sources.country.map(r => ({ label: countryName(r.value), views: r.views })))}
    ${barList('Devices', sources.device.map(r => ({ label: r.value, views: r.views })))}
    ${barList('Browsers', sources.browser.map(r => ({ label: r.value, views: r.views })))}
  </div>`
}

function barList(title, rows, cls = '') {
  const max = Math.max(1, ...rows.map(r => r.views))
  const total = rows.reduce((n, r) => n + r.views, 0) || 1
  const items = rows.length ? rows.map(r => `<li title="${esc(r.label)}: ${nf.format(r.views)} views (${Math.round(r.views / total * 100)}%)"><span class="bar" style="width:${(r.views / max) * 100}%"></span><span class="bar-label">${r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener">${esc(r.label)}</a>` : esc(r.label)}</span><span class="bar-value">${nf.format(r.views)}</span></li>`).join('') : '<li class="muted empty-row">No data yet</li>'
  return `<section class="panel ${cls}"><div class="panel-head"><h2>${title}</h2><span class="muted">Views</span></div><ul class="bars">${items}</ul></section>`
}

function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code)) return code === 'T1' ? 'Tor' : code
  const flag = String.fromCodePoint(...[...code].map(c => 0x1f1a5 + c.charCodeAt(0)))
  return `${flag} ${regionNames?.of(code) || code}`
}

function fmtDay(day, opts = { month: 'short', day: 'numeric' }) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

function niceMax(v) {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

function drawChart(host, series) {
  resizeObserver?.disconnect()
  const render = () => {
    const W = host.clientWidth, H = 260
    if (W < 120) return // hidden tab: draw when it becomes visible
    const m = { t: 12, r: 12, b: 28, l: 40 }
    const iw = W - m.l - m.r, ih = H - m.t - m.b
    const max = niceMax(Math.max(...series.map(d => Math.max(d.views, d.visitors))))
    const x = i => m.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw)
    const y = v => m.t + ih - (v / max) * ih
    const path = key => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('')
    const ticks = [0, .25, .5, .75, 1].map(f => f * max)
    const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(iw / 70)))
    const xLabels = series.map((d, i) => (i % labelEvery === 0 || i === series.length - 1) && (i === series.length - 1 || series.length - 1 - i >= labelEvery / 2)
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${fmtDay(d.day, series.length > 120 ? { month: 'short' } : undefined)}</text>` : '').join('')
    const dots = series.length <= 31
    host.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Daily views and visitors">
      <defs><linearGradient id="g-views" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>
      <g class="grid">${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${compact.format(v)}</text>`).join('')}</g>
      <g class="axis">${xLabels}</g>
      <path d="${path('views')}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="url(#g-views)"/>
      <path class="line s1" d="${path('views')}"/><path class="line s2" d="${path('visitors')}"/>
      ${dots ? series.map((d, i) => `<circle class="pt s1" cx="${x(i)}" cy="${y(d.views)}" r="2.5"/>`).join('') : ''}
      <g class="hover" hidden><line class="cross" y1="${m.t}" y2="${m.t + ih}"/><circle class="hv s1" r="4.5"/><circle class="hv s2" r="4.5"/></g>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="tip" hidden></div>`
    const svg = host.querySelector('svg'), hover = svg.querySelector('.hover'), tip = host.querySelector('.tip')
    const show = clientX => {
      const r = svg.getBoundingClientRect()
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((clientX - r.left - m.l) / iw) * (series.length - 1))))
      const d = series[i]
      hover.hidden = false
      hover.querySelector('.cross').setAttribute('x1', x(i)); hover.querySelector('.cross').setAttribute('x2', x(i))
      const [a, b] = hover.querySelectorAll('.hv')
      a.setAttribute('cx', x(i)); a.setAttribute('cy', y(d.views)); b.setAttribute('cx', x(i)); b.setAttribute('cy', y(d.visitors))
      tip.hidden = false
      tip.innerHTML = `<b>${fmtDay(d.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b><span><i class="sw s1"></i>Views <b>${nf.format(d.views)}</b></span><span><i class="sw s2"></i>Visitors <b>${nf.format(d.visitors)}</b></span>`
      const left = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth)
      tip.style.left = `${left}px`
      tip.style.top = `${Math.max(0, Math.min(y(d.views), y(d.visitors)) - tip.offsetHeight - 12)}px`
    }
    const hide = () => { hover.hidden = true; tip.hidden = true }
    const hit = svg.querySelector('.hit')
    hit.addEventListener('pointermove', e => show(e.clientX))
    hit.addEventListener('pointerdown', e => show(e.clientX))
    hit.addEventListener('pointerleave', hide)
  }
  render()
  let last = host.clientWidth
  resizeObserver = new ResizeObserver(() => { if (host.isConnected && host.clientWidth !== last) { last = host.clientWidth; render() } })
  resizeObserver.observe(host)
}
