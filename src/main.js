import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const canvas = document.getElementById('gl')
const coarse = matchMedia('(pointer: coarse)').matches
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const motion = reduced ? 0.3 : 1

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
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene()
const bg = new THREE.Color('#07060f')
scene.background = bg
scene.fog = new THREE.FogExp2(bg, 0.011)

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600)
function fitFov() {
  const aspect = innerWidth / innerHeight
  // keep the horizontal view wide enough on tall phone screens
  camera.fov = aspect >= 1 ? 60 : Math.min(88, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(30)) / aspect)))
  camera.aspect = aspect
  camera.updateProjectionMatrix()
}
fitFov()

const composer = new EffectComposer(renderer)
composer.setPixelRatio(coarse ? 1 : DPR)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.42)
composer.addPass(bloom)
composer.addPass(new OutputPass())

scene.add(new THREE.HemisphereLight('#b9a6ff', '#1a0f24', 0.9))
const sun = new THREE.DirectionalLight('#ffffff', 1.6)
sun.position.set(5, 10, 6)
scene.add(sun)
const camLight = new THREE.PointLight('#ff7ad9', 40, 40, 1.6)
scene.add(camLight)

// ---------- camera path (keyframes: camera position + look target) ----------
const K = [
  [[0, 0, 9], [0, 0, 0]],          // 0 hero
  [[0, 0, 3], [0, 0, -20]],
  [[1.6, 0.8, -25], [0, 0, -45]],  // rings
  [[-1.6, -0.6, -45], [0, 0, -65]],
  [[0.8, 0.4, -66], [0, 0, -90]],
  [[0, 9, -98], [0, -10, -128]],   // galaxy
  [[11, 7, -124], [0, -10, -132]],
  [[-6, 5, -152], [0, -5, -188]],
  [[0, 7, -176], [0, -4, -206]],   // cube field
  [[0, 5.5, -204], [0, -4, -228]],
  [[0, 3, -232], [0, 0, -272]],    // finale
  [[0, 0.5, -254], [0, 0, -272]],
]
const camCurve = new THREE.CatmullRomCurve3(K.map(k => new THREE.Vector3(...k[0])), false, 'centripetal')
const lookCurve = new THREE.CatmullRomCurve3(K.map(k => new THREE.Vector3(...k[1])), false, 'centripetal')

// ---------- shared noise ----------
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`

// ---------- 1. hero blob ----------
function blobMaterial(hueShift) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmp: { value: 0.35 }, uShift: { value: hueShift } },
    vertexShader: NOISE + /* glsl */`
      uniform float uTime, uAmp;
      varying vec3 vWorld; varying float vN;
      void main(){
        float n = snoise(normal*1.3 + uTime*0.35);
        float n2 = snoise(normal*3.2 - uTime*0.55) * 0.35;
        vec3 p = position + normal * (n + n2) * uAmp;
        vN = n;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uShift;
      varying vec3 vWorld; varying float vN;
      vec3 pal(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0, 0.33, 0.67))); }
      void main(){
        vec3 nrm = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(nrm, V) < 0.0) nrm = -nrm;
        float fres = pow(1.0 - max(dot(nrm, V), 0.0), 2.4);
        vec3 L = normalize(vec3(0.5, 0.8, 0.6));
        float diff = max(dot(nrm, L), 0.0);
        vec3 base = pal(vN*0.45 + fres*0.5 + uTime*0.04 + uShift);
        vec3 col = base*(0.12 + 0.5*diff) + fres*vec3(0.9, 0.45, 1.0)*0.55;
        col += pow(max(dot(reflect(-L, nrm), V), 0.0), 48.0) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}
const blobMat = blobMaterial(0)
const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, coarse ? 28 : 48), blobMat)
scene.add(blob)
const blobSphere = new THREE.Sphere(new THREE.Vector3(), 2.6)
let blobKick = 0

