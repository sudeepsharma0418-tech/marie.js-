import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import GUI from 'lil-gui'

gsap.registerPlugin(ScrollTrigger)

// Smooth scrolling, driven by GSAP's ticker so ScrollTrigger stays in sync
const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)

const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 0, 6)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)

const material = new THREE.MeshStandardMaterial({ color: '#7c5cff', roughness: 0.3, metalness: 0.6 })
const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.35, 200, 32), material)
mesh.position.x = 1.5
scene.add(mesh)

scene.add(new THREE.AmbientLight('#ffffff', 0.4))
const light = new THREE.DirectionalLight('#ffffff', 2)
light.position.set(3, 4, 5)
scene.add(light)

// Scroll linked animation
gsap.to(mesh.rotation, {
  y: Math.PI * 2,
  x: Math.PI,
  ease: 'none',
  scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: true },
})

// Debug panel, open it by adding #debug to the URL
if (location.hash === '#debug') {
  const gui = new GUI()
  gui.addColor(material, 'color')
  gui.add(material, 'roughness', 0, 1)
  gui.add(material, 'metalness', 0, 1)
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => {
  mesh.rotation.z += 0.003
  renderer.render(scene, camera)
})
