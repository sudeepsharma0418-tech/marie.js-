import * as THREE from 'three'
import { SUN_DIR } from './orbits.js'

const earthVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const earthFrag = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uWater;
  uniform vec3 uSun;
  uniform float uCloudShift;
  uniform float uTexW;
  uniform float uNightBoost;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(uSun);
    float ndl = dot(N, L);

    // Day side, soft across the terminator.
    float dayMix = smoothstep(-0.06, 0.16, ndl);
    float lit = smoothstep(-0.12, 0.6, ndl);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec2 tuv = vUv * vec2(uTexW, uTexW * 0.5);
    float fine = vnoise(tuv * 1.7) * 0.5 + vnoise(tuv * 4.3) * 0.3 + vnoise(tuv * 11.0) * 0.2;
    day *= 0.86 + 0.28 * fine;
    float water = texture2D(uWater, vUv).r;

    // Clouds drift slowly. Detail noise breaks up the blur when we are close.
    vec2 cuv = vUv + vec2(uCloudShift, 0.0);
    float cloud = texture2D(uClouds, cuv).r;
    float detail = vnoise(vUv * vec2(uTexW, uTexW * 0.5) * 0.9);
    cloud = clamp(cloud * (0.82 + 0.36 * detail), 0.0, 1.0);
    // Cloud shadow: look up the cloud a little toward the Sun.
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + 1e-5);
    float shadowCloud = texture2D(uClouds, cuv - vec2(dot(L, T), 0.0) * 0.0012).r;

    // Surface in sunlight.
    vec3 surf = day * (0.04 + 1.25 * max(ndl, 0.0)) * (1.0 - 0.45 * shadowCloud * lit);

    // Sun glint on the oceans.
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float glint = (pow(nh, 400.0) * 0.9 + pow(nh, 40.0) * 0.05) * water * (1.0 - cloud);
    surf += vec3(1.0, 0.93, 0.8) * glint * step(0.0, ndl) * dayMix;

    // Twilight band: a soft orange glow along the terminator.
    float tw = exp(-pow((ndl - 0.02) / 0.06, 2.0));
    vec3 twilight = vec3(1.0, 0.45, 0.18) * tw * 0.07;

    // Night: city lights, warm orange, with fine grain so towns read as dots.
    float lights = texture2D(uNight, vUv).r;
    float grain = vnoise(vUv * vec2(uTexW, uTexW * 0.5) * 3.1) * vnoise(vUv * vec2(uTexW, uTexW * 0.5) * 7.3 + 3.7);
    lights = lights * (0.45 + 1.4 * grain);
    lights = pow(lights, 1.3);
    float nightMask = 1.0 - smoothstep(-0.14, 0.04, ndl);
    vec3 cityCol = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.82, 0.55), smoothstep(0.4, 1.0, lights));
    vec3 night = cityCol * lights * 2.8 * uNightBoost * (1.0 - 0.75 * cloud);
    // Faint moonlit ground.
    night += day * vec3(0.12, 0.16, 0.26) * 0.05;

    vec3 col = mix(night, surf, dayMix) + twilight * (1.0 - cloud * 0.5);

    // Clouds: white in sunlight, orange at the terminator, thin moonlit grey at night.
    vec3 cloudDay = vec3(1.0) * (0.03 + 1.25 * max(ndl, 0.0));
    vec3 cloudTw = vec3(1.0, 0.55, 0.3) * tw * 0.12;
    vec3 cloudNight = vec3(0.16, 0.19, 0.26) * 0.16;
    vec3 cloudCol = mix(cloudNight, cloudDay, dayMix) + cloudTw;
    col = mix(col, cloudCol, cloud * mix(0.5, 0.92, dayMix));

    // Haze toward the limb.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 haze = mix(vec3(1.0, 0.45, 0.2), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.3, ndl));
    col += haze * fres * smoothstep(-0.2, 0.2, ndl) * 0.22;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Atmosphere: a shell around the Earth. Each pixel marches its view ray
