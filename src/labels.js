import * as THREE from 'three'

// HTML labels that follow points in 3D. Hidden when behind the Earth or
// off screen. Lower priority labels step aside instead of overlapping.
export function createLabels(root) {
  const items = []
  const v = new THREE.Vector3()
  const toP = new THREE.Vector3()

  function add({ text, cls = '', priority = 0, dx = 0, dy = 0, anchor = 'left' }) {
    const el = document.createElement('div')
    el.className = 'label ' + cls
    el.textContent = text
    root.appendChild(el)
    const item = { el, priority, dx, dy, anchor, want: false, on: false, w: 0, h: 0, x: 0, y: 0, text }
    items.push(item)
    return item
  }

  function occludedByEarth(cam, p) {
    // Does the segment from the camera to p pass through the unit sphere?
    toP.subVectors(p, cam)
    const len = toP.length()
    toP.divideScalar(len)
    const b = cam.dot(toP)
    const c = cam.lengthSq() - 1
    const h = b * b - c
    if (h < 0) return false
    const t = -b - Math.sqrt(h)
    return t > 0 && t < len - 1e-4
  }

  function place(item, world, camera, w, h, show, checkEarth = true) {
    item.want = false
    if (!show) return
    v.copy(world).project(camera)
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return
    if (checkEarth && occludedByEarth(camera.position, world)) return
    item.x = (v.x * 0.5 + 0.5) * w + item.dx
    item.y = (-v.y * 0.5 + 0.5) * h + item.dy
    item.want = true
  }

  function setText(item, text) {
    if (item.text !== text) { item.text = text; item.el.textContent = text; item.w = 0 }
  }

  function commit() {
    const placed = []
    const sorted = items.slice().sort((a, b) => b.priority - a.priority)
    for (const it of sorted) {
      let ok = it.want
      if (ok) {
        if (!it.w) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight }
        let x = it.x, y = it.y
        if (it.anchor === 'right') x -= it.w
        if (it.anchor === 'center') { x -= it.w / 2; y -= it.h / 2 }
        const r = { x, y, w: it.w, h: it.h }
        for (const p of placed) {
          if (r.x < p.x + p.w + 4 && r.x + r.w + 4 > p.x && r.y < p.y + p.h + 4 && r.y + r.h + 4 > p.y) { ok = false; break }
        }
        if (ok) {
          placed.push(r)
          it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        }
      }
      if (ok !== it.on) {
        it.on = ok
        it.el.classList.toggle('on', ok)
      }
    }
  }

  function reset() { items.forEach((it) => { it.want = false }) }

  function measure() { items.forEach((it) => { it.w = 0 }) }

  return { add, place, commit, setText, measure, reset }
}