// ---------- 2. ring tunnel ----------
const rings = []
const RING_N = 34
for (let i = 0; i < RING_N; i++) {
  const sides = [3, 4, 6, 64][i % 4]
  const geo = new THREE.TorusGeometry(2.7, sides === 64 ? 0.05 : 0.08, 8, sides)
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((i / RING_N) * 0.9, 0.95, 0.5) })
  const m = new THREE.Mesh(geo, mat)
  const t = THREE.MathUtils.lerp(1.3 / 11, 4.3 / 11, i / (RING_N - 1))
  const p = camCurve.getPoint(t)
  const ahead = camCurve.getPoint(Math.min(t + 0.005, 1))
  m.position.copy(p)
  m.lookAt(ahead)
  m.userData = { spin: (i % 2 ? 1 : -1) * (0.2 + Math.random() * 0.6), base: mat.color.clone() }
  scene.add(m)
  rings.push(m)
}

// ---------- 3. galaxy ----------
const galaxy = (() => {
  const N = coarse ? 14000 : 30000
  const R = 32, ARMS = 4
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3)
  const inner = new THREE.Color('#ffb36b'), outer = new THREE.Color('#5b6cff')
  for (let i = 0; i < N; i++) {
    const r = Math.pow(Math.random(), 1.6) * R
    const arm = ((i % ARMS) / ARMS) * Math.PI * 2
    const bend = r * 0.28
    const rnd = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * (0.4 + r * 0.18)
    pos[i * 3] = Math.cos(arm + bend) * r + rnd()
    pos[i * 3 + 1] = rnd() * 0.5
    pos[i * 3 + 2] = Math.sin(arm + bend) * r + rnd()
    const c = inner.clone().lerp(outer, r / R)
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.14, sizeAttenuation: true, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }))
  pts.position.set(0, -10, -132)
  pts.rotation.x = 0.18
  scene.add(pts)
  // glowing core
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.4, 32, 16), new THREE.MeshBasicMaterial({ color: '#ffd9a8' }))
  pts.add(core)
  return pts
})()

// ---------- background stars ----------
{
  const N = coarse ? 2500 : 5000
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 220
    pos[i * 3 + 1] = (Math.random() - 0.5) * 160
    pos[i * 3 + 2] = 30 - Math.random() * 340
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false })))
}

// ---------- 4. shy cube field ----------
const FIELD = { cx: 0, y: -4, cz: -206, n: coarse ? 36 : 50, gap: 1.2 }
const CUBES = FIELD.n * FIELD.n
const cubeMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.92, 0.92, 0.92),
  new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }),
  CUBES,
)
cubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
cubeMesh.frustumCulled = false
scene.add(cubeMesh)
const cubeXZ = new Float32Array(CUBES * 2)
const cubeLift = new Float32Array(CUBES)
const tmpObj = new THREE.Object3D()
const tmpCol = new THREE.Color()
for (let i = 0; i < CUBES; i++) {
  const gx = i % FIELD.n, gz = Math.floor(i / FIELD.n)
  cubeXZ[i * 2] = FIELD.cx + (gx - FIELD.n / 2) * FIELD.gap
  cubeXZ[i * 2 + 1] = FIELD.cz + (gz - FIELD.n / 2) * FIELD.gap
  cubeMesh.setColorAt(i, tmpCol.setHSL(0.72, 0.5, 0.25))
  tmpObj.position.set(cubeXZ[i * 2], FIELD.y, cubeXZ[i * 2 + 1])
  tmpObj.updateMatrix()
  cubeMesh.setMatrixAt(i, tmpObj.matrix)
}
const fieldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FIELD.y)
const fieldHit = new THREE.Vector3(9999, 0, 9999)

// ---------- 5. finale ----------
const finale = new THREE.Group()
finale.position.set(0, 0, -272)
const bigBlobMat = blobMaterial(0.5)
const bigBlob = new THREE.Mesh(new THREE.IcosahedronGeometry(5, coarse ? 32 : 56), bigBlobMat)
finale.add(bigBlob)
const cage = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(8.5, 1)),
  new THREE.LineBasicMaterial({ color: '#6cf4ff', transparent: true, opacity: 0.6 }),
)
finale.add(cage)
const cage2 = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.OctahedronGeometry(11, 0)),
  new THREE.LineBasicMaterial({ color: '#ff5fd2', transparent: true, opacity: 0.5 }),
)
finale.add(cage2)
scene.add(finale)

