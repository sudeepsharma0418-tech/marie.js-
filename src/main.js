import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import {
  SUN_DIR, DEG, HAYWARD, SPIN0, EARTH_SPIN, latLonDir, mySatPos, orbitPos, altToR, angularSpeed,
  MY_R, MY_INC, MY_RAAN,
} from './orbits.js'
import { createEarth, createSun } from './earth.js'
import { createConstellation, orbitPathLine } from './satellites.js'
import { createStarlink } from './starlink.js'
import { createGround, createBeam, glowSprite } from './ground.js'
import { createAnswer, RHO } from './answer.js'
import { createLabels } from './labels.js'

gsap.registerPlugin(ScrollTrigger)

const isMobile = window.matchMedia('(max-width: 760px)').matches || (navigator.maxTouchPoints > 0 && Math.min(innerWidth, innerHeight) < 820)

// Reduced motion stays live, so a mid session change is respected.
const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
let noMotion = mq.matches

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const range = (x, a, b) => clamp01((x - a) / (b - a))

/* ---------------------------------------------------------------- renderer */
const canvas = document.querySelector('canvas.webgl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
const DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 1.75)
renderer.setPixelRatio(DPR)
renderer.setSize(innerWidth, innerHeight, false)

const composer = new EffectComposer(renderer)
const ground = createGround()
const spaceScene = new THREE.Scene()
const spaceCam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.001, 1500)
const renderPass = new RenderPass(ground.scene, ground.camera)
composer.addPass(renderPass)
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.55, 0.82)
composer.addPass(bloom)
const sun = createSun()
const sunPass = new RenderPass(sun.scene, sun.cam)
sunPass.clear = false
sunPass.clearDepth = true
composer.addPass(sunPass)
composer.addPass(new OutputPass())

/* ---------------------------------------------------------------- textures */
const suf = isMobile ? '2k' : '4k'
const base = import.meta.env.BASE_URL
const loader = new THREE.TextureLoader()
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
blank.needsUpdate = true
const textures = { day: blank, night: blank, clouds: blank, water: blank }
const maxAniso = renderer.capabilities.getMaxAnisotropy()

const earth = createEarth(textures, isMobile)
function loadTex(key, file, srgb) {
  loader.load(`${base}textures/${file}`, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = maxAniso
    t.wrapS = THREE.RepeatWrapping
    const u = { day: 'uDay', night: 'uNight', clouds: 'uClouds', water: 'uWater' }[key]
    earth.mat.uniforms[u].value = t
    if (key === 'day') earth.mat.uniforms.uTexW.value = t.image.width
  })
}
loadTex('day', `day_${suf}.jpg`, true)
loadTex('night', 'night_4k.jpg', false)
loadTex('clouds', `clouds_${suf}.jpg`, false)
loadTex('water', 'water_2k.jpg', false)

/* ---------------------------------------------------------------- space scene */
spaceScene.add(earth.group)

// Star field far away.
{
  const n = isMobile ? 3000 : 6000
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    pos.set([r * Math.cos(a) * 600, u * 600, r * Math.sin(a) * 600], i * 3)
    const b = 0.35 + Math.pow(Math.random(), 4) * 1.4
    const warm = Math.random()
    col.set([b * (0.85 + 0.15 * warm), b * 0.9, b * (1.05 - 0.2 * warm)], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  var stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6 * DPR, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }))
  stars.frustumCulled = false
  spaceScene.add(stars)
}

const constellation = createConstellation(isMobile, DPR)
constellation.uniforms.uTrail.value = 0.55
spaceScene.add(constellation.group)

const myOrbit = orbitPathLine(MY_R, MY_INC, MY_RAAN, 0x3b82f6, 0.0)
spaceScene.add(myOrbit)

const sat = createStarlink()
spaceScene.add(sat.root)
const ghost = createStarlink()
ghost.root.traverse((o) => {
  if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.35, depthWrite: false })
})
spaceScene.add(ghost.root)

const myGlow = glowSprite(0x3b82f6, 1)
myGlow.material.sizeAttenuation = false
spaceScene.add(myGlow)

const spaceBeam = createBeam(0.00025, 0.0012)
spaceScene.add(spaceBeam.mesh)

