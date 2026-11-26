// Visit stats: IP (seen by the server), how far the page was scrolled, and whether sound was turned on.
// Visitors from countries that need consent (UAE) see a banner first; nothing is stored until they accept.
(() => {
  const vid = (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2)
  let logged = false, dirty = false, maxScroll = 0, soundOn = false

  const pct = () => {
    const h = document.documentElement.scrollHeight - innerHeight
    return h > 0 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100
  }
  addEventListener('scroll', () => {
    const p = pct()
    if (p > maxScroll) { maxScroll = p; dirty = true }
  }, { passive: true })

  const watchSound = () => {
    const b = document.getElementById('snd')
    if (!b) return
    new MutationObserver(() => {
      if (!soundOn && b.classList.contains('on')) { soundOn = true; dirty = true }
    }).observe(b, { attributes: true, attributeFilter: ['class'] })
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watchSound)
  else watchSound()

  const flush = () => {
    if (!logged || !dirty) return
    dirty = false
    navigator.sendBeacon('/api/update', JSON.stringify({ vid, scroll: maxScroll, sound: soundOn }))
  }
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  addEventListener('pagehide', flush)
  setInterval(flush, 15000)

  const post = (url, data) => fetch(url, { method: 'POST', body: JSON.stringify(data), keepalive: true }).then(r => r.json())
  const visit = { vid, path: location.pathname, ref: document.referrer }
  const started = r => { logged = !!r.logged; dirty = true; flush() }

  post('/api/hit', visit).then(r => { if (r.ask) banner(); else started(r) }).catch(() => {})

  function banner() {
    const css = document.createElement('style')
    css.textContent = `
      .consent{position:fixed;z-index:50;left:50%;bottom:20px;transform:translateX(-50%);width:min(560px,calc(100% - 24px));
        background:rgba(8,10,24,.94);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:16px 18px;
        font:12px/1.6 "JetBrains Mono",ui-monospace,monospace;color:#c9d0ea;backdrop-filter:blur(8px);box-shadow:0 12px 40px rgba(0,0,0,.5)}
      .consent div{display:flex;gap:10px;margin-top:12px;justify-content:flex-end}
      .consent button{font:inherit;letter-spacing:.08em;text-transform:uppercase;padding:9px 16px;border-radius:999px;cursor:pointer;
        border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#f1f4ff}
      .consent button.yes{background:#2fe6a7;border-color:#2fe6a7;color:#04050c;font-weight:700}`
    document.head.appendChild(css)
    const box = document.createElement('div')
    box.className = 'consent'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Visitor stats consent')
    box.innerHTML = `To count visitors, this site can save your <b>IP address</b>, how far you scroll and whether you turn sound on.
      Kept 90 days, never sold or shared.
      <div><button class="no">No thanks</button><button class="yes">OK</button></div>`
    document.body.appendChild(box)
    box.querySelector('.yes').onclick = () => { box.remove(); post('/api/consent', { ...visit, yes: true }).then(started).catch(() => {}) }
    box.querySelector('.no').onclick = () => { box.remove(); post('/api/consent', { yes: false }).catch(() => {}) }
  }
})()
