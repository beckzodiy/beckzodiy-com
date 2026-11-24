import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { N, LAND, UZ, AE, UZ_OUTLINE, AE_OUTLINE } from './geo.js'
import * as sound from './sound.js'

const canvas = document.getElementById('gl')
const coarse = matchMedia('(pointer: coarse)').matches
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const motion = reduced ? 0.3 : 1
const D2R = Math.PI / 180
const R = 5

// ---------- helpers ----------
const clamp01 = x => Math.min(1, Math.max(0, x))
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x) }
const lerp = (a, b, t) => a + (b - a) * t
let sp = 0 // smoothed scroll progress 0..1
const local = (a, b) => clamp01((sp - a) / (b - a))
// 1 inside [a,b], fading over f outside
const win = (a, b, f = 0.02) => smooth((sp - (a - f)) / f) * smooth(((b + f) - sp) / f)

function ll(lat, lon, r = R, out = new THREE.Vector3()) {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R
  return out.set(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th))
}
function toLatLon(p) {
  const lat = Math.asin(p.y / p.length()) / D2R
  let lon = Math.atan2(p.z, -p.x) / D2R - 180
  if (lon < -180) lon += 360
  return [lat, lon]
}
function slerpUnit(a, b, s) {
  const ang = a.angleTo(b)
  if (ang < 1e-6) return a.clone()
  const sa = Math.sin(ang)
  return a.clone().multiplyScalar(Math.sin((1 - s) * ang) / sa).add(b.clone().multiplyScalar(Math.sin(s * ang) / sa))
}
const kmBetween = (a, b) => ll(a[0], a[1], 1).angleTo(ll(b[0], b[1], 1)) * 6371

// ---------- renderer ----------
let renderer
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' })
} catch (e) {
  document.getElementById('nogl').style.display = 'grid'
  throw e
}
const DPR = Math.min(devicePixelRatio, coarse ? 1.5 : 1.75)
renderer.setPixelRatio(DPR)
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color('#04050c')
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 2000)

const composer = new EffectComposer(renderer)
composer.setPixelRatio(coarse ? 1 : DPR)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.45, 0.62))
composer.addPass(new OutputPass())

const dotUniforms = { uScale: { value: 1 }, uTime: { value: 0 } }
function fitCamera() {
  const aspect = innerWidth / innerHeight
  camera.fov = aspect >= 1 ? 45 : Math.min(80, 2 * Math.atan(Math.tan(22.5 * D2R) / aspect) / D2R)
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  dotUniforms.uScale.value = (innerHeight * DPR) / (2 * Math.tan((camera.fov * D2R) / 2))
}
fitCamera()

// ---------- textures ----------
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}
const GLOW = glowTex()
function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  s.scale.setScalar(size)
  return s
}
function label(text, color = '#ffffff', h = 0.26) {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')
  const font = '600 64px "JetBrains Mono", ui-monospace, monospace'
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 48
  c.width = w; c.height = 100
  g.font = font
  g.fillStyle = 'rgba(4,6,16,.72)'
  g.beginPath(); g.roundRect(0, 6, w, 88, 44); g.fill()
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 24, 52)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  s.scale.set(h * (w / 100), h, 1)
  s.renderOrder = 10
  return s
}
function coinFace(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')
  const gr = g.createLinearGradient(0, 0, 256, 256)
  gr.addColorStop(0, bg); gr.addColorStop(1, fg)
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#140c00'; g.font = '800 78px "Unbounded", "Arial Black", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(text, 128, 132)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------- flowing line material (arcs + cables) ----------
function flowMat(color, loop = true) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uDraw: { value: 1 }, uHead: { value: 0 },
      uAlpha: { value: 1 }, uLoop: { value: loop ? 1 : 0 }, uBase: { value: 0.22 }, uTail: { value: 14 },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform vec3 uColor; uniform float uDraw, uHead, uAlpha, uLoop, uBase, uTail;
      void main(){
        float x = vUv.x;
        if (x > uDraw) discard;
        float d = uHead - x;
        if (uLoop > 0.5) d = fract(d);
        float p = d < 0.0 ? 0.0 : exp(-d * uTail);
        float k = uBase + p * 2.2;
        gl_FragColor = vec4(uColor * k, uAlpha * min(1.0, k));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
}
function tube(points, radius, mat, seg = 160) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 6), mat)
  m.userData.curve = curve
  return m
}
function arc(a, b, color, lift = 1, radius = 0.022) {
  const va = ll(a[0], a[1], 1), vb = ll(b[0], b[1], 1)
  const ang = va.angleTo(vb)
  const pts = []
  for (let i = 0; i <= 64; i++) {
    const s = i / 64
    pts.push(slerpUnit(va, vb, s).multiplyScalar(R + Math.sin(Math.PI * s) * (0.12 + ang * 0.75) * lift))
  }
  return tube(pts, radius, flowMat(color, true), 128)
}

// ---------- the globe ----------
const globe = new THREE.Group()
scene.add(globe)

const ocean = new THREE.Mesh(
  new THREE.SphereGeometry(R * 0.995, 96, 64),
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.5);
        gl_FragColor = vec4(mix(vec3(0.012, 0.02, 0.055), vec3(0.08, 0.16, 0.42), f), 1.0); }`,
  }),
)
globe.add(ocean)

const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.13, 64, 48),
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`varying vec3 vN; void main(){ float i = pow(max(0.0, 0.62 - dot(vN, vec3(0.0, 0.0, 1.0))), 2.2); gl_FragColor = vec4(vec3(0.25, 0.5, 1.0) * i * 0.9, 1.0); }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }),
)
globe.add(atmo)

