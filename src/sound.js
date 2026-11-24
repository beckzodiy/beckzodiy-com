// All sounds are made live with the Web Audio API: no audio files.
// Browsers only allow audio after a click, so sound starts from the toggle button.
let ctx = null, master = null, on = false
let droneGain, droneFilter, cableOsc, cableGain, noiseBuf

function make() {
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  master = ctx.createGain(); master.gain.value = 0
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp).connect(ctx.destination)

  // ambient drone: detuned saws through a low-pass filter
  droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 400; droneFilter.Q.value = 4
  droneGain = ctx.createGain(); droneGain.gain.value = 0.05
  droneFilter.connect(droneGain).connect(master)
  for (const [f, d] of [[55, -6], [55, 7], [82.4, 0], [110, 3]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d
    const g = ctx.createGain(); g.gain.value = f > 100 ? 0.25 : 0.5
    o.connect(g).connect(droneFilter); o.start()
  }
  // slow filter wobble
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07
  const lfoG = ctx.createGain(); lfoG.gain.value = 120
  lfo.connect(lfoG).connect(droneFilter.frequency); lfo.start()

  // the "light in the cable" tone
  cableOsc = ctx.createOscillator(); cableOsc.type = 'sine'; cableOsc.frequency.value = 330
  const vib = ctx.createOscillator(); vib.frequency.value = 6
  const vibG = ctx.createGain(); vibG.gain.value = 6
  vib.connect(vibG).connect(cableOsc.frequency); vib.start()
  cableGain = ctx.createGain(); cableGain.gain.value = 0
  cableOsc.connect(cableGain).connect(master); cableOsc.start()

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
}

export function toggle() {
  if (!ctx) make()
  on = !on
  if (on) ctx.resume()
  master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.15)
  return on
}
export const enabled = () => on

function env(node, t, peak, attack, decay) {
  node.gain.setValueAtTime(0.0001, t)
  node.gain.exponentialRampToValueAtTime(peak, t + attack)
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

// bell-like "ching" (coins)
export function ching(base = 1318) {
  if (!on) return
  const t = ctx.currentTime
  for (const [m, a] of [[1, 0.18], [2.76, 0.08], [5.4, 0.04], [8.9, 0.02]]) {
    const o = ctx.createOscillator(); o.frequency.value = base * m
    const g = ctx.createGain(); env(g, t, a, 0.004, 1.1 / Math.sqrt(m))
    o.connect(g).connect(master); o.start(t); o.stop(t + 1.3)
  }
}

// soft filtered-noise whoosh (section changes)
export function whoosh(up = true) {
  if (!on) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource(); src.buffer = noiseBuf
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2
  f.frequency.setValueAtTime(up ? 300 : 2400, t)
  f.frequency.exponentialRampToValueAtTime(up ? 2400 : 300, t + 0.7)
  const g = ctx.createGain(); env(g, t, 0.12, 0.25, 0.55)
  src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + 1)
}

// low thud (each bank in the old route)
export function thud() {
  if (!on) return
  const t = ctx.currentTime
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25)
  const g = ctx.createGain(); env(g, t, 0.35, 0.005, 0.35)
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.45)
}

// tiny blip (bits of light, network ticks)
export function blip(freq = 1760, vol = 0.05) {
  if (!on) return
  const t = ctx.currentTime
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3500
  const g = ctx.createGain(); env(g, t, vol, 0.002, 0.06)
  o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.1)
}

// happy arpeggio (money arrives in Andijan)
export function arrive() {
  if (!on) return
  const t0 = ctx.currentTime
  ;[523.25, 659.25, 783.99, 1046.5].forEach((fr, i) => {
    const t = t0 + i * 0.09
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr
    const g = ctx.createGain(); env(g, t, 0.14, 0.01, 0.9)
    o.connect(g).connect(master); o.start(t); o.stop(t + 1.1)
  })
  setTimeout(() => ching(1568), 380)
}

// continuous parts, called every frame
export function update(sp, cableU, cableOn, inFiber) {
  if (!ctx || !on) return
  const t = ctx.currentTime
  droneFilter.frequency.setTargetAtTime(inFiber ? 1400 : 300 + sp * 500, t, 0.3)
  droneGain.gain.setTargetAtTime(inFiber ? 0.035 : 0.05, t, 0.3)
  cableGain.gain.setTargetAtTime(cableOn ? 0.05 : 0, t, 0.08)
  cableOsc.frequency.setTargetAtTime(260 + cableU * 520, t, 0.05)
}