const sunLight = new THREE.DirectionalLight(0xfff4e6, 3)
spaceScene.add(sunLight, sunLight.target)
const earthShine = new THREE.HemisphereLight(0x0a0d18, 0x6f8fc8, 0.3)
spaceScene.add(earthShine)
// Faint moonlight so the satellite still shows at night.
const moonLight = new THREE.DirectionalLight(0x9fb4ff, 0.3)
spaceScene.add(moonLight, moonLight.target)

const answer = createAnswer()
spaceScene.add(answer.group)

/* ---------------------------------------------------------------- labels */
const labels = createLabels(document.querySelector('.labels'))
const L = {
  mine: labels.add({ text: 'My satellite', cls: 'mine', priority: 10, dx: 14, dy: -10 }),
  iss: labels.add({ text: 'ISS', priority: 6, dx: 10, dy: -10 }),
  hubble: labels.add({ text: 'Hubble', priority: 5, dx: 10, dy: 4 }),
  gps: labels.add({ text: 'GPS', priority: 4, dx: 10, dy: -10 }),
  goes: labels.add({ text: 'GOES-16', priority: 4, dx: 10, dy: -10 }),
  r: labels.add({ text: 'r = 4', cls: 'math blue', priority: 9, dx: -16, dy: -14, anchor: 'right' }),
  d: labels.add({ text: 'd = 3', cls: 'math orange', priority: 9, dx: 0, dy: -46, anchor: 'center' }),
  h: labels.add({ text: '5', cls: 'math white', priority: 8, dx: 18, dy: 6 }),
  one: labels.add({ text: '1', cls: 'math drop', priority: 9, dx: 18, dy: 0, anchor: 'left' }),
  ang: labels.add({ text: '90°', cls: 'math white', priority: 7, dx: 12, dy: 12 }),
}
const NAMED = {
  iss: { r: altToR(420), inc: 51.6 * DEG, raan: 2.1, u0: 0.4 },
  hubble: { r: altToR(540), inc: 28.5 * DEG, raan: 4.0, u0: 2.2 },
  gps: { r: altToR(20200), inc: 55 * DEG, raan: 1.2, u0: 1.0 },
}
const GOES_LON = -75.2

/* ---------------------------------------------------------------- scroll state */
const S = { beam: 0, tilt: 0, fly: 0, zoom: 0, ride: 0, q: 0, end: 0 }
const A = { in: 0, radius: 0, tangent: 0, square: 0, hyp: 0, drop: 0, arc: 0, path: 0, circle: 0, tidy: 0 }

let lenis = null
function setupLenis() {
  if (noMotion || lenis) return
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
  lenis.on('scroll', ScrollTrigger.update)
}
setupLenis()
gsap.ticker.add((time) => { if (lenis) lenis.raf(time * 1000) })
gsap.ticker.lagSmoothing(0)

mq.addEventListener('change', (e) => {
  noMotion = e.matches
  if (noMotion && lenis) { lenis.destroy(); lenis = null } else setupLenis()
})

const st = (trigger, extra = {}) => ({ trigger, start: 'top top', end: 'bottom bottom', scrub: 1, ...extra })

gsap.timeline({ scrollTrigger: st('#connect', { start: 'top bottom', end: 'bottom bottom' }) })
  .to(S, { tilt: 1, duration: 1, ease: 'none' }, 0)
  .to(S, { beam: 1, duration: 0.7, ease: 'none' }, 0.2)

gsap.to(S, { fly: 1, ease: 'none', scrollTrigger: st('#fly') })
gsap.to(S, { zoom: 1, ease: 'none', scrollTrigger: st('#swarm') })

// Ride: the camera dives in, then night turns to day. Captions follow.
{
  const caps = gsap.utils.toArray('.captions li')
  const tl = gsap.timeline({ scrollTrigger: st('#ride') })
  tl.to(S, { ride: 1, duration: 10, ease: 'none' }, 0)
  tl.fromTo('.ride-intro', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 1.2)
  tl.to('.ride-intro', { autoAlpha: 0, y: -10, duration: 0.6 }, 3.0)
  const at = [[1.6, 2.7], [2.8, 3.8], [3.9, 5.6], [6.2, 9.6]]
  caps.forEach((c, i) => {
    tl.fromTo(c, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4 }, at[i][0])
    tl.to(c, { autoAlpha: 0, y: -8, duration: 0.4 }, at[i][1])
  })
}