// ---------- click debris ----------
const debrisGeos = [
  new THREE.TetrahedronGeometry(0.28),
  new THREE.BoxGeometry(0.34, 0.34, 0.34),
  new THREE.OctahedronGeometry(0.28),
  new THREE.TorusGeometry(0.2, 0.07, 6, 12),
  new THREE.IcosahedronGeometry(0.26),
]
const debrisMats = Array.from({ length: 10 }, (_, i) => {
  const c = new THREE.Color().setHSL(i / 10, 1, 0.55)
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.4 })
})
const debris = []
const MAX_DEBRIS = coarse ? 220 : 450

function burst(x, y) {
  const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  // poke the hero blob if hit
  if (ray.ray.intersectsSphere(blobSphere)) blobKick = 1
  const origin = ray.ray.origin.clone().addScaledVector(ray.ray.direction, 7)
  const count = 26
  for (let i = 0; i < count; i++) {
    if (debris.length >= MAX_DEBRIS) scene.remove(debris.shift().mesh)
    const mesh = new THREE.Mesh(
      debrisGeos[(Math.random() * debrisGeos.length) | 0],
      debrisMats[(Math.random() * debrisMats.length) | 0],
    )
    mesh.position.copy(origin)
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 6)
    v.y += 3
    scene.add(mesh)
    debris.push({ mesh, v, spin: new THREE.Vector3().randomDirection().multiplyScalar(6), life: 0, max: 2.2 + Math.random() * 1.4 })
  }
}

// ---------- input ----------
const ray = new THREE.Raycaster()
const mouse = new THREE.Vector2(0, 0)
const mouseS = new THREE.Vector2(0, 0)
let pointerOn = false
function setPointer(x, y) {
  mouse.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
  pointerOn = true
}
addEventListener('pointermove', e => setPointer(e.clientX, e.clientY))
addEventListener('touchmove', e => { const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY) }, { passive: true })
addEventListener('pointerleave', () => { pointerOn = false })
addEventListener('pointerdown', e => {
  if (e.target.closest('a, button')) return
  setPointer(e.clientX, e.clientY)
  burst(e.clientX, e.clientY)
})
document.getElementById('again').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }))

// ---------- scroll + panels ----------
const panels = [...document.querySelectorAll('.panel')].map(el => ({ el, t: +el.dataset.t }))
const countEl = document.getElementById('count')
const barEl = document.getElementById('bar')
const hintEl = document.getElementById('hint')
let progress = 0, sp = 0
function readScroll() {
  const max = document.documentElement.scrollHeight - innerHeight
  progress = max > 0 ? Math.min(Math.max(scrollY / max, 0), 1) : 0
}
addEventListener('scroll', readScroll, { passive: true })
readScroll()
sp = progress

const BG_STOPS = [
  [0, '#07060f'], [0.2, '#030814'], [0.5, '#0a0312'], [0.72, '#07070b'], [1, '#14051a'],
].map(([t, c]) => [t, new THREE.Color(c)])
function bgAt(t, out) {
  for (let i = 0; i < BG_STOPS.length - 1; i++) {
    const [t0, c0] = BG_STOPS[i], [t1, c1] = BG_STOPS[i + 1]
    if (t <= t1) return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0))
  }
  return out.copy(BG_STOPS[BG_STOPS.length - 1][1])
}
const bump = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w)

