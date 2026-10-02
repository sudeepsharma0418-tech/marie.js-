import * as THREE from 'three'

// Units: Earth radius = 1. North pole = +Y.
// A longitude/orbit angle a maps to the direction (cos a, 0, -sin a), which
// matches how three.js wraps an equirectangular map onto SphereGeometry.
export const EARTH_KM = 6371
export const DEG = Math.PI / 180

export const altToR = (km) => 1 + km / EARTH_KM

// One real Sun direction for the whole scene. Early October, so the Sun sits
// about 4 degrees south of the equator.
export const SUN_DIR = new THREE.Vector3(1, Math.tan(-3.9 * DEG), 0).normalize()

// Time scale: one second on screen is TIME_SCALE seconds of real orbit.
// Every satellite and the Earth itself use the same clock, so their speeds
// are true to each other.
export const TIME_SCALE = 127
const MU = 398600.4418 // km^3 / s^2
export function angularSpeed(r) {
  const a = r * EARTH_KM
  return Math.sqrt(MU / (a * a * a)) * TIME_SCALE // rad per screen second
}
export const EARTH_SPIN = ((2 * Math.PI) / 86164) * TIME_SCALE

// Position on a circular orbit. Same formula as the GPU shader.
export function orbitPos(r, inc, raan, u, out = new THREE.Vector3()) {
  const cu = Math.cos(u), su = Math.sin(u)
  const x = cu
  const y = su * Math.sin(inc)
  const z = -su * Math.cos(inc)
  const cO = Math.cos(raan), sO = Math.sin(raan)
  return out.set((x * cO + z * sO) * r, y * r, (-x * sO + z * cO) * r)
}

// Direction of a lat/lon point on the Earth in the Earth's own frame.
export function latLonDir(latDeg, lonDeg, out = new THREE.Vector3()) {
  const la = latDeg * DEG, lo = lonDeg * DEG
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
}

export const HAYWARD = { lat: 37.6688, lon: -122.0808 }

// Earth spin at the start of the space clock. Chosen so Hayward sits just
// before sunrise (the Sun is at world longitude 0, dawn is near -90).
export const SPIN0 = (-96 - HAYWARD.lon) * DEG

// My satellite: Starlink shell, 550 km, 53 degrees. Solve its plane so that
// at clock zero it is just passing over Hayward.
export const MY_R = altToR(550)
export const MY_INC = 53 * DEG
const myU0 = Math.asin(Math.sin(HAYWARD.lat * DEG) / Math.sin(MY_INC))
const lonInPlane = Math.atan2(Math.sin(myU0) * Math.cos(MY_INC), Math.cos(myU0))
export const MY_RAAN = HAYWARD.lon * DEG + SPIN0 - lonInPlane
export const MY_U0 = myU0 - 1.5 * DEG
export const MY_W = angularSpeed(MY_R)

export function mySatPos(t, out) {
  return orbitPos(MY_R, MY_INC, MY_RAAN, MY_U0 + MY_W * t, out)
}