// The question, big and centered over the moving view.
gsap.timeline({ scrollTrigger: st('#question') })
  .to(S, { q: 1, duration: 4, ease: 'none' }, 0)
  .fromTo('.question .big', { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, duration: 1 }, 0.3)
  .fromTo('.question .sub', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 1.4)
  .to(['.question .big', '.question .sub'], { autoAlpha: 0, y: -16, duration: 0.7 }, 3.3)

// The answer: one timeline for every step of the drawing.
{
  const steps = gsap.utils.toArray('.mstep')
  const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: st('#answer') })
  tl.to(A, { in: 1, duration: 1.0, ease: 'power1.inOut' }, 0)
  tl.fromTo('.answer .math', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.6)
  tl.to(A, { radius: 1, duration: 0.9 }, 1.1)
  tl.to(A, { tangent: 1, duration: 0.9 }, 2.4)
  tl.to(A, { square: 1, duration: 0.4 }, 3.1)
  tl.to(A, { hyp: 1, duration: 0.9 }, 3.9)
  tl.to(A, { drop: 1, duration: 0.9, ease: 'power2.in' }, 5.2)
  tl.to(A, { arc: 1, duration: 0.5 }, 6.1)
  tl.to(A, { path: 1, duration: 1.8, ease: 'power2.in' }, 6.9)
  tl.to(A, { circle: 1, duration: 0.6 }, 8.6)
  tl.to(A, { tidy: 1, duration: 0.6 }, 8.9)
  tl.fromTo('.takeaway', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 9.0)
  const at = [1.1, 2.4, 3.9, 5.2, 6.9, 10.2]
  steps.forEach((el, i) => {
    tl.fromTo(el, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3 }, at[i])
    if (i < steps.length - 1) tl.to(el, { autoAlpha: 0, y: -6, duration: 0.25 }, at[i + 1] - 0.28)
  })
  tl.to({}, { duration: 0.4 }, 9.6)
}

gsap.to(S, { end: 1, ease: 'none', scrollTrigger: st('#made', { endTrigger: '#closing', end: 'bottom bottom' }) })

/* ---------------------------------------------------------------- ride geometry */
// A great circle that passes from night into day, with the Sun in its plane,
// so the Sun rises straight ahead.
const W = new THREE.Vector3(0, 0.35, 1).addScaledVector(SUN_DIR, -SUN_DIR.dot(new THREE.Vector3(0, 0.35, 1))).normalize()
const PHI0 = 141 * DEG
const PHI1 = 62 * DEG
const RIDE_R = 1.14
const rideDir = (phi, out = new THREE.Vector3()) => out.copy(SUN_DIR).multiplyScalar(Math.cos(phi)).addScaledVector(W, Math.sin(phi)).normalize()
const rideVel = (phi, out = new THREE.Vector3()) => out.copy(SUN_DIR).multiplyScalar(Math.sin(phi)).addScaledVector(W, -Math.cos(phi)).normalize()
// Where on the ride the Sun clears the horizon, seen from the satellite.
const RP_RISE = (PHI0 - (Math.PI - Math.asin(1 / RIDE_R))) / (PHI0 - PHI1)
const RIDE_N = new THREE.Vector3().crossVectors(rideDir(PHI0), rideVel(PHI0)).normalize()

// Turn the Earth so the start of the ride is over North Carolina, heading
// north east along the East Coast, like the famous ISS night photo.
const qAlign = (() => {
  const lat = 31.2, lon = -87.6, heading = 46 * DEG
  const e = latLonDir(lat, lon)
  const la = lat * DEG, lo = lon * DEG
  const north = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo))
  const east = new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo))
  const h = north.multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading)).normalize()
  const objM = new THREE.Matrix4().makeBasis(e, h, new THREE.Vector3().crossVectors(e, h))
  const p = rideDir(PHI0), v = rideVel(PHI0)
  const worldM = new THREE.Matrix4().makeBasis(p, v, new THREE.Vector3().crossVectors(p, v))
  const m = worldM.multiply(objM.transpose())
  return new THREE.Quaternion().setFromRotationMatrix(m)
})()
const SLIDE = 0.0011 * 1.6 // rad per second, about real orbital speed

