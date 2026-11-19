// Lightweight 3D effects, no dependencies:
// 1) a rotating 3D particle globe behind the home hero,
// 2) 3D tilt on article cards (mouse/trackpad only),
// 3) cards flip up into place as they scroll into view.
// Everything is skipped when the visitor prefers reduced motion.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) return

  addEventListener('DOMContentLoaded', () => {
    globe()
    tilt()
    reveal()
  })

  function accent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2b6cb0'
  }

  function globe() {
    const hero = document.querySelector('.hero')
    if (!hero) return
    const canvas = document.createElement('canvas')
    canvas.className = 'hero-globe'
    canvas.setAttribute('aria-hidden', 'true')
    hero.prepend(canvas)
    const ctx = canvas.getContext('2d')

    // Evenly spread points on a sphere (Fibonacci lattice).
    const N = innerWidth < 600 ? 380 : 650
    const pts = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = golden * i
      pts.push([Math.cos(t) * r, y, Math.sin(t) * r])
    }
    // Two orbit rings for depth.
    const rings = []
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2
      rings.push([Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35])
    }

    let w = 0, h = 0, dpr = 1, color = accent()
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2)
      w = hero.clientWidth
      h = hero.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
    }
    resize()
    addEventListener('resize', resize)
    new MutationObserver(() => { color = accent() }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // Pointer nudges the rotation; it eases back on its own.
    let tx = 0, ty = 0, mx = 0, my = 0
    addEventListener('pointermove', e => {
      tx = (e.clientX / innerWidth - 0.5) * 0.9
      ty = (e.clientY / innerHeight - 0.5) * 0.6
    }, { passive: true })

    let visible = true
    new IntersectionObserver(([e]) => { visible = e.isIntersecting }).observe(hero)

    const start = performance.now()
    const frame = now => {
      requestAnimationFrame(frame)
      if (!visible || document.hidden) return
      const t = (now - start) / 1000
      mx += (tx - mx) * 0.05
      my += (ty - my) * 0.05
      const ry = t * 0.18 + mx
      const rx = -0.35 + my
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx)
      const R = Math.min(w, h) * 0.42
      const ox = w / 2, oy = h / 2
      const fov = 3.2

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = color

      const project = (p, ringTilt) => {
        let [x, y, z] = p
        if (ringTilt) { const c = Math.cos(ringTilt), s = Math.sin(ringTilt); [y, z] = [y * c - z * s, y * s + z * c] }
        let x1 = x * cy - z * sy, z1 = x * sy + z * cy
        let y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx
        const scale = fov / (fov + z2)
        return [ox + x1 * R * scale, oy + y1 * R * scale, z2, scale]
      }
      const dot = ([px, py, z, s], size) => {
        const depth = (1 - z) / 2 // 0 back … 1 front
        ctx.globalAlpha = 0.08 + depth * 0.5
        ctx.beginPath()
        ctx.arc(px, py, size * s * (0.5 + depth), 0, Math.PI * 2)
        ctx.fill()
      }
      for (const p of pts) dot(project(p), 1.5)
      for (const p of rings) dot(project(p, 0.45 + Math.sin(t * 0.3) * 0.05), 1.1)
      ctx.globalAlpha = 1
    }
    requestAnimationFrame(frame)
  }

  function tilt() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
    document.querySelectorAll('.article-list a.card').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width - 0.5
        const y = (e.clientY - r.top) / r.height - 0.5
        card.style.transform = `perspective(900px) rotateX(${-y * 6}deg) rotateY(${x * 8}deg) translateZ(12px)`
      })
      card.addEventListener('pointerleave', () => { card.style.transform = '' })
    })
  }

  function reveal() {
    const items = document.querySelectorAll('.article-list a.card, .story > *')
    if (!items.length || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px' })
    items.forEach(el => { el.classList.add('fx-reveal'); io.observe(el) })
  }
})()
