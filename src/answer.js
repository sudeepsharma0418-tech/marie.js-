import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'

// The one idea, drawn on the orbit plane with simple numbers:
// r = 4, tangent d = 3, long side 5, drop 1. One unit = RHO / 4 in the scene.
export const RHO = 1.8
const U = RHO / 4

const COLORS = {
  radius: new THREE.Color(0.35, 0.6, 1.0),
  tangent: new THREE.Color(1.0, 0.55, 0.2),
  hyp: new THREE.Color(0.95, 0.97, 1.0),
  drop: new THREE.Color(1.0, 0.45, 0.4),
  path: new THREE.Color(0.55, 0.78, 1.0),
}

function glowLine(points, color, width, loop = false) {
  const pos = []
  points.forEach((p) => pos.push(p.x, p.y, p.z))
  if (loop) pos.push(points[0].x, points[0].y, points[0].z)
  const make = (w, op) => {
    const g = new LineGeometry()
    g.setPositions(pos)
    const m = new LineMaterial({
      color, linewidth: w, transparent: true, opacity: op, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const l = new Line2(g, m)
    l.computeLineDistances()
    l.renderOrder = 10
    l.frustumCulled = false
    return l
  }
  const group = new THREE.Group()
  const core = make(width, 1)
  const halo = make(width * 3.5, 0.18)
  group.add(halo, core)
  group.userData = { core, halo, segments: points.length - 1 + (loop ? 1 : 0) }
  return group
}

// A straight glowing line from a to b, drawn up to `p` (0..1).
function liveSegment(color, width) {
  const g = glowLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)], color, width)
  const x = new THREE.Vector3(1, 0, 0)
  const d = new THREE.Vector3()
  g.set = (a, b, p, opacity = 1) => {
    d.subVectors(b, a)
    const len = d.length()
    g.position.copy(a)
    g.quaternion.setFromUnitVectors(x, d.normalize())
    g.scale.setScalar(Math.max(len * p, 1e-5))
    g.visible = p > 0.001 && opacity > 0.001
    g.userData.core.material.opacity = opacity
    g.userData.halo.material.opacity = 0.18 * opacity
  }
  return g
}