// Answer frame: the orbit plane of the ride, frozen where the ride ends.
answer.setFrame(rideDir(PHI1), RIDE_N)

/* ---------------------------------------------------------------- camera rig */
const pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 42, sx: 0, sy: 0 }
const poseB = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 42, sx: 0, sy: 0 }
const _da = new THREE.Vector3(), _db = new THREE.Vector3()

// Blend toward pose B. Positions swing around the Earth instead of cutting
// through it, which keeps every move smooth.
function blendPose(a, b, t) {
  if (t <= 0) return
  if (t >= 1) { copyPose(a, b); return }
  const ra = a.pos.length(), rb = b.pos.length()
  _da.copy(a.pos).normalize()
  _db.copy(b.pos).normalize()
  const ang = _da.angleTo(_db)
  if (ang > 1e-4) {
    const axis = new THREE.Vector3().crossVectors(_da, _db)
    if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0)
    _da.applyAxisAngle(axis.normalize(), ang * t)
  }
  const r = Math.exp(Math.log(ra) * (1 - t) + Math.log(rb) * t)
  a.pos.copy(_da).multiplyScalar(r)
  a.look.lerp(b.look, t)
  a.up.lerp(b.up, t).normalize()
  a.fov += (b.fov - a.fov) * t
  a.sx += (b.sx - a.sx) * t
  a.sy += (b.sy - a.sy) * t
}
function copyPose(a, b) {
  a.pos.copy(b.pos); a.look.copy(b.look); a.up.copy(b.up); a.fov = b.fov; a.sx = b.sx; a.sy = b.sy
}
function setPose(p, pos, look, up, fov, sx = 0, sy = 0) {
  p.pos.copy(pos); p.look.copy(look); p.up.copy(up); p.fov = fov; p.sx = sx; p.sy = sy
}

// Keep a sensible framing on tall phone screens.
function fitFov(fovV, aspect, minHFov) {
  const h = 2 * Math.atan(Math.tan((fovV * DEG) / 2) * aspect) / DEG
  if (h >= minHFov) return fovV
  return Math.min(2 * Math.atan(Math.tan((minHFov * DEG) / 2) / aspect) / DEG, 100)
}

function applyCamera(cam, p, aspect) {
  cam.position.copy(p.pos)
  cam.up.copy(p.up)
  cam.lookAt(p.look)
  cam.fov = p.fov
  cam.aspect = aspect
  cam.updateProjectionMatrix()
  // Lens shift: moves the subject sideways without turning the camera.
  cam.projectionMatrix.elements[8] = -p.sx
  cam.projectionMatrix.elements[9] = -p.sy
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
}

/* ---------------------------------------------------------------- frame loop */
let simT = 0 // space clock, screen seconds
let rideT = 0 // ride clock for the ground sliding by
let orbitA = 0 // answer: angle of the satellite on the finished circle
let flowT = 0 // general clock for small motions
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3()
const satPos = new THREE.Vector3(), satA = new THREE.Vector3(), hay = new THREE.Vector3()
const rHat = new THREE.Vector3(), vHat = new THREE.Vector3(), zHat = new THREE.Vector3()
const qSpin = new THREE.Quaternion(), qTarget = new THREE.Quaternion(), qSlide = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)
const fadeEl = document.querySelector('.fade')
const timer = new THREE.Timer()
timer.connect(document)