// land dots (Fibonacci sphere masked by land, precomputed)
const dots = (() => {
  const bits = Uint8Array.from(atob(LAND), c => c.charCodeAt(0))
  const uz = new Set(UZ), ae = new Set(AE)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pos = [], type = []
  const v = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    if (!(bits[i >> 3] & (1 << (i & 7)))) continue
    const y = 1 - (i / (N - 1)) * 2
    const lat = (Math.asin(y) * 180) / Math.PI
    let lon = ((golden * i) * 180 / Math.PI) % 360
    if (lon > 180) lon -= 360
    ll(lat, lon, R * 1.001, v)
    pos.push(v.x, v.y, v.z)
    type.push(uz.has(i) ? 1 : ae.has(i) ? 2 : 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aType', new THREE.Float32BufferAttribute(type, 1))
  const m = new THREE.ShaderMaterial({
    uniforms: { ...dotUniforms, uSize: { value: 0.052 }, uHi: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aType; uniform float uScale, uSize, uTime, uHi; varying vec3 vCol;
      void main(){
        vec3 c = vec3(0.24, 0.25, 0.42); float s = 1.0;
        if (aType > 1.5) { c = vec3(1.0, 0.42, 0.37) * (1.0 + uHi * 0.8); s = 1.5; }
        else if (aType > 0.5) { c = vec3(0.18, 0.95, 0.68) * (1.0 + uHi * (0.8 + 0.4 * sin(uTime * 3.0))); s = 1.45; }
        vCol = c;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * s * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`varying vec3 vCol; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vec4(vCol, 1.0); }`,
  })
  const pts = new THREE.Points(g, m)
  globe.add(pts)
  return pts
})()

// country outlines for Uzbekistan and the UAE
function outline(rings, color) {
  const grp = new THREE.Group()
  for (const ring of rings) {
    const pts = ring.map(([la, lo]) => ll(la, lo, R * 1.003))
    grp.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })))
  }
  globe.add(grp)
  return grp
}
outline(UZ_OUTLINE, '#2fe6a7')
outline(AE_OUTLINE, '#ff6b5e')

// background stars
{
  const n = coarse ? 1500 : 3000, pos = new Float32Array(n * 3), v = new THREE.Vector3()
  for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(300 + Math.random() * 400); pos.set([v.x, v.y, v.z], i * 3) }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: true, color: '#c9d4ff', transparent: true, opacity: 0.7, depthWrite: false })))
}

// ---------- places ----------
const P = {
  dubai: [25.2, 55.27], tashkent: [41.31, 69.24], andijan: [40.78, 72.34],
  moscow: [55.75, 37.62], spb: [59.93, 30.34], yekat: [56.84, 60.6], almaty: [43.24, 76.89],
  seoul: [37.57, 126.98], istanbul: [41.01, 28.98], newyork: [40.71, -74.0], london: [51.5, -0.12],
  warsaw: [52.23, 21.01], berlin: [52.52, 13.4],
}
function marker(p, color, size = 0.45) {
  const s = glow(color, size)
  ll(p[0], p[1], R * 1.012, s.position)
  globe.add(s)
  return s
}
function placeLabel(p, text, color, up = 0.42, h) {
  const s = label(text, color, h)
  ll(p[0], p[1], R + up, s.position)
  globe.add(s)
  return s
}
const homeMarkers = [marker(P.tashkent, '#2fe6a7', 0.55), marker(P.andijan, '#2fe6a7', 0.55)]
const dubaiMarker = marker(P.dubai, '#ffc65c', 0.55)
const labels = {
  uz: placeLabel([41.6, 64.5], 'UZBEKISTAN', '#2fe6a7', 0.55),
  dubai: placeLabel(P.dubai, 'DUBAI', '#ffc65c'),
  tashkent: placeLabel(P.tashkent, 'TASHKENT', '#2fe6a7'),
  andijan: placeLabel(P.andijan, 'ANDIJAN', '#2fe6a7', 0.3),
  newyork: placeLabel(P.newyork, 'NEW YORK BANK', '#ff6b5e'),
  dubaiBank: placeLabel([23.6, 55.27], 'BANK · FEE', '#ff6b5e', 0.3),
  uzBank: placeLabel([39.6, 69.24], 'BANK · FEE', '#ff6b5e', 0.3),
  moscow: placeLabel(P.moscow, 'RUSSIA  ~78%', '#c9d4ff'),
  marseille: placeLabel([43.3, 5.37], 'MARSEILLE', '#6cf4ff', 0.3),
  frankfurt: placeLabel([50.11, 8.68], 'FRANKFURT', '#6cf4ff', 0.3),
}

