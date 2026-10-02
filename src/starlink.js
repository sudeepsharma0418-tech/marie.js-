import * as THREE from 'three'

// Solar cells drawn in code: dark blue cells with thin silver lines.
function cellTexture() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#0a1430'
  g.fillRect(0, 0, c.width, c.height)
  const cols = 48, rows = 12
  const cw = c.width / cols, rh = c.height / rows
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const v = 18 + ((i * 7 + j * 13) % 9)
      g.fillStyle = `rgb(${v + 4},${v + 26},${v + 92})`
      g.fillRect(i * cw + 1.5, j * rh + 1.5, cw - 3, rh - 3)
    }
  }
  g.strokeStyle = 'rgba(200,210,230,0.55)'
  g.lineWidth = 1
  for (let i = 0; i <= cols; i += 6) {
    g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, c.height); g.stroke()
  }
  g.strokeStyle = 'rgba(210,220,240,0.8)'
  g.lineWidth = 3
  g.beginPath(); g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2); g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// Local frame of the model: +X points along the flight direction,
// +Y points away from Earth, +Z to the side where the panel sticks out.
export function createStarlink() {
  const root = new THREE.Group()

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6f7782, metalness: 0.7, roughness: 0.42 })
  const foilMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.6 })
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0xaeb4bd, metalness: 0.2, roughness: 0.6 })
  const cells = cellTexture()
  const panelMat = new THREE.MeshPhysicalMaterial({
    map: cells,
    emissiveMap: cells,
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffc890),
    emissiveIntensity: 0,
  })
  const backMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.4, roughness: 0.7 })

  // Flat body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.28), bodyMat)
  root.add(body)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.26), foilMat)
  deck.position.y = 0.036
  root.add(deck)
  // Four flat phased array antennas on the Earth side.
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.01, 0.085), antennaMat)
    a.position.set(-0.14 + (i % 2) * 0.12 + (i > 1 ? 0.16 : 0), -0.035, i % 2 ? 0.06 : -0.06)
    root.add(a)
  }

  // One big solar panel on a short boom.
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), bodyMat)
  boom.rotation.x = Math.PI / 2
  boom.position.set(0, 0.02, 0.2)
  root.add(boom)

  const wing = new THREE.Group()
  wing.position.set(0, 0.02, 0.28)
  wing.rotation.z = 0.28
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36), panelMat)
  panel.rotation.x = -Math.PI / 2
  panel.position.z = 0.5
  // Swap texture direction so cells run along the long side.
  panel.rotation.z = Math.PI / 2
  wing.add(panel)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.004, 1.0), backMat)
  back.position.set(0, -0.004, 0.5)
  wing.add(back)
  root.add(wing)

  return { root, wing, panelMat, bodyMat }
}