// through the shell and adds light scattered by the air. This gives the thin
// bright line on the horizon, blue in the day and orange at sunrise.
const atmoVert = /* glsl */ `
  varying vec3 vPosW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const atmoFrag = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTop;
  uniform float uScaleH;
  uniform float uIntensity;
  varying vec3 vPosW;

  vec2 hitSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vPosW - ro);
    vec3 L = normalize(uSun);
    vec2 top = hitSphere(ro, rd, uTop);
    if (top.y < 0.0) discard;
    float t0 = max(top.x, 0.0);
    float t1 = top.y;
    vec2 ground = hitSphere(ro, rd, 1.0);
    bool hitsGround = ground.x > 0.0;
    if (hitsGround) t1 = ground.x;

    const int STEPS = 10;
    float dt = (t1 - t0) / float(STEPS);
    vec3 sumR = vec3(0.0);
    float sumM = 0.0;
    float depth = 0.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
      float r = length(p);
      float h = max(r - 1.0, 0.0);
      float dens = exp(-h / uScaleH);
      depth += dens * dt;
      // Is this bit of air in sunlight? Soft so the band is gradual.
      float mu = dot(p / r, L);
      float sunlit = smoothstep(-0.16, 0.06, mu);
      // Light that crosses lots of air turns orange.
      float grazing = 1.0 - smoothstep(-0.12, 0.35, mu);
      vec3 tint = mix(vec3(0.24, 0.52, 1.0), vec3(1.0, 0.42, 0.14), grazing * 0.85);
      sumR += dens * dt * sunlit * tint;
      sumM += dens * dt * sunlit;
    }
    float cosA = dot(rd, L);
    float phaseR = 0.75 * (1.0 + cosA * cosA);
    float g = 0.82;
    float phaseM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosA, 1.5) * 0.08;
    vec3 col = sumR * phaseR * 7.5 + vec3(1.0, 0.72, 0.45) * sumM * phaseM * 6.0;
    // Night airglow: the faint blue line on the horizon.
    col += vec3(0.1, 0.22, 0.55) * depth * 0.55;
    col *= uIntensity;
    float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createEarth(textures, isMobile) {
  const group = new THREE.Group()

  const seg = isMobile ? 160 : 256
  const geo = new THREE.SphereGeometry(1, seg, seg / 2)
  const mat = new THREE.ShaderMaterial({
    vertexShader: earthVert,
    fragmentShader: earthFrag,
    uniforms: {
      uDay: { value: textures.day },
      uNight: { value: textures.night },
      uClouds: { value: textures.clouds },
      uWater: { value: textures.water },
      uSun: { value: SUN_DIR.clone() },
      uCloudShift: { value: 0 },
      uTexW: { value: textures.day.image ? textures.day.image.width : 4096 },
      uNightBoost: { value: 1 },
    },
  })
  const earth = new THREE.Mesh(geo, mat)
  group.add(earth)

  const top = 1.028
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: atmoVert,
    fragmentShader: atmoFrag,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uTop: { value: top },
      uScaleH: { value: 0.0055 },
      uIntensity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  })
  // Back faces so the shell still draws when the camera sits inside its
  // bounding area near the limb. The ray march does the real work.
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(top, 128, 64), atmoMat)
  atmo.renderOrder = 2
  group.add(atmo)

  return { group, earth, mat, atmo, atmoMat }
}

// Sun: a bright disk, a soft glow and a few lens flare ghosts. Drawn in a
// screen space overlay so the flare stays crisp. Visibility comes from a
// ray test against the Earth, so the Sun really rises over the horizon.
function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  stops.forEach(([o, col]) => grd.addColorStop(o, col))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function starburstTexture(size = 512) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  g.translate(size / 2, size / 2)
  g.globalCompositeOperation = 'lighter'
  const rays = 14
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (i % 2) * 0.12
    const len = size * (i % 2 ? 0.26 : 0.48)
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len)
    grd.addColorStop(0, 'rgba(255,240,220,0.55)')
    grd.addColorStop(1, 'rgba(255,200,150,0)')
    g.strokeStyle = grd
    g.lineWidth = i % 2 ? 1.5 : 2.5
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function createSun() {
  const scene = new THREE.Scene()
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)
  const add = (map, color, opacity) => {
    const m = new THREE.SpriteMaterial({
      map, color, transparent: true, opacity, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const s = new THREE.Sprite(m)
    scene.add(s)
    return s
  }
  const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,244,225,0.9)'], [0.25, 'rgba(255,190,120,0.25)'], [1, 'rgba(255,140,60,0)']])
  const coreTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,250,1)'], [0.5, 'rgba(255,240,220,0.4)'], [1, 'rgba(255,220,180,0)']])
  const ringTex = radialTexture([[0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0)'], [0.72, 'rgba(160,200,255,0.35)'], [0.8, 'rgba(255,170,120,0.2)'], [1, 'rgba(0,0,0,0)']])
  const ghostTex = radialTexture([[0, 'rgba(255,255,255,0.5)'], [0.6, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']])

  const glow = add(glowTex, 0xffffff, 1)
  const burst = add(starburstTexture(), 0xffffff, 1)
  const core = add(coreTex, 0xffffff, 1)
  const ring = add(ringTex, 0xffffff, 0.5)
  const ghosts = [
    [0.4, 0.05, 0x7fb2ff, 0.18],
    [0.7, 0.03, 0xffb070, 0.22],
    [1.25, 0.08, 0x8fd0ff, 0.12],
    [1.6, 0.02, 0xffd28a, 0.3],
  ].map(([k, s, col, o]) => ({ sprite: add(ghostTex, col, o), k, s, o }))

  const tmp = new THREE.Vector3()
  const toSun = new THREE.Vector3()

  function update(camera, aspect, extra = 0) {
    cam.left = -aspect
    cam.right = aspect
    cam.updateProjectionMatrix()

    // Ray from camera toward the Sun. Is the Earth in the way?
    const c = camera.position
    toSun.copy(SUN_DIR)
    const b = c.dot(toSun)
    const d2 = c.lengthSq() - b * b // squared distance from Earth center to the ray
    const minR = b > 0 ? Math.sqrt(c.lengthSq()) : Math.sqrt(Math.max(d2, 0))
    // Edge softness: angular size of the Sun plus a little air.
    const clear = b > 0 ? 1 : THREE.MathUtils.smoothstep(Math.sqrt(Math.max(d2, 0)), 1.0, 1.016)
    let vis = clear * (minR > 0 ? 1 : 0)

    tmp.copy(c).addScaledVector(SUN_DIR, 1000).project(camera)
    const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.6 && Math.abs(tmp.y) < 1.6
    if (!onScreen) vis = 0
    const x = tmp.x * aspect, y = tmp.y
    // Low on the horizon the air reddens and dims the Sun.
    const low = b > 0 ? 0 : 1 - THREE.MathUtils.smoothstep(Math.sqrt(Math.max(d2, 0)), 1.0, 1.06)
    const fl = vis * (1 + extra)

    core.position.set(x, y, 0)
    core.scale.setScalar(0.07)
    core.material.opacity = vis
    core.material.color.setRGB(1, 1 - low * 0.12, 1 - low * 0.3)

    glow.position.set(x, y, 0)
    glow.scale.setScalar(0.55 + extra * 0.4)
    glow.material.opacity = fl * 0.5
    glow.material.color.setRGB(1, 0.9 - low * 0.2, 0.8 - low * 0.35)

    burst.position.set(x, y, 0)
    burst.scale.setScalar(0.62 + extra * 0.45)
    burst.material.opacity = fl * 0.85
    burst.material.rotation = x * 0.15

    ring.position.set(x, y, 0)
    ring.scale.setScalar(0.42)
    ring.material.opacity = fl * 0.45

    ghosts.forEach((g) => {
      g.sprite.position.set(x - x * g.k * 2, y - y * g.k * 2, 0)
      g.sprite.scale.setScalar(g.s * 4)
      g.sprite.material.opacity = g.o * fl
    })
    return vis
  }

  return { scene, cam, update }
}
