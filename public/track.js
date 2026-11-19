// Counts one page view. Your own visits are skipped while you are logged in to the admin panel.
(() => {
  const slug = document.currentScript?.dataset.slug
  if (!slug || localStorage.getItem('beckzodiy_admin_key') || navigator.webdriver) return
  const body = JSON.stringify({ slug, ref: document.referrer })
  const send = () => {
    if (navigator.sendBeacon?.('/api/view', new Blob([body], { type: 'application/json' }))) return
    fetch('/api/view', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {})
  }
  // Wait until the page is actually shown (skips prerender/prefetch).
  if (document.visibilityState === 'visible') send()
  else document.addEventListener('visibilitychange', function once() {
    if (document.visibilityState !== 'visible') return
    document.removeEventListener('visibilitychange', once)
    send()
  })
})()