// ---------- loop ----------
let last = performance.now(), elapsed = 0
const camPos = new THREE.Vector3(), look = new THREE.Vector3()
let lastCount = -1

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  elapsed += dt
  const time = elapsed * motion
  sp += (progress - sp) * (1 - Math.exp(-dt * 4))
  mouseS.lerp(mouse, 1 - Math.exp(-dt * 5))

  // camera
  camCurve.getPoint(sp, camPos)
  lookCurve.getPoint(sp, look)
  camPos.x += mouseS.x * 0.7
  camPos.y += mouseS.y * 0.45
  camera.position.copy(camPos)
  camera.lookAt(look)
  const ringW = bump(sp, 0.25, 0.16)
  camera.rotateZ(Math.sin(sp * 40) * 0.22 * ringW * motion)
  camLight.position.copy(camPos)

  bgAt(sp, bg)
  scene.fog.color.copy(bg)

  // hero blob
  blobKick *= Math.exp(-dt * 1.6)
  blobMat.uniforms.uTime.value = time
  blobMat.uniforms.uAmp.value = 0.32 + blobKick * 0.9 + Math.abs(mouseS.x) * 0.12 * bump(sp, 0, 0.1)
  blob.rotation.y = time * 0.15 + mouseS.x * 0.6
  blob.rotation.x = mouseS.y * -0.4
  blob.scale.setScalar(1 + blobKick * 0.15)

  // rings
  if (sp < 0.5) {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]
      r.rotateZ(r.userData.spin * dt * motion)
      const pulse = 0.6 + 0.4 * Math.sin(time * 3 - i * 0.5)
      r.material.color.copy(r.userData.base).multiplyScalar(0.35 + pulse * 0.55)
    }
  }

  // galaxy
  galaxy.rotation.y = time * 0.04 + sp * 1.2

  // cube field
  if (sp > 0.55 && sp < 0.95) {
    if (pointerOn) {
      ray.setFromCamera(mouseS, camera)
      if (!ray.ray.intersectPlane(fieldPlane, fieldHit)) fieldHit.set(9999, 0, 9999)
    } else fieldHit.set(9999, 0, 9999)
    for (let i = 0; i < CUBES; i++) {
      const x = cubeXZ[i * 2], z = cubeXZ[i * 2 + 1]
      const dx = x - fieldHit.x, dz = z - fieldHit.z
      const d2 = dx * dx + dz * dz
      const target = d2 < 36 ? (1 - Math.sqrt(d2) / 6) * 3.2 : 0
      cubeLift[i] += (target - cubeLift[i]) * (1 - Math.exp(-dt * (target > cubeLift[i] ? 10 : 2.5)))
      const wave = Math.sin(x * 0.28 + time * 1.4) * Math.cos(z * 0.25 + time * 1.1) * 0.55
      const lift = cubeLift[i]
      tmpObj.position.set(x, FIELD.y + wave - lift * 0.6, z)
      tmpObj.rotation.set(lift * 0.6, lift * 0.9, 0)
      tmpObj.scale.set(1, 1 + lift * 1.4, 1)
      tmpObj.updateMatrix()
      cubeMesh.setMatrixAt(i, tmpObj.matrix)
      const h = 0.72 + wave * 0.05 - lift * 0.08
      cubeMesh.setColorAt(i, tmpCol.setHSL(h, 0.55 + lift * 0.15, 0.22 + lift * 0.16))
    }
    cubeMesh.instanceMatrix.needsUpdate = true
    cubeMesh.instanceColor.needsUpdate = true
  }

  // finale
  bigBlobMat.uniforms.uTime.value = time * 0.8
  bigBlobMat.uniforms.uAmp.value = 0.6 + Math.sin(time * 0.7) * 0.2
  cage.rotation.set(time * 0.1, time * 0.17, 0)
  cage2.rotation.set(-time * 0.07, -time * 0.05, time * 0.03)
  const s = 1 + Math.sin(time * 1.3) * 0.03
  finale.scale.setScalar(s)

  // debris
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]
    d.life += dt
    d.v.y -= 7 * dt
    d.v.multiplyScalar(1 - dt * 0.4)
    d.mesh.position.addScaledVector(d.v, dt)
    d.mesh.rotation.x += d.spin.x * dt
    d.mesh.rotation.y += d.spin.y * dt
    const k = d.life / d.max
    d.mesh.scale.setScalar(k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : Math.min(1, d.life * 8))
    if (d.life >= d.max) { scene.remove(d.mesh); debris.splice(i, 1) }
  }

  // UI
  let best = 0, bestD = 9
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    const d = Math.abs(sp - p.t)
    if (d < bestD) { bestD = d; best = i }
    const o = Math.max(0, 1 - d / 0.07)
    p.el.style.opacity = o.toFixed(3)
    const shift = (sp - p.t) * -400
    const base = p.el.classList.contains('center') ? 'translate(-50%,-50%)' : (innerWidth > 700 ? 'translateY(-50%)' : '')
    p.el.style.transform = `${base} translateY(${shift.toFixed(1)}px)`
  }
  if (best !== lastCount) { countEl.textContent = `0${best + 1} / 0${panels.length}`; lastCount = best }
  barEl.style.height = (sp * 100).toFixed(2) + '%'
  hintEl.style.opacity = sp < 0.02 ? '1' : '0'

  composer.render()
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  fitFov()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  readScroll()
})

requestAnimationFrame(frame)
