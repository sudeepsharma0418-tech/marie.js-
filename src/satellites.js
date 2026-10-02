import * as THREE from 'three'
import { altToR, angularSpeed, DEG } from './orbits.js'

// Real orbit shells. Counts are trimmed on phones.
export const SHELLS = [
  { key: 'starlink', alt: 550, inc: 53, planes: 72, perPlane: 40, color: [0.89, 0.93, 1.0], size: 2.2 },
  { key: 'oneweb', alt: 1200, inc: 87.9, planes: 18, perPlane: 36, color: [0.49, 0.83, 0.99], size: 2.4 },
  { key: 'gps', alt: 20200, inc: 55, planes: 6, perPlane: 5, color: [0.43, 0.91, 0.72], size: 4.0 },
  { key: 'geo', alt: 35786, inc: 0, planes: 1, perPlane: 420, color: [0.99, 0.83, 0.3], size: 2.6 },
]

const GLSL_ORBIT = /* glsl */ `
  uniform float uTime;
  vec3 orbitPos(float r, float inc, float raan, float u) {
    float cu = cos(u), su = sin(u);
    vec3 p = vec3(cu, su * sin(inc), -su * cos(inc));
    float cO = cos(raan), sO = sin(raan);
    return vec3(p.x * cO + p.z * sO, p.y, -p.x * sO + p.z * cO) * r;
  }
`

function buildOrbits(isMobile) {
  const orbits = [] // [r, inc, raan, u0, omega, size, cr, cg, cb]
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (const s of SHELLS) {
    const planes = s.planes
    const per = isMobile && s.key === 'starlink' ? 22 : isMobile && s.key === 'oneweb' ? 24 : isMobile && s.key === 'geo' ? 260 : s.perPlane
    const r = altToR(s.alt)
    const w = angularSpeed(r)
    for (let p = 0; p < planes; p++) {
      const raan = (p / planes) * Math.PI * (s.key === 'oneweb' ? 1 : 2)
      for (let k = 0; k < per; k++) {
        let u0 = (k / per) * Math.PI * 2 + (p * Math.PI * 2 * 0.37) / per
        let inc = s.inc * DEG
        let rr = r
        if (s.key === 'geo') {
          // A real belt is a bit clumpy and slightly tilted.
          u0 = rnd() * Math.PI * 2
          inc = rnd() * rnd() * 2.5 * DEG
          rr = r * (1 + (rnd() - 0.5) * 0.004)
        }
        if (s.key !== 'geo') { u0 += (rnd() - 0.5) * 0.06; inc += (rnd() - 0.5) * 0.4 * DEG }
        orbits.push([rr, inc, raan + (s.key === 'geo' ? 0 : (rnd() - 0.5) * 0.02), u0, w, s.size, ...s.color])
      }
    }
  }
  return orbits
}

export function createConstellation(isMobile, pixelRatio) {
  const orbits = buildOrbits(isMobile)
  const n = orbits.length

  // Heads: one point per satellite.
  const headGeo = new THREE.BufferGeometry()
  const aOrbit = new Float32Array(n * 4)
  const aMeta = new Float32Array(n * 2)
  const aColor = new Float32Array(n * 3)
  orbits.forEach((o, i) => {
    aOrbit.set(o.slice(0, 4), i * 4)
    aMeta.set([o[4], o[5]], i * 2)
    aColor.set(o.slice(6, 9), i * 3)
  })
  headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  headGeo.setAttribute('aOrbit', new THREE.BufferAttribute(aOrbit, 4))
  headGeo.setAttribute('aMeta', new THREE.BufferAttribute(aMeta, 2))
  headGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3))
  headGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8)

  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uTrail: { value: 1.6 },
  }

  const headMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: GLSL_ORBIT + /* glsl */ `
      attribute vec4 aOrbit;
      attribute vec2 aMeta;
      attribute vec3 aColor;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vNear;
      void main() {
        vec3 p = orbitPos(aOrbit.x, aOrbit.y, aOrbit.z, aOrbit.w + aMeta.x * uTime);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vNear = smoothstep(0.03, 0.2, length(mv.xyz));
        gl_PointSize = clamp(aMeta.y * uPixelRatio * (4.2 / max(d, 0.6)), 1.6 * uPixelRatio, 5.5 * uPixelRatio);
        vColor = aColor;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vNear;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        gl_FragColor = vec4(vColor * 1.6, a * uOpacity * vNear);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const heads = new THREE.Points(headGeo, headMat)
  heads.frustumCulled = false

  // Trails: short arcs behind each satellite. Length follows speed, so the
  // fast low orbits leave long streaks and the far ring leaves almost none.
  const K = isMobile ? 4 : 6
  const verts = n * K * 2
  const tGeo = new THREE.BufferGeometry()
  const tOrbit = new Float32Array(verts * 4)
  const tMeta = new Float32Array(verts * 2)
  const tColor = new Float32Array(verts * 3)
  let v = 0
  orbits.forEach((o) => {
    for (let k = 0; k < K; k++) {
      for (const e of [k, k + 1]) {
        tOrbit.set(o.slice(0, 4), v * 4)
        tMeta.set([o[4], e / K], v * 2)
        tColor.set(o.slice(6, 9), v * 3)
        v++
      }
    }
  })
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  tGeo.setAttribute('aOrbit', new THREE.BufferAttribute(tOrbit, 4))
  tGeo.setAttribute('aMeta', new THREE.BufferAttribute(tMeta, 2))
  tGeo.setAttribute('aColor', new THREE.BufferAttribute(tColor, 3))
  const trailMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: GLSL_ORBIT + /* glsl */ `
      attribute vec4 aOrbit;
      attribute vec2 aMeta;
      attribute vec3 aColor;
      uniform float uTrail;
      varying float vFade;
      varying vec3 vColor;
      void main() {
        vec3 p = orbitPos(aOrbit.x, aOrbit.y, aOrbit.z, aOrbit.w + aMeta.x * (uTime - uTrail * aMeta.y));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vFade = (1.0 - aMeta.y) * smoothstep(0.05, 0.3, length(mv.xyz));
        vColor = aColor;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vFade;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, vFade * vFade * 0.32 * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const trails = new THREE.LineSegments(tGeo, trailMat)
  trails.frustumCulled = false

  const group = new THREE.Group()
  group.add(trails, heads)
  return { group, uniforms, count: n }
}

// A thin ring showing one orbit path.
export function orbitPathLine(r, inc, raan, color, opacity) {
  const pts = []
  const tmp = new THREE.Vector3()
  for (let i = 0; i <= 256; i++) {
    const u = (i / 256) * Math.PI * 2
    const cu = Math.cos(u), su = Math.sin(u)
    tmp.set(cu, su * Math.sin(inc), -su * Math.cos(inc))
    const cO = Math.cos(raan), sO = Math.sin(raan)
    pts.push(new THREE.Vector3(tmp.x * cO + tmp.z * sO, tmp.y, -tmp.x * sO + tmp.z * cO).multiplyScalar(r))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
  return new THREE.Line(geo, mat)
}
