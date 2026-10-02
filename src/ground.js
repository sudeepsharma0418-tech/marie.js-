import * as THREE from 'three'

// Hero scene in meters. Camera looks east toward the Hayward hills, where
// the dawn glow sits. The satellite hangs high in the sky to the north east.

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`
const skyFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uAlt;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float el = d.y;
    float toSun = max(dot(d, normalize(uSunDir)), 0.0);
    float h = clamp(el, -0.2, 1.0);

    // Dawn gradient: deep blue up high, warm near the eastern horizon.
    vec3 zenith = vec3(0.025, 0.05, 0.13);
    vec3 mid = vec3(0.09, 0.15, 0.33);
    vec3 horizonCool = vec3(0.42, 0.36, 0.52);
    vec3 horizonWarm = vec3(1.0, 0.52, 0.22);
    float warm = pow(toSun, 3.0);
    vec3 horizon = mix(horizonCool, horizonWarm, warm);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
    col = mix(col, zenith, smoothstep(0.18, 0.75, h));
    col += vec3(1.0, 0.62, 0.3) * pow(toSun, 18.0) * 0.9 * smoothstep(0.25, -0.02, h);
    col += vec3(1.0, 0.75, 0.45) * pow(toSun, 120.0) * 0.6;

    // Climbing up: the air thins and the sky goes black.
    vec3 space = vec3(0.004, 0.006, 0.014);
    col = mix(col, space, smoothstep(0.0, 1.0, uAlt));

    // Stars, stronger high up and as we climb.
    vec3 cell = floor(d * 420.0);
    float s = hash(cell);
    float star = step(0.9965, s) * (0.4 + 0.6 * hash(cell + 3.1));
    float tw = 0.75 + 0.25 * sin(uTime * 2.0 + s * 60.0);
    float starVis = smoothstep(0.08, 0.6, h) * (0.35 + 0.65 * uAlt) * (1.0 - warm * 0.8);
    col += vec3(0.85, 0.9, 1.0) * star * tw * starVis;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function ridge(width, baseY, amp, seed, segs = 120) {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, baseY - 400)
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  const phases = [rnd() * 6, rnd() * 6, rnd() * 6]
  for (let i = 0; i <= segs; i++) {
    const x = -width / 2 + (i / segs) * width
    const t = i / segs
    const y = baseY + amp * (0.55 * Math.sin(t * 5.1 + phases[0]) + 0.3 * Math.sin(t * 13.7 + phases[1]) + 0.15 * Math.sin(t * 31 + phases[2]) + 0.05 * (rnd() - 0.5))
    shape.lineTo(x, y)
  }
  shape.lineTo(width / 2, baseY - 400)
  return new THREE.ShapeGeometry(shape)
}

function house() {
  const g = new THREE.Group()
  const dark = new THREE.MeshBasicMaterial({ color: 0x07080d })
  // Body and pitched roof of a one story California house.
  const s = new THREE.Shape()
  s.moveTo(-6, 0); s.lineTo(6, 0); s.lineTo(6, 3.2); s.lineTo(6.6, 3.2); s.lineTo(1.2, 6.1)
  s.lineTo(-4.2, 3.2); s.lineTo(-6.6, 3.2); s.lineTo(-6, 3.2); s.lineTo(-6, 0)
  const body = new THREE.Mesh(new THREE.ShapeGeometry(s), dark)
  g.add(body)
  // Garage block.
  const gs = new THREE.Shape()
  gs.moveTo(6, 0); gs.lineTo(11, 0); gs.lineTo(11, 2.8); gs.lineTo(11.4, 2.8); gs.lineTo(8.5, 4.3); gs.lineTo(5.8, 2.8); gs.lineTo(6, 2.8)
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(gs), dark))
  // Chimney.
  const ch = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), dark)
  ch.position.set(-2.6, 5.0, 0)
  g.add(ch)
  // Warm windows.
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(1.6) })
  ;[[-3.6, 1.6], [-1.2, 1.6], [3.4, 1.6]].forEach(([x, y], i) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), i === 1 ? winMat : new THREE.MeshBasicMaterial({ color: 0x1b1d2a }))
    w.position.set(x, y, 0.02)
    g.add(w)
  })
  return g
}

function dish() {
  // Starlink dish: flat rectangle on a short mast, tilted at the sky.
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5, metalness: 0.1 })
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.6, metalness: 0.5 })
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 10), mastMat)
  mast.position.y = 0.45
  g.add(mast)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.5), mat)
  plate.position.y = 0.95
  plate.rotation.set(-0.25, 0.3, -0.45)
  g.add(plate)
  g.userData.plate = plate
  return g
}

function tree(x, y, scale, seed) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color: 0x06070b })
  const trunk = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 4), mat)
  trunk.position.y = 2
  g.add(trunk)
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  // Many small leaf clumps make a softer, more natural crown.
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd())
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.35 + rnd() * 0.55, 12), mat)
    c.position.set(Math.cos(a) * d * 2.1, 5.2 + Math.sin(a) * d * 1.9, 0)
    g.add(c)
  }
  for (let i = 0; i < 4; i++) {
    const br = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.2), mat)
    br.position.set((i - 1.5) * 0.5, 4.2, 0)
    br.rotation.z = (i - 1.5) * 0.35
    g.add(br)
  }
  g.position.set(x, y, -2)
  g.scale.setScalar(scale)
  return g
}

const beamVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const beamFrag = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float along = vUv.y;
    if (along > uProgress) discard;
    float across = abs(vUv.x - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, across);
    float pulse = smoothstep(0.75, 1.0, fract(along * 14.0 - uTime * 1.4));
    float head = smoothstep(0.06, 0.0, uProgress - along);
    vec3 col = vec3(0.35, 0.6, 1.0) * (0.5 + 1.6 * pulse) + vec3(0.8, 0.9, 1.0) * head * 2.0;
    gl_FragColor = vec4(col * core, core * (0.55 + 0.45 * pulse) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createBeam(rStart, rEnd = rStart) {
  const geo = new THREE.CylinderGeometry(rEnd, rStart, 1, 12, 1, true)
  geo.translate(0, 0.5, 0)
  const mat = new THREE.ShaderMaterial({
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  function span(a, b) {
    dir.subVectors(b, a)
    const len = dir.length()
    mesh.position.copy(a)
    mesh.quaternion.setFromUnitVectors(up, dir.normalize())
    mesh.scale.set(1, len, 1)
  }
  return { mesh, mat, span }
}

export function glowSprite(color, size) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.15, 'rgba(255,255,255,0.8)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const s = new THREE.Sprite(m)
  s.scale.setScalar(size)
  return s
}

export function createGround() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000)

  // Sun sits just below the eastern horizon (camera looks toward -Z = east).
  const sunDir = new THREE.Vector3(0.18, -0.05, -1).normalize()
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: { uSunDir: { value: sunDir }, uAlt: { value: 0 }, uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), skyMat)
  scene.add(sky)

  // Layered hills. Far ones pick up more of the dawn haze.
  const hillCols = [0x3a2f4a, 0x241f35, 0x151624]
  ;[[-2600, 170, 90, 3], [-1500, 90, 70, 11], [-700, 30, 40, 23]].forEach(([z, y, amp, seed], i) => {
    const m = new THREE.Mesh(ridge(9000, y, amp, seed), new THREE.MeshBasicMaterial({ color: hillCols[i], fog: false }))
    m.position.z = z
    scene.add(m)
  })
  // Distant city lights along the flats.
  const lightsGeo = new THREE.BufferGeometry()
  const lp = []
  let s = 5
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 700; i++) lp.push((rnd() - 0.5) * 2400, 2 + rnd() * 26, -300 - rnd() * 380)
  lightsGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3))
  const cityLights = new THREE.Points(lightsGeo, new THREE.PointsMaterial({ color: 0xffb36b, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85 }))
  scene.add(cityLights)

  // Street level ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: 0x050609 }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const home = house()
  home.position.set(0, 0, 0)
  scene.add(home)
  scene.add(tree(-11, 0, 1.15, 3), tree(15.5, 0, 0.95, 9), tree(-19, 0, 1.4, 21))

  const d = dish()
  d.position.set(1.0, 5.55, 0.2)
  scene.add(d)
  const dishTop = new THREE.Vector3(1.0, 6.55, 0.4)

  // Rim light on the dish from the dawn sky.
  scene.add(new THREE.HemisphereLight(0x8fa6d8, 0x1a1420, 1.2))
  const rim = new THREE.DirectionalLight(0xffb27a, 1.6)
  rim.position.copy(sunDir).multiplyScalar(10).add(new THREE.Vector3(0, 3, 0))
  scene.add(rim)

  // The satellite: a bright point high overhead.
  const satPos = new THREE.Vector3(-260, 1750, -900)
  const sat = glowSprite(0xdbe8ff, 34)
  sat.position.copy(satPos)
  scene.add(sat)

  const beam = createBeam(0.06, 1.6)
  beam.span(dishTop, satPos)
  scene.add(beam.mesh)

  return { scene, camera, skyMat, beam, sat, satPos, dishTop, cityLights }
}