// ---------- 1. migrant money arcs ----------
// [place, weight, name]
const sources = [
  [P.moscow, 1.6, 'MOSCOW'], [P.spb, 1.1, 'ST PETERSBURG'], [P.yekat, 1, 'YEKATERINBURG'], [[55.79, 49.12], 1, 'KAZAN'],
  [[55.03, 82.92], 0.9, 'NOVOSIBIRSK'], [[45.04, 38.98], 0.9, 'KRASNODAR'], [P.almaty, 1, 'ALMATY'], [[51.17, 71.45], 0.9, 'ASTANA'],
  [P.seoul, 1, 'SEOUL'], [[35.18, 129.08], 0.8, 'BUSAN'], [[35.68, 139.69], 0.8, 'TOKYO'], [P.istanbul, 1, 'ISTANBUL'],
  [[39.93, 32.86], 0.8, 'ANKARA'], [P.dubai, 1, 'DUBAI'], [[24.71, 46.68], 0.8, 'RIYADH'], [P.warsaw, 1, 'WARSAW'],
  [P.berlin, 1, 'BERLIN'], [[50.08, 14.44], 0.8, 'PRAGUE'], [P.london, 1, 'LONDON'], [P.newyork, 0.9, 'NEW YORK'],
  [[41.88, -87.63], 0.8, 'CHICAGO'],
]
// Uzbek cities the money lands in
const UZ_CITIES = [
  [P.tashkent, 'TASHKENT'], [P.andijan, 'ANDIJAN'], [[39.65, 66.96], 'SAMARKAND'], [[39.77, 64.42], 'BUKHARA'],
  [[40.39, 71.78], 'FERGANA'], [[41.0, 71.67], 'NAMANGAN'], [[42.46, 59.6], 'NUKUS'], [[37.22, 67.28], 'TERMEZ'],
  [[38.86, 65.79], 'QARSHI'], [[41.55, 60.63], 'URGENCH'],
]
const sourceLabels = sources.filter(s => s[2] !== 'DUBAI').map(([p, , n]) => placeLabel(p, n, '#c9d4ff', 0.28, 0.17))
const uzLabels = UZ_CITIES.slice(2).map(([p, n]) => placeLabel(p, n, '#2fe6a7', 0.22, 0.15))
const uzMarkers = UZ_CITIES.slice(2).map(([p]) => marker(p, '#2fe6a7', 0.3))
const migrantArcs = sources.map(([p, w], i) => {
  const m = arc(p, UZ_CITIES[i % UZ_CITIES.length][0], '#2fe6a7', 1, 0.014 * w + 0.007)
  m.material.uniforms.uTail.value = 6
  m.userData.offset = Math.random()
  globe.add(m)
  return m
})
const sourceMarkers = sources.map(([p]) => marker(p, '#9fb6ff', 0.3))

// ---------- 2. old bank route ----------
const oldA = arc(P.dubai, P.newyork, '#ff6b5e', 0.8, 0.02)
const oldB = arc(P.newyork, P.tashkent, '#ff6b5e', 0.8, 0.02)
for (const m of [oldA, oldB]) { m.material.uniforms.uLoop.value = 0; m.material.uniforms.uTail.value = 10; globe.add(m) }
const bankBoxes = [P.dubai, P.newyork, P.tashkent].map(p => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: '#ff6b5e' }))
  const n = ll(p[0], p[1], 1)
  b.position.copy(n).multiplyScalar(R + 0.13)
  b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
  globe.add(b)
  return b
})

// ---------- 3. fiber cable route Dubai → sea → Europe → land → Tashkent → Andijan ----------
const ROUTE = [
  P.dubai, [25.13, 56.35], [24.6, 58.6], [22.6, 61.0], [17.0, 57.5], [12.8, 48.0], [12.6, 43.4],
  [16.5, 41.0], [22.0, 37.6], [27.0, 34.4], [29.95, 32.55], [31.27, 32.3], [33.4, 28.0], [35.2, 20.0],
  [37.3, 11.2], [40.5, 6.8], [43.3, 5.37], // Marseille (sea ends)
  [45.76, 4.84], [50.11, 8.68], [52.52, 13.4], [52.23, 21.01], [53.9, 27.56], [55.75, 37.62],
  [53.2, 50.15], [51.77, 55.1], [50.28, 57.17], [44.85, 65.5], [42.32, 69.6], P.tashkent, P.andijan,
]
const routeKm = ROUTE.slice(1).reduce((s, p, i) => s + kmBetween(ROUTE[i], p), 0)
document.getElementById('km').textContent = `${(Math.round(routeKm / 100) * 100).toLocaleString('en-US')} km`
document.getElementById('ms').textContent = `${(routeKm / 200000).toFixed(2)} s`
const cable = (() => {
  const pts = []
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ll(ROUTE[i][0], ROUTE[i][1], 1), b = ll(ROUTE[i + 1][0], ROUTE[i + 1][1], 1)
    const steps = Math.max(2, Math.ceil(a.angleTo(b) / (1.2 * D2R)))
    for (let s = 0; s < steps; s++) pts.push(slerpUnit(a, b, s / steps).multiplyScalar(R * 1.006))
  }
  pts.push(ll(P.andijan[0], P.andijan[1], R * 1.006))
  const m = tube(pts, 0.03, flowMat('#6cf4ff', false), 600)
  m.material.uniforms.uTail.value = 40
  m.material.uniforms.uBase.value = 0.5
  globe.add(m)
  return m
})()
const packet = glow('#bff9ff', 1.0)
globe.add(packet)

// ---------- coin (Dubai) and arrival coin (Andijan) ----------
function makeCoin(texts) {
  const faces = texts.map(([t, bg, fg]) => coinFace(t, bg, fg))
  const side = new THREE.MeshStandardMaterial({ color: '#c99a2e', metalness: 0.6, roughness: 0.45 })
  const face = new THREE.MeshBasicMaterial({ map: faces[0] })
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 48), side)
  mesh.rotation.x = Math.PI / 2
  // flat front face with normal UVs, so the text reads correctly
  const front = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), face)
  front.position.z = 0.041
  const pivot = new THREE.Group(); pivot.add(mesh, front)
  const holder = new THREE.Group(); holder.add(pivot)
  const halo = glow('#ffd27a', 1.5)
  halo.material.opacity = 0.35
  holder.add(halo)
  globe.add(holder)
  return { holder, pivot, mesh, face, side, faces, halo }
}
scene.add(new THREE.AmbientLight('#ffffff', 1.2))
const keyLight = new THREE.DirectionalLight('#ffffff', 2.5)
scene.add(keyLight)
const coin = makeCoin([['AED', '#d29a2c', '#9a6812'], ['1:1', '#3fb7cc', '#1d7f93']])
const coinUp = ll(P.dubai[0], P.dubai[1], 1)
const arrive = makeCoin([['UZS', '#33b884', '#1a7d58']])
arrive.side.color.set('#2fb889'); arrive.halo.material.color.set('#2fe6a7')
const andijanUp = ll(P.andijan[0], P.andijan[1], 1)
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.22, 3, 24, 1, true),
  new THREE.MeshBasicMaterial({ color: '#2fe6a7', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
)
beam.position.copy(andijanUp).multiplyScalar(R + 1.5)
beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), andijanUp)
globe.add(beam)
const arriveLabel = placeLabel([46.5, 72.34], '+ SOʻM ON A CARD', '#2fe6a7', 0.6)