export function createAnswer() {
  const group = new THREE.Group()
  const radius = liveSegment(COLORS.radius, 3.2)
  const tangent = liveSegment(COLORS.tangent, 3.2)
  const hyp = liveSegment(COLORS.hyp, 2.4)
  const drop = liveSegment(COLORS.drop, 3.6)
  group.add(radius, tangent, hyp, drop)

  const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.tangent, transparent: true, depthTest: false })
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 16), arrowMat)
  arrow.renderOrder = 11
  group.add(arrow)

  // Right angle marker, a small square in the corner.
  const square = glowLine([new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-1, 1, 0), new THREE.Vector3(0, 1, 0)], COLORS.hyp, 2)
  group.add(square)

  const frame = { o: new THREE.Vector3(), e1: new THREE.Vector3(), e2: new THREE.Vector3(), n: new THREE.Vector3() }
  const pts = { S0: new THREE.Vector3(), T: new THREE.Vector3(), P1: new THREE.Vector3() }

  let arc = null
  let path = null
  let circle = null
  let pathPts = []

  // Steps around the circle. The first is the big 3/4/5 step, then each
  // step gets smaller, so the path hugs the circle more and more.
  function buildPath() {
    const angles = []
    let a = Math.atan(3 / 4)
    let total = 0
    angles.push(a)
    total += a
    const shrink = [24, 17, 12, 9, 7, 5.5, 4.5, 3.6, 3, 2.5, 2]
    for (const s of shrink) { angles.push(s * Math.PI / 180); total += s * Math.PI / 180 }
    while (total < Math.PI * 2 - 1e-6) {
      const s = Math.min(1.6 * Math.PI / 180, Math.PI * 2 - total)
      angles.push(s)
      total += s
    }
    const out = []
    let th = 0
    const onCircle = (t) => new THREE.Vector3().copy(frame.e1).multiplyScalar(Math.cos(t) * RHO).addScaledVector(frame.e2, Math.sin(t) * RHO)
    out.push(onCircle(0))
    for (const s of angles) {
      // Fly straight along the tangent, then fall back to the circle.
      const tip = onCircle(th).addScaledVector(new THREE.Vector3().copy(frame.e1).multiplyScalar(-Math.sin(th)).addScaledVector(frame.e2, Math.cos(th)), RHO * Math.tan(s))
      out.push(tip)
      th += s
      out.push(onCircle(th))
    }
    return out
  }

  function setFrame(e1, n) {
    frame.e1.copy(e1).normalize()
    frame.n.copy(n).normalize()
    frame.e2.crossVectors(frame.n, frame.e1).normalize()
    pts.S0.copy(frame.e1).multiplyScalar(RHO)
    pts.T.copy(pts.S0).addScaledVector(frame.e2, 3 * U)
    pts.P1.copy(pts.T).normalize().multiplyScalar(RHO)

    ;[arc, path, circle].forEach((o) => o && group.remove(o))
    const arcPts = []
    const end = Math.atan(3 / 4)
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * end
      arcPts.push(new THREE.Vector3().copy(frame.e1).multiplyScalar(Math.cos(t) * RHO).addScaledVector(frame.e2, Math.sin(t) * RHO))
    }
    arc = glowLine(arcPts, COLORS.radius, 3)
    pathPts = buildPath()
    path = glowLine(pathPts, COLORS.path, 2.2)
    const cPts = []
    for (let i = 0; i < 256; i++) {
      const t = (i / 256) * Math.PI * 2
      cPts.push(new THREE.Vector3().copy(frame.e1).multiplyScalar(Math.cos(t) * RHO).addScaledVector(frame.e2, Math.sin(t) * RHO))
    }
    circle = glowLine(cPts, COLORS.radius, 3.4, true)
    group.add(arc, path, circle)

    // Square sits in the corner between the radius (toward the center) and the tangent.
    const sq = 0.11
    square.position.copy(pts.S0)
    const m = new THREE.Matrix4().makeBasis(frame.e1.clone().multiplyScalar(sq), frame.e2.clone().multiplyScalar(sq), frame.n.clone().multiplyScalar(sq))
    square.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.e1, frame.e2, frame.n))
    square.scale.setScalar(sq)
    void m
  }

  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const ghostPos = new THREE.Vector3()
  const tipPos = new THREE.Vector3()

  function setOpacity(obj, o, haloK = 0.18) {
    obj.visible = o > 0.001
    obj.userData.core.material.opacity = o
    obj.userData.halo.material.opacity = o * haloK
  }

  // s holds the scrubbed values from the GSAP timeline.
  function update(s, end = 0) {
    const fadeSteps = 1 - s.tidy
    radius.set(frame.o, pts.S0, s.radius, fadeSteps * Math.min(1, s.radius * 3))
    tangent.set(pts.S0, pts.T, s.tangent, fadeSteps)
    arrow.visible = s.tangent > 0.02 && fadeSteps > 0.01
    tmpA.copy(pts.S0).lerp(pts.T, s.tangent)
    arrow.position.copy(tmpA)
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpB.copy(frame.e2))
    arrowMat.opacity = fadeSteps
    setOpacity(square, s.square * fadeSteps, 0.12)
    hyp.set(frame.o, pts.T, s.hyp, fadeSteps * 0.9)
    // Drop: from T straight toward the center, ending on the circle.
    drop.set(pts.T, pts.P1, s.drop, fadeSteps)
    ghostPos.copy(pts.T).lerp(pts.P1, s.drop)
    setOpacity(arc, s.arc * fadeSteps, 0.3)

    // Repeat: reveal the step path, tip races ahead faster and faster.
    const segs = pathPts.length - 1
    const shown = s.path * segs
    const whole = Math.floor(shown)
    path.userData.core.geometry.instanceCount = Math.min(whole, segs)
    path.userData.halo.geometry.instanceCount = Math.min(whole, segs)
    setOpacity(path, s.path > 0 ? (1 - s.circle * 0.85) : 0, 0.22)
    const i0 = Math.min(whole, segs - 1)
    tipPos.copy(pathPts[i0]).lerp(pathPts[Math.min(i0 + 1, segs)], shown - whole)

    setOpacity(circle, s.circle * (1 - 0.8 * end), 0.14)
    return { ghostPos, tipPos }
  }

  return {
    group, setFrame, update, frame, pts,
    labelAnchors: {
      r: () => tmpA.copy(pts.S0).multiplyScalar(0.55),
      d: () => tmpA.copy(pts.S0).lerp(pts.T, 0.5),
      h: () => tmpA.copy(pts.T).multiplyScalar(0.62),
      one: () => tmpA.copy(pts.T).lerp(pts.P1, 0.5),
      angle: () => tmpA.copy(pts.S0),
    },
    lines: [radius, tangent, hyp, drop, square],
    allLines: () => [radius, tangent, hyp, drop, square, arc, path, circle].filter(Boolean),
  }
}