function frame(timestamp) {
  timer.update(timestamp)
  const realDt = Math.min(timer.getDelta(), 0.1)
  const dt = noMotion ? 0 : realDt
  const w = innerWidth, h = innerHeight, aspect = w / h
  labels.reset()
  const portrait = aspect < 0.9
  flowT += dt

  const inSpace = S.fly >= 0.5
  const fGround = smooth(range(S.fly, 0, 0.5))
  const fSpace = smooth(range(S.fly, 0.5, 1))
  fadeEl.style.opacity = (1 - Math.min(1, Math.abs(S.fly - 0.5) / 0.07)).toFixed(3) * 0.92

  let vis = 0
  let flareExtra = 0

  if (!inSpace) {
    /* ---------------- hero, connect, first half of the fly up */
    const g = ground
    g.skyMat.uniforms.uTime.value += realDt
    g.skyMat.uniforms.uAlt.value = fGround
    g.beam.mat.uniforms.uTime.value += dt
    g.beam.mat.uniforms.uProgress.value = smooth(S.beam)
    g.sat.material.opacity = 0.6 + 0.4 * Math.sin(flowT * 3.0) * 0.5 + 0.2

    const heroPos = tmp.set(portrait ? 3 : -2, 1.2, portrait ? 34 : 30)
    const heroLook = tmp2.set(portrait ? 3 : -13, portrait ? 21 : 19, -60)
    // Tilt up to find the satellite.
    const upLook = tmp3.copy(g.satPos)
    const lookT = smooth(S.tilt) * 0.85
    pose.pos.copy(heroPos)
    pose.look.copy(heroLook).lerp(upLook, lookT)
    // Rise along the beam, a little to the side so we can see it.
    const dir = new THREE.Vector3().subVectors(g.satPos, g.dishTop).normalize()
    const side = new THREE.Vector3().crossVectors(dir, Y).normalize()
    const along = g.dishTop.clone().addScaledVector(dir, 1620).addScaledVector(side, 40)
    pose.pos.lerp(along, Math.pow(fGround, 1.6))
    if (fGround > 0) pose.look.lerp(g.satPos, Math.min(1, fGround * 2))
    pose.up.set(0, 1, 0)
    pose.fov = fitFov(50, aspect, 46)
    pose.sx = portrait ? 0 : 0
    pose.sy = 0
    applyCamera(g.camera, pose, aspect)
    renderPass.scene = g.scene
    renderPass.camera = g.camera
    labels.commit()
  } else {
    /* ---------------- space */
    simT += dt
    rideT += dt * (S.ride > 0 ? 1 : 0)

    // Earth orientation: real spin, then a smooth hand over to the ride.
    qSpin.setFromAxisAngle(Y, SPIN0 + EARTH_SPIN * simT)
    const dive = smooth(range(S.ride, 0, 0.16))
    qSlide.setFromAxisAngle(RIDE_N, -SLIDE * rideT)
    qTarget.copy(qSlide).multiply(qAlign)
    earth.earth.quaternion.copy(qSpin).slerp(qTarget, dive)
    earth.mat.uniforms.uCloudShift.value = (flowT * 0.00035) % 1

    // My satellite.
    mySatPos(simT, satA)
    const rp = range(S.ride, 0.16, 1)
    const phi = PHI0 + (PHI1 - PHI0) * rp
    const rideP = rideDir(phi, tmp).multiplyScalar(RIDE_R)
    satPos.copy(satA)
    if (dive > 0) {
      const ra = satA.length()
      const da = satA.clone().normalize(), db = rideP.clone().normalize()
      const ang = da.angleTo(db)
      if (ang > 1e-5) da.applyAxisAngle(new THREE.Vector3().crossVectors(da, db).normalize(), ang * dive)
      satPos.copy(da).multiplyScalar(ra + (RIDE_R - ra) * dive)
    }
    // Answer: pull the satellite out to the big diagram circle.
    const ain = smooth(A.in)
    if (ain > 0) {
      const dEnd = rideDir(PHI1, tmp2)
      satPos.lerp(dEnd.multiplyScalar(RHO), ain)
    }

    // Satellite frame: up away from Earth, forward along the flight.
    rHat.copy(satPos).normalize()
    if (dive > 0.5 || ain > 0) rideVel(phi, vHat)
    else {
      mySatPos(simT + 0.05, tmp3)
      vHat.subVectors(tmp3, satA).normalize()
    }
    vHat.addScaledVector(rHat, -vHat.dot(rHat)).normalize()
    zHat.crossVectors(vHat, rHat).normalize()

    // Answer drawing.
    const ans = answer.update(A, S.end)
    let modelPos = satPos
    if (A.path > 0 && A.circle < 1) modelPos = ans.tipPos
    if (A.circle > 0) {
      orbitA += dt * 0.28 * A.circle
      const e1 = answer.frame.e1, e2 = answer.frame.e2
      const c = tmp3.copy(e1).multiplyScalar(Math.cos(orbitA) * RHO).addScaledVector(e2, Math.sin(orbitA) * RHO)
      modelPos = c.clone().lerp(ans.tipPos, 1 - smooth(range(A.circle, 0, 0.4)))
    } else orbitA = 0
    if (modelPos !== satPos) {
      rHat.copy(modelPos).normalize()
      vHat.crossVectors(answer.frame.n, rHat).normalize()
      zHat.crossVectors(vHat, rHat).normalize()
    }

    const m = 0.004 + (0.3 - 0.004) * ain
    sat.root.position.copy(modelPos)
    if (ain > 0.5) {
      // In the diagram, turn the satellite so its panel faces the viewer
      // and trails behind it, away from the tangent line.
      const nX = answer.frame.n.clone().negate()
      sat.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(nX, rHat, vHat.clone().negate()))
    } else sat.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vHat, rHat, zHat))
    sat.root.scale.setScalar(m)

    // Ghost satellite at the end of the tangent, falling back to the circle.
    const ghostOn = smooth(range(A.hyp, 0.8, 1)) * (1 - smooth(range(A.path, 0, 0.12)))
    ghost.root.visible = ghostOn > 0.01
    ghost.root.position.copy(ans.ghostPos)
    ghost.root.quaternion.copy(sat.root.quaternion)
    ghost.root.scale.setScalar(m)
    ghost.root.traverse((o) => { if (o.isMesh) o.material.opacity = 0.4 * ghostOn })

    // Sunlight on the satellite, with the Earth's shadow.
    const b = satPos.dot(SUN_DIR)
    const dAxis = Math.sqrt(Math.max(satPos.lengthSq() - b * b, 0))
    const lit = b > 0 ? 1 : smooth(range(dAxis, 0.995, 1.03))
    sunLight.position.copy(satPos).addScaledVector(SUN_DIR, 5)
    sunLight.target.position.copy(satPos)
    sunLight.intensity = 1.9 * lit
    // Moonlight comes from behind and above, so it never glares into the camera.
    moonLight.position.copy(satPos).addScaledVector(rHat, 1).addScaledVector(vHat, -1.2)
    moonLight.target.position.copy(satPos)
    const dayBelow = smooth(range(rHat.dot(SUN_DIR), -0.2, 0.5))
    earthShine.intensity = 0.32 + 1.1 * dayBelow
    earthShine.groundColor.setRGB(0.45 + 0.1 * (1 - dayBelow), 0.55, 0.85)

    // Sunrise flash on the panel, strongest right as the Sun clears the horizon.
    const glint = lit * Math.exp(-Math.pow((rp - RP_RISE - 0.025) / 0.05, 2)) * dive
    sat.panelMat.emissiveIntensity = glint * 2.2
    flareExtra = glint * 1.4

    // Highlight of my satellite when far away.
    const camDistToSat = spaceCam.position.distanceTo(satPos)
    myGlow.position.copy(satPos)
    const zoomT = smooth(S.zoom)
    myGlow.scale.setScalar(0.045 * (0.6 + 0.4 * Math.sin(flowT * 3)) + 0.02)
    myGlow.material.opacity = smooth(range(camDistToSat, 0.05, 0.5)) * (1 - dive) * (1 - ain) + 0.7 * smooth(range(ain, 0.7, 1))
    if (ain > 0) myGlow.position.copy(modelPos)
    myOrbit.material.opacity = 0.45 * smooth(range(S.zoom, 0.25, 0.6)) * (1 - dive)

    // Beam from Hayward up to the satellite, only at the start.
    latLonDir(HAYWARD.lat, HAYWARD.lon, hay).applyQuaternion(earth.earth.quaternion)
    spaceBeam.span(hay, satPos)
    spaceBeam.mat.uniforms.uProgress.value = 1
    spaceBeam.mat.uniforms.uTime.value += dt
    spaceBeam.mat.uniforms.uOpacity.value = 1 - smooth(range(fSpace, 0.35, 0.8))
    spaceBeam.mesh.visible = spaceBeam.mat.uniforms.uOpacity.value > 0.01

    // Constellation fades in as we pull back, out as we dive.
    constellation.uniforms.uTime.value = simT
    constellation.uniforms.uOpacity.value = (0.35 + 0.65 * smooth(range(S.zoom, 0, 0.5))) * (1 - dive) * smooth(range(fSpace, 0, 0.3))
    constellation.group.visible = constellation.uniforms.uOpacity.value > 0.01

    // Night lights a bit brighter for the ride along.
    earth.mat.uniforms.uNightBoost.value = 1 - 0.25 * dive
    stars.material.opacity = 1 - 0.6 * dayBelow * dive

    /* ---- camera poses */
    // A: just below the satellite, looking up along the beam.
    const beamDir = tmp.subVectors(satPos, hay).normalize()
    const sideB = tmp2.crossVectors(beamDir, rHat).normalize()
    if (sideB.lengthSq() < 0.5) sideB.copy(zHat)
    setPose(pose,
      tmp3.copy(satPos).addScaledVector(beamDir, -0.07).addScaledVector(sideB, 0.004),
      satPos, zHat, fitFov(50, aspect, 46))

    // B: close to the satellite, Earth curving below.
    const D = m * 1.05
    setPose(poseB,
      tmp3.copy(satPos).addScaledVector(vHat, -0.85 * D).addScaledVector(rHat, 0.95 * D).addScaledVector(zHat, 1.25 * D),
      tmp.copy(satPos).addScaledVector(rHat, -0.35 * D).addScaledVector(zHat, 0.45 * D),
      rHat, fitFov(40, aspect, 52), 0, portrait ? -0.12 : 0)
    blendPose(pose, poseB, fSpace)

    // C: the whole Earth with every satellite, then far out to the outer rings.
    const orbitCam = flowT * 0.012
    const viewDir = tmp.set(Math.cos(70 * DEG + orbitCam), 0.42, -Math.sin(70 * DEG + orbitCam)).normalize()
    setPose(poseB, tmp3.copy(viewDir).multiplyScalar(portrait ? 5.6 : 3.9), new THREE.Vector3(0, 0, 0), Y, fitFov(42, aspect, 40), portrait ? 0 : 0.42, portrait ? 0.5 : 0)
    blendPose(pose, poseB, smooth(range(S.zoom, 0, 0.45)))
    const viewDir2 = tmp.set(Math.cos(62 * DEG + orbitCam), 0.55, -Math.sin(62 * DEG + orbitCam)).normalize()
    setPose(poseB, tmp3.copy(viewDir2).multiplyScalar(portrait ? 30 : 19), new THREE.Vector3(0, 0, 0), Y, fitFov(42, aspect, 40), portrait ? 0 : 0.28, portrait ? 0.45 : 0)
    blendPose(pose, poseB, smooth(range(S.zoom, 0.55, 1)))

    // D: ride along. Sitting on the satellite, panel and body at the edges,
    // looking forward and down at the Earth.
    const pitch = (portrait ? 33 : 36) * DEG
    const sway = Math.sin(flowT * 0.21) * 0.004
    const cp = tmp3.copy(satPos).addScaledVector(vHat, -0.36 * m).addScaledVector(rHat, 0.42 * m).addScaledVector(zHat, 1.5 * m)
    const fwd = tmp.copy(vHat).multiplyScalar(Math.cos(pitch + sway)).addScaledVector(rHat, -Math.sin(pitch + sway))
    setPose(poseB, cp, cp.clone().add(fwd), rHat, portrait ? 78 : 62, 0, 0)
    blendPose(pose, poseB, dive)

    // E: the answer diagram, with the camera slowly orbiting it.
    if (ain > 0) {
      const f = answer.frame
      const swing = Math.sin(flowT * 0.18) * 0.12 + A.path * 0.3 + S.end * 0.25
      const look = new THREE.Vector3().copy(f.e1).multiplyScalar(0.3).addScaledVector(f.e2, 0.15)
      // Look from the side where the tangent points to the right on screen.
      const viewD = new THREE.Vector3().copy(f.n).multiplyScalar(-Math.cos(0.38)).addScaledVector(f.e2, -Math.sin(0.38))
      viewD.applyAxisAngle(f.e1, swing).normalize()
      const fov = 38
      const t = Math.tan((fov * DEG) / 2)
      const dist = Math.max(2.55 / t, 2.2 / (t * aspect)) * (1 + 0.25 * S.end)
      const sx = portrait ? 0 : 0.3
      const sy = portrait ? 0.46 : 0.02
      setPose(poseB, viewD.multiplyScalar(dist).add(look), look, f.e1, fov, sx, sy)
      blendPose(pose, poseB, ain)
    }

    applyCamera(spaceCam, pose, aspect)
    // Near plane follows the closest thing, so close ups stay sharp.
    const nearest = Math.min(spaceCam.position.distanceTo(sat.root.position) - m * 0.7, spaceCam.position.length() - 1.03)
    spaceCam.near = THREE.MathUtils.clamp(nearest * 0.35, 0.00005, 0.5)
    spaceCam.far = 1500
    applyCamera(spaceCam, pose, aspect)

    renderPass.scene = spaceScene
    renderPass.camera = spaceCam

    /* ---- labels */
    const showSats = S.zoom > 0.5 && dive < 0.05
    labels.place(L.mine, satPos, spaceCam, w, h, S.zoom > 0.25 && dive < 0.05)
    for (const k of ['iss', 'hubble', 'gps']) {
      const o = NAMED[k]
      orbitPos(o.r, o.inc, o.raan, o.u0 + angularSpeed(o.r) * simT, tmp)
      labels.place(L[k], tmp, spaceCam, w, h, showSats)
    }
    const geoR = altToR(35786)
    const goesLon = GOES_LON * DEG + SPIN0 + EARTH_SPIN * simT
    tmp.set(Math.cos(goesLon) * geoR, 0, -Math.sin(goesLon) * geoR)
    labels.place(L.goes, tmp, spaceCam, w, h, S.zoom > 0.75 && dive < 0.05)

    const mathOn = ain > 0.9 && A.tidy < 0.5
    const lr = A.radius, lt = A.tangent, lh = A.hyp, ld = A.drop
    labels.setText(L.r, `r = ${lr < 1 ? (4 * lr).toFixed(1) : '4'}`)
    labels.setText(L.d, `d = ${lt < 1 ? (3 * lt).toFixed(1) : '3'}`)
    labels.setText(L.h, lh < 1 ? (5 * lh).toFixed(1) : '5')
    labels.setText(L.one, ld < 1 ? `drop ${ld.toFixed(1)}` : 'drop 1')
    labels.place(L.r, answer.labelAnchors.r(), spaceCam, w, h, mathOn && lr > 0.15, false)
    labels.place(L.d, answer.labelAnchors.d(), spaceCam, w, h, mathOn && lt > 0.15, false)
    labels.place(L.h, answer.labelAnchors.h(), spaceCam, w, h, mathOn && lh > 0.15 && A.path < 0.05, false)
    labels.place(L.one, answer.labelAnchors.one(), spaceCam, w, h, mathOn && ld > 0.15 && A.path < 0.05, false)
    labels.place(L.ang, answer.labelAnchors.angle(), spaceCam, w, h, mathOn && A.square > 0.5 && A.hyp < 0.3, false)
    labels.commit()

    vis = sun.update(spaceCam, aspect, flareExtra)
  }

  if (!inSpace) sun.update(ground.camera, aspect, 0)
  sun.scene.visible = inSpace && vis > 0.001
  composer.render()
}