// ---------- 4. network of checking computers ----------
const NODES = [
  [50.11, 8.68], [51.5, -0.12], [48.86, 2.35], [52.37, 4.9], [40.71, -74.0], [39.04, -77.49], [37.77, -122.42],
  [43.65, -79.38], [-23.55, -46.63], [1.35, 103.82], [35.68, 139.69], [37.57, 126.98], [22.32, 114.17],
  [19.08, 72.88], [-33.87, 151.21], [-26.2, 28.05], [41.01, 28.98], [55.75, 37.62], [41.31, 69.24], [43.24, 76.89],
]
const nodeArcs = NODES.map((p, i) => {
  const m = arc(P.dubai, p, '#ffc65c', 0.9, 0.012)
  m.material.uniforms.uLoop.value = 0
  m.material.uniforms.uTail.value = 8
  m.userData.delay = (i / NODES.length) * 0.5
  globe.add(m)
  return m
})
const nodeMarks = NODES.map(p => {
  const s = glow('#ffc65c', 0.6)
  ll(p[0], p[1], R * 1.02, s.position)
  globe.add(s)
  return s
})
const checkLabel = placeLabel([30, 20], '✓ VERIFIED', '#ffc65c', 1.6)

// ---------- fiber interior scene ----------
const fiber = new THREE.Scene()
fiber.background = new THREE.Color('#010309')
const FL = 700
{
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, FL, 64, 1, true),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
        void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
        void main(){
          float lines = smoothstep(0.97, 1.0, abs(sin(vUv.x * 3.14159 * 18.0))) * 0.12;
          float rings = smoothstep(0.985, 1.0, abs(sin(vUv.y * 3.14159 * 90.0))) * 0.18;
          float f = pow(1.0 - abs(dot(vN, vV)), 2.0);
          vec3 c = vec3(0.06, 0.32, 0.45) * (0.03 + lines + rings + f * 0.25);
          c *= 0.35 * exp(-vDepth * 0.02) * smoothstep(0.0, 6.0, vDepth);
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
    }),
  )
  core.rotation.x = Math.PI / 2
  core.position.z = -FL / 2 + 30
  fiber.add(core)
}
const zig = new THREE.CurvePath()
{
  let prev = new THREE.Vector3(-0.7, 2.7, 30)
  for (let k = 1; k * 16 < FL; k++) {
    const next = new THREE.Vector3(k % 2 ? 0.7 : -0.7, k % 2 ? -2.7 : 2.7, 30 - k * 16)
    zig.add(new THREE.LineCurve3(prev, next)); prev = next
  }
}
{
  const m = new THREE.Mesh(new THREE.TubeGeometry(zig, 800, 0.025, 6), flowMat('#6cf4ff', true))
  m.material.uniforms.uBase.value = 0.35
  m.material.uniforms.uTail.value = 1000
  fiber.add(m)
}
const BITS = [0x41, 0x45, 0x44].flatMap(b => [...b.toString(2).padStart(8, '0')].map(Number))
const zigLen = zig.getLength()
const SLOT = 3.2
const slots = Math.floor(zigLen / SLOT)
const ones = []
for (let s = 0; s < slots; s++) if (BITS[s % BITS.length]) ones.push(s)
const pulses = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.16, 12, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.6, 3.0) }),
  ones.length,
)
pulses.frustumCulled = false
fiber.add(pulses)
const pDummy = new THREE.Object3D(), pTan = new THREE.Vector3()

// ---------- input ----------
const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2()
addEventListener('pointermove', e => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1))
document.getElementById('again').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }))
const sndBtn = document.getElementById('snd')
sndBtn.addEventListener('click', () => {
  const on = sound.toggle()
  sndBtn.textContent = on ? '♪ Sound on' : '♪ Sound off'
  sndBtn.classList.toggle('on', on)
})
// sound event memory
// ---------- live estimate of money going home ----------
// Central Bank of Uzbekistan: $18.9B received in 2025. ~78% comes from Russia.
// World Bank RPW, Russia → Uzbekistan: 2.65% total cost = 0.84% fee + 1.81% exchange-rate margin.
// Other countries: world average 6.36%, split fee/FX in the same proportion (an assumption).
const LIVE = (() => {
  const perSec = 18.9e9 / (365 * 24 * 3600)
  const ru = 0.78, ruFee = 0.0084, ruFx = 0.0181, other = 0.0636
  const feeRate = ru * ruFee + (1 - ru) * other * (ruFee / (ruFee + ruFx))
  const fxRate = ru * ruFx + (1 - ru) * other * (ruFx / (ruFee + ruFx))
  return { perSec, feeRate, fxRate, start: performance.now() }
})()
const $ = id => document.getElementById(id)
const usd = (v, d = 0) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
$('perSec').textContent = usd(LIVE.perSec)
$('lostSec').textContent = usd(LIVE.perSec * (LIVE.feeRate + LIVE.fxRate))
$('lostYear').textContent = usd(Math.round(18.9e9 * (LIVE.feeRate + LIVE.fxRate) / 1e6)) + ' million'
const liveEls = { sent: $('liveSent'), fees: $('liveFees'), fx: $('liveFx'), tick: $('tickLost'), ticker: $('ticker') }
function updateLive(now) {
  const sec = (now - LIVE.start) / 1000
  const sent = LIVE.perSec * sec
  liveEls.sent.textContent = usd(sent)
  liveEls.fees.textContent = usd(sent * LIVE.feeRate, 2)
  liveEls.fx.textContent = usd(sent * LIVE.fxRate, 2)
  liveEls.tick.textContent = usd(sent * (LIVE.feeRate + LIVE.fxRate), 2)
  liveEls.ticker.style.opacity = sp > 0.33 && sp < 0.97 ? '1' : '0'
}

// ---------- clickable cities ----------
// Official 2025 totals by sending country (Central Bank of Uzbekistan, via kun.uz / daryo.uz).
// Russia is not published as a single number: ~78% of $18.9B. City splits are not published.
const COUNTRY = {
  RU: { name: 'Russia', flag: '🇷🇺', total: 0.78 * 18.9e9, est: true },
  KZ: { name: 'Kazakhstan', flag: '🇰🇿', total: 903e6 },
  KR: { name: 'South Korea', flag: '🇰🇷', total: 612e6 },
  TR: { name: 'Türkiye', flag: '🇹🇷', total: 547e6 },
  US: { name: 'United States', flag: '🇺🇸', total: 665e6 },
  GB: { name: 'United Kingdom', flag: '🇬🇧', total: 188e6 },
  EU: { name: 'European Union', flag: '🇪🇺', total: 563e6 },
  JP: { name: 'Japan', flag: '🇯🇵', total: null },
  AE: { name: 'UAE', flag: '🇦🇪', total: null },
  SA: { name: 'Saudi Arabia', flag: '🇸🇦', total: null },
}
const SRC_COUNTRY = ['RU', 'RU', 'RU', 'RU', 'RU', 'RU', 'KZ', 'KZ', 'KR', 'KR', 'JP', 'TR', 'TR', 'AE', 'SA', 'EU', 'EU', 'EU', 'GB', 'US', 'US']
// Share of household income from money sent from abroad (National Statistics Committee, 2025),
// or from all transfers where only that is published.
const UZ_INFO = {
  ANDIJAN: [30, 'of household income in Andijan region comes from money sent from abroad (2025)'],
  FERGANA: [32.5, 'of household income in Fergana region comes from money sent from abroad (2025)'],
  URGENCH: [31.1, 'of household income in Khorezm region comes from money sent from abroad (2025)'],
  SAMARKAND: [38.5, 'of household income in Samarkand region comes from transfers (2025)'],
  BUKHARA: [30, 'or more of household income in Bukhara region comes from transfers (early 2025)'],
  NAMANGAN: [30, 'or more of household income in Namangan region comes from transfers (early 2025)'],
  NUKUS: [30, 'or more of household income in Karakalpakstan comes from transfers (early 2025)'],
  TERMEZ: [30, 'or more of household income in Surkhandarya region comes from transfers (early 2025)'],
  QARSHI: [30, 'or more of household income in Kashkadarya region comes from transfers (early 2025)'],
  TASHKENT: [null, 'The capital. No regional remittance share is published.'],
}
const picks = [
  ...sources.map(([p, , name], i) => ({ kind: 'src', i, name, p, pos: ll(p[0], p[1], R * 1.012), c: COUNTRY[SRC_COUNTRY[i]] })),
  ...UZ_CITIES.map(([p, name], i) => ({ kind: 'uz', i, name, p, pos: ll(p[0], p[1], R * 1.012) })),
]
const selRing = glow('#ffffff', 0.9); selRing.visible = false; globe.add(selRing)
const card = document.getElementById('cityCard')
let sel = null
const pickV = new THREE.Vector3(), pickN = new THREE.Vector3(), camDir = new THREE.Vector3()
function screenOf(pk, out) {
  pickV.copy(pk.pos).applyMatrix4(globe.matrixWorld)
  pickN.copy(pickV).normalize()
  camDir.copy(camera.position).sub(pickV).normalize()
  const facing = pickN.dot(camDir)
  pickV.project(camera)
  out.x = (pickV.x + 1) / 2 * innerWidth; out.y = (1 - pickV.y) / 2 * innerHeight; out.f = facing
  return out
}
function nearestPick(x, y) {
  let best = null, bd = 30 * 30
  const o = {}
  for (const pk of picks) {
    screenOf(pk, o)
    if (o.f < 0.12) continue
    const d = (o.x - x) ** 2 + (o.y - y) ** 2
    if (d < bd) { bd = d; best = pk }
  }
  return best
}
function openCard(pk) {
  sel = { pk, t0: performance.now() }
  card.classList.remove('show'); void card.offsetWidth
  let html = `<button class="x" aria-label="Close">×</button><small>${pk.kind === 'src' ? 'sending city' : 'receiving city · Uzbekistan'}</small><h3>${pk.name}</h3>`
  if (pk.kind === 'src') {
    const c = pk.c
    html += `<div class="ctry">${c.flag} ${c.name}</div>`
    if (c.total) {
      const share = c.total / 18.9e9 * 100
      html += `<div class="big" data-count="${c.total}">$0</div><div class="lbl">sent to Uzbekistan in 2025 from all of ${c.name}${c.est ? ' (estimate: 78% of the total)' : ''}</div>
        <div class="row"><span>Every second</span><b>${usd(c.total / (365 * 24 * 3600), 2)}</b></div>
        <div class="row"><span>Since you opened this page</span><b class="live-c" data-ps="${c.total / (365 * 24 * 3600)}">$0</b></div>
        <div class="row"><span>Lost to fees + rates (est.)</span><b class="red-t live-c" data-ps="${c.total / (365 * 24 * 3600) * (LIVE.feeRate + LIVE.fxRate)}" data-d="2">$0</b></div>
        <div class="bar2"><i style="--w:${Math.max(1.5, share).toFixed(1)}%"></i></div><div class="lbl">${share.toFixed(1)}% of all money sent home</div>
        <p class="note">Official numbers are per country, not per city.</p>`
    } else {
      html += `<div class="big">n/a</div><div class="lbl">The Central Bank doesn't publish a separate number for ${c.name}. It's part of "other countries".</div>`
    }
  } else {
    const [pct, text] = UZ_INFO[pk.name]
    html += pct != null ? `<div class="big uz-t" data-count="${pct}" data-pct="1">0%</div><div class="lbl">${text}</div>` : `<div class="lbl">${text}</div>`
    html += `<div class="row"><span>Arriving in Uzbekistan now</span><b class="uz-t">${usd(LIVE.perSec)}/s</b></div>
      <div class="row"><span>Since you opened this page</span><b class="uz-t live-c" data-ps="${LIVE.perSec}">$0</b></div>`
  }
  card.innerHTML = html
  card.querySelector('.x').addEventListener('click', e => { e.stopPropagation(); closeCard() })
  card.classList.add('show')
  sound.ching(pk.kind === 'src' ? 1568 : 1318)
}
function closeCard() { sel = null; card.classList.remove('show') }
function updateCard(now, inFiber) {
  if (!sel) { selRing.visible = false; return }
  const o = screenOf(sel.pk, {})
  const hidden = inFiber || o.f < 0.05
  card.style.visibility = hidden ? 'hidden' : 'visible'
  selRing.visible = !hidden
  selRing.position.copy(sel.pk.pos)
  const k = ((now - sel.t0) / 900) % 1
  selRing.scale.setScalar(0.4 + k * 1.4); selRing.material.opacity = 1 - k
  if (innerWidth > 700) {
    const w = card.offsetWidth, h = card.offsetHeight
    let x = o.x + 22, y = o.y - h / 2
    if (x + w > innerWidth - 50) x = o.x - w - 22
    y = Math.min(Math.max(70, y), innerHeight - h - 60)
    card.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`
  }
  // animated count-up, then live counters
  const e = 1 - Math.pow(1 - Math.min(1, (now - sel.t0) / 1400), 3)
  card.querySelectorAll('[data-count]').forEach(el => {
    const v = +el.dataset.count * e
    el.textContent = el.dataset.pct ? v.toFixed(1) + '%' : usd(v)
  })
  const sec = (now - LIVE.start) / 1000
  card.querySelectorAll('.live-c').forEach(el => { el.textContent = usd(+el.dataset.ps * sec, +(el.dataset.d || 0)) })
}
addEventListener('click', e => {
  if (e.target.closest('a, button, .city-card')) return
  if (sp > 0.665 && sp < 0.785) return
  const pk = nearestPick(e.clientX, e.clientY)
  if (pk) openCard(pk); else if (sel) closeCard()
})
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return
  canvas.style.cursor = !(sp > 0.665 && sp < 0.785) && nearestPick(e.clientX, e.clientY) ? 'pointer' : ''
})
addEventListener('keydown', e => { if (e.key === 'Escape') closeCard() })

const S = { coin: false, morph: false, hop: -1, nodes: 0, arrived: false, bit: -1 }

// ---------- scroll + panels ----------
const panels = [...document.querySelectorAll('.panel')].map(el => ({
  el, t: +el.dataset.t, side: el.classList.contains('center') ? 0 : el.classList.contains('right') ? 1 : -1,
}))
const countEl = document.getElementById('count'), barEl = document.getElementById('bar')
const hintEl = document.getElementById('hint'), fadeEl = document.getElementById('fade')
let progress = 0
function readScroll() {
  const max = document.documentElement.scrollHeight - innerHeight
  progress = max > 0 ? clamp01(scrollY / max) : 0
}
addEventListener('scroll', readScroll, { passive: true })
readScroll()
sp = progress

// camera keyframes over the globe: [t, lat, lon, distance]
const CAM = [
  [0.0, 24, 60, 17], [0.06, 36, 56, 16.5], [0.09, 44, 52, 15.5], [0.17, 40, 60, 14], [0.215, 38, 25, 19],
  [0.245, 42, 0, 21], [0.305, 38, 20, 22], [0.36, 21, 54, 10.5], [0.44, 21, 54, 10], [0.48, 24, 55.3, 10],
  [0.64, 40.8, 72.3, 9.5], [0.66, 41, 70, 10], [0.79, 32, 50, 17], [0.82, 30, 35, 20], [0.86, 38, 76, 11],
  [0.89, 37, 80, 10.5], [0.95, 44, 64, 20], [1.0, 48, 62, 24],
]
function camKey(t) {
  let i = 0
  while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++
  const a = CAM[i], b = CAM[i + 1], s = smooth((t - a[0]) / (b[0] - a[0]))
  return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)]
}

// ---------- loop ----------
let last = performance.now(), elapsed = 0, lastCount = -1
const viewOff = new THREE.Vector2()
const tmpV = new THREE.Vector3(), headP = new THREE.Vector3()

function setAlpha(m, a) { m.material.uniforms.uAlpha.value = a; m.visible = a > 0.001 }
function setSpriteAlpha(s, a) { s.material.opacity = Math.min(1, a); s.visible = a > 0.001 }

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now; elapsed += dt
  const time = elapsed * motion
  sp += (progress - sp) * (1 - Math.exp(-dt * 3.5))
  mouseS.lerp(mouse, 1 - Math.exp(-dt * 4))
  dotUniforms.uTime.value = time

  const inFiber = sp > 0.665 && sp < 0.785
  renderPass.scene = inFiber ? fiber : scene

  // fade to black around the fiber scene
  const f1 = 1 - Math.abs(sp - 0.665) / 0.022, f2 = 1 - Math.abs(sp - 0.785) / 0.022
  fadeEl.style.opacity = clamp01(Math.max(f1, f2)).toFixed(3)

  // ----- view offset: push the 3D away from the text panel -----
  let best = 0, bestD = 9
  panels.forEach((p, i) => { const d = Math.abs(sp - p.t); if (d < bestD) { bestD = d; best = i } })
  const mobile = innerWidth <= 700
  const side = panels[best].side
  const tx = mobile ? 0 : side * 0.17 * innerWidth
  const ending = sp > 0.92
  const ty = ending ? -0.3 * innerHeight : mobile && side !== 0 ? 0.16 * innerHeight : 0
  viewOff.x += (tx - viewOff.x) * (1 - Math.exp(-dt * 3))
  viewOff.y += (ty - viewOff.y) * (1 - Math.exp(-dt * 3))
  camera.setViewOffset(innerWidth, innerHeight, viewOff.x, viewOff.y, innerWidth, innerHeight)

  if (!inFiber) {
    // ----- camera over the globe -----
    let [lat, lon, dist] = camKey(sp)
    const cableU = smooth(local(0.48, 0.64))
    if (sp > 0.48 && sp < 0.64) {
      cable.userData.curve.getPointAt(cableU, headP)
      const [hl, hn] = toLatLon(headP)
      lat = hl - 3; lon = hn; dist = 10 + Math.sin(cableU * Math.PI) * 3
    }
    lat += mouseS.y * 3; lon -= mouseS.x * 4
    ll(lat, lon, dist, camera.position)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    keyLight.position.copy(camera.position).add(tmpV.set(3, 5, 0))

    // hero spin, settling as you scroll
    const spin = Math.atan2(Math.sin(time * 0.12), Math.cos(time * 0.12))
    globe.rotation.y = spin * (1 - smooth(sp / 0.06))

    dots.material.uniforms.uHi.value = 0.4 + win(0.13, 0.2) * 0.6 + win(0.86, 1) * 0.6

    // migrants
    const mA = win(0.065, 0.2, 0.03), mDraw = smooth(local(0.06, 0.12))
    migrantArcs.forEach(m => { setAlpha(m, mA); m.material.uniforms.uDraw.value = mDraw; m.material.uniforms.uHead.value = time * 0.35 + m.userData.offset })
    if (sel) migrantArcs.forEach((m, i) => {
      const hit = sel.pk.kind === 'src' ? i === sel.pk.i : i % UZ_CITIES.length === sel.pk.i
      if (!hit) { if (mA < 0.5) setAlpha(m, 0); return }
      setAlpha(m, 1); m.material.uniforms.uDraw.value = 1
      m.material.uniforms.uHead.value = time * 1.1 + m.userData.offset
    })
    sourceMarkers.forEach(s => setSpriteAlpha(s, mA))
    setSpriteAlpha(labels.moscow, win(0.08, 0.19))
    sourceLabels.forEach(l => setSpriteAlpha(l, win(0.075, 0.19)))
    const uzA = win(0.0, 0.2, 0.03) + win(0.86, 1.1)
    uzLabels.forEach(l => setSpriteAlpha(l, uzA))
    uzMarkers.forEach(m => m.scale.setScalar(0.3 + Math.sin(time * 3) * 0.05))
    setSpriteAlpha(labels.uz, win(0.0, 0.2, 0.03))

    // old bank route: slow hops with pauses
    const oA = win(0.215, 0.32, 0.025)
    const cyc = (time * 0.22) % 1
    setAlpha(oldA, oA); setAlpha(oldB, oA)
    oldA.material.uniforms.uHead.value = smooth(cyc / 0.38)
    oldB.material.uniforms.uHead.value = cyc < 0.5 ? -1 : smooth((cyc - 0.5) / 0.38)
    bankBoxes.forEach((b, i) => {
      b.visible = oA > 0.01
      const hit = [cyc < 0.08, cyc > 0.38 && cyc < 0.5, cyc > 0.88][i]
      b.scale.setScalar(oA * (hit ? 1.6 : 1))
      if (hit && S.hop !== i && oA > 0.5) { S.hop = i; sound.thud() }
    })
    setSpriteAlpha(labels.newyork, oA); setSpriteAlpha(labels.dubaiBank, oA); setSpriteAlpha(labels.uzBank, oA)

    // coin in Dubai → packet
    const cA = win(0.315, 0.455, 0.02)
    coin.holder.visible = cA > 0.01
    if (coin.holder.visible) {
      const morph = smooth(local(0.385, 0.405))
      if (cA > 0.5 && !S.coin) { S.coin = true; sound.ching(1318) }
      if (morph > 0.5 !== S.morph) { S.morph = morph > 0.5; if (S.morph) sound.ching(1976) }
      coin.face.map = morph > 0.5 ? coin.faces[1] : coin.faces[0]
      coin.side.color.set(morph > 0.5 ? '#3cc9e0' : '#c99a2e')
      coin.halo.material.color.set(morph > 0.5 ? '#6cf4ff' : '#ffd27a')
      const shrink = 1 - smooth(local(0.44, 0.47))
      coin.holder.position.copy(coinUp).multiplyScalar(R + 0.7 + Math.sin(time * 2) * 0.05 - (1 - shrink) * 0.6)
      coin.holder.scale.setScalar(cA * shrink * (1 + (morph > 0.02 && morph < 0.98 ? 0.4 : 0)))
      coin.pivot.quaternion.copy(camera.quaternion)
      coin.pivot.rotateY(Math.sin(time * 1.8) * 0.7)
      coin.halo.position.set(0, 0, -0.5).applyQuaternion(camera.quaternion)
    }
    setSpriteAlpha(labels.dubai, win(0.22, 0.5))
    if (cA < 0.1) S.coin = false

    // cable + packet
    const cabA = sp > 0.46 ? win(0.47, 1.2, 0.02) * (sp > 0.66 ? 0.55 : 1) : 0
    setAlpha(cable, cabA)
    const cu = sp < 0.48 ? 0 : sp > 0.64 ? 1 : cableU
    cable.material.uniforms.uDraw.value = cu
    cable.material.uniforms.uHead.value = sp > 0.64 ? -1 : cu
    cable.userData.curve.getPointAt(cu, headP)
    packet.position.copy(headP).multiplyScalar(1.004)
    const pk = win(0.455, 0.645, 0.012)
    packet.visible = pk > 0.01
    packet.scale.setScalar(pk * (0.9 + Math.sin(time * 10) * 0.15))
    sound.update(sp, cu, pk > 0.5, false)
    setSpriteAlpha(labels.marseille, win(0.53, 0.6))
    setSpriteAlpha(labels.frankfurt, win(0.56, 0.62))
    setSpriteAlpha(labels.tashkent, win(0.6, 0.66) + win(0.08, 0.19))

    // network check
    const nA = win(0.79, 0.85, 0.02), nP = local(0.79, 0.835)
    nodeArcs.forEach(m => {
      setAlpha(m, nA)
      const h = clamp01((nP - m.userData.delay) / 0.5)
      m.material.uniforms.uDraw.value = h
      m.material.uniforms.uHead.value = h
    })
    nodeMarks.forEach((s, i) => {
      const done = nP >= nodeArcs[i].userData.delay + 0.5
      setSpriteAlpha(s, nA)
      s.scale.setScalar(done ? 0.75 + Math.sin(time * 6 + i) * 0.15 : 0.3)
    })
    setSpriteAlpha(checkLabel, win(0.815, 0.85) * smooth(local(0.81, 0.83)))
    const doneCount = nA > 0.5 ? nodeArcs.filter(m => nP >= m.userData.delay + 0.5).length : 0
    if (doneCount > S.nodes) sound.blip(900 + doneCount * 45, 0.04)
    S.nodes = doneCount

    // arrival in Andijan
    const aA = win(0.86, 1.2, 0.02), drop = smooth(local(0.855, 0.885))
    arrive.holder.visible = aA > 0.01
    arrive.holder.position.copy(andijanUp).multiplyScalar(R + 0.6 + (1 - drop) * 2.5 + Math.sin(time * 2) * 0.04)
    arrive.holder.scale.setScalar(aA * 0.9)
    arrive.pivot.quaternion.copy(camera.quaternion)
    arrive.pivot.rotateY(Math.sin(time * 1.8) * 0.7)
    arrive.halo.position.set(0, 0, -0.5).applyQuaternion(camera.quaternion)
    beam.visible = aA > 0.01
    if (drop > 0.97 && !S.arrived) { S.arrived = true; sound.arrive() }
    if (drop < 0.5) S.arrived = false
    beam.material.opacity = 0.35 * aA * (1 - drop * 0.5)
    setSpriteAlpha(arriveLabel, win(0.875, 0.93))
    setSpriteAlpha(labels.andijan, win(0.6, 0.66) + win(0.86, 1.1))
    homeMarkers.forEach(m => m.scale.setScalar(0.5 + Math.sin(time * 3) * 0.08))
    dubaiMarker.scale.setScalar(0.55)
  } else {
    // ----- inside the fiber -----
    const fl = local(0.665, 0.785)
    camera.up.set(0, 1, 0)
    camera.position.set(0.9 + mouseS.x * 0.8, 0.3 + mouseS.y * 0.6, 22 - fl * 260)
    camera.lookAt(0, 0, camera.position.z - 30)
    const travel = time * 26 + fl * 520
    sound.update(sp, 0, false, true)
    const bitNow = Math.floor((zigLen - travel % zigLen) / SLOT)
    if (bitNow !== S.bit) { S.bit = bitNow; if (BITS[((bitNow % BITS.length) + BITS.length) % BITS.length]) sound.blip(2093, 0.025) }
    ones.forEach((s, i) => {
      const u = ((((s * SLOT + travel) % zigLen) + zigLen) % zigLen) / zigLen
      zig.getPointAt(u, pDummy.position)
      zig.getTangentAt(u, pTan)
      pDummy.lookAt(pTan.add(pDummy.position))
      pDummy.scale.set(1, 1, 7)
      pDummy.updateMatrix()
      pulses.setMatrixAt(i, pDummy.matrix)
    })
    pulses.instanceMatrix.needsUpdate = true
  }

  // ----- panels + HUD -----
  panels.forEach(p => {
    const d = Math.abs(sp - p.t)
    const o = clamp01(1 - (d - 0.01) / 0.018)
    p.el.style.opacity = o.toFixed(3)
    p.el.style.pointerEvents = o > 0.5 ? 'auto' : 'none'
    const shift = (sp - p.t) * -900
    const base = p.side === 0 ? 'translate(-50%,-50%)' : (mobile ? '' : 'translateY(-50%)')
    p.el.style.transform = `${base} translateY(${shift.toFixed(1)}px)`
  })
  if (best !== lastCount && lastCount !== -1) sound.whoosh(best > lastCount)
  if (best !== lastCount) { countEl.textContent = `${String(best + 1).padStart(2, '0')} / ${panels.length}`; lastCount = best }
  barEl.style.height = (sp * 100).toFixed(2) + '%'
  updateLive(now)
  hintEl.style.opacity = sp < 0.015 ? '1' : '0'

  updateCard(now, inFiber)
  composer.render()
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  fitCamera()
  readScroll()
})

requestAnimationFrame(frame)