/* ---------------------------------------------------------------- resize, pause */
function resize() {
  const w = innerWidth, h = innerHeight
  renderer.setSize(w, h, false)
  composer.setSize(w, h)
  bloom.resolution.set(w / 2, h / 2)
  answer.allLines().forEach((g) => g.traverse((o) => { if (o.material && o.material.resolution) o.material.resolution.set(w * DPR, h * DPR) }))
  labels.measure()
}
window.addEventListener('resize', resize)
resize()

// Pause rendering when the tab is hidden or the page is offscreen.
let running = false
function start() { if (!running) { running = true; renderer.setAnimationLoop(frame) } }
function stop() { if (running) { running = false; renderer.setAnimationLoop(null) } }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()))
const io = new IntersectionObserver((entries) => {
  const anyVisible = entries.some((e) => e.isIntersecting)
  if (anyVisible && !document.hidden) start()
  else if (!anyVisible) stop()
})
io.observe(canvas)
start()

// Skip link: jump straight to the math.
document.querySelector('.skip').addEventListener('click', (e) => {
  const target = document.querySelector('#answer')
  e.preventDefault()
  const y = target.getBoundingClientRect().top + window.scrollY + window.innerHeight * 1.2
  if (lenis) lenis.scrollTo(y, { immediate: true })
  else window.scrollTo(0, y)
  target.focus({ preventScroll: true })
})
