// three.js preview: ring (fixed), sun, instanced planets; optional animation (ring fixed) and mid-height section.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = { ring: 0xcccfd9, sun: 0xf29926, planet: 0x408ce6 };

export function createView(el, ui) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-1.5, -0.5, -1);
  scene.add(fill);

  const root = new THREE.Group();          // bearing z axis -> world y (up)
  root.rotation.x = -Math.PI / 2;
  scene.add(root);

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.05, roughness: 0.55, flatShading: true, side: THREE.DoubleSide });
  const mats = { ring: mat(COLORS.ring), sun: mat(COLORS.sun), planet: mat(COLORS.planet) };

  let ringMesh = null, sunMesh = null, plMesh = null, data = null, tc = 0, H = 5, R = 16;
  const tmp = new THREE.Object3D();

  const geom = (body) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(body.pos), 3));
    g.setIndex(new THREE.BufferAttribute(body.idx, 1));
    g.computeBoundingSphere();
    return g;
  };

  function dispose(m) { if (m) { root.remove(m); m.geometry.dispose(); } }

  function update(r) {
    const first = !data;
    const sameSize = data && data.p.OD === r.p.OD && data.p.H === r.p.H;
    data = r;
    dispose(ringMesh); dispose(sunMesh); dispose(plMesh);
    ringMesh = new THREE.Mesh(geom(r.ring), mats.ring);
    sunMesh = new THREE.Mesh(geom(r.sun), mats.sun);
    plMesh = new THREE.InstancedMesh(geom(r.planet), mats.planet, r.placements.length);
    root.add(ringMesh, sunMesh, plMesh);
    H = r.p.H; R = r.p.OD / 2;
    root.position.y = -H / 2;
    clipPlane.constant = 0;                 // world y=0 is mid-height
    pose();
    applyUI();
    if (first || !sameSize) fit();
  }

  function pose() {
    if (!data) return;
    const g = data.g;
    sunMesh.rotation.z = tc * (1 + g.Zr / g.Zs);
    data.placements.forEach((q, i) => {
      const th = q.orbit + tc;
      tmp.position.set(g.a * Math.cos(th), g.a * Math.sin(th), 0);
      tmp.rotation.set(0, 0, q.rot + tc * (1 - g.Zr / g.Zp));
      tmp.updateMatrix();
      plMesh.setMatrixAt(i, tmp.matrix);
    });
    plMesh.instanceMatrix.needsUpdate = true;
  }

  function applyUI() {
    const cp = ui.clip.checked ? [clipPlane] : [];
    for (const m of Object.values(mats)) { m.clippingPlanes = cp; m.needsUpdate = true; }
    if (ringMesh) ringMesh.visible = ui.showRing.checked;
    if (sunMesh) sunMesh.visible = ui.showSun.checked;
    if (plMesh) plMesh.visible = ui.showPl.checked;
  }

  function fit() {
    const d = Math.max(R, H) * 3.2;
    camera.position.set(d * 0.55, d * 0.75, d * 0.75);
    controls.target.set(0, 0, 0);
    camera.near = d / 200; camera.far = d * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px";
    renderer.domElement.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();

  const bg = () => {
    const c = getComputedStyle(document.documentElement).getPropertyValue("--view").trim() || "#e9ebef";
    scene.background = new THREE.Color(c);
  };
  bg();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bg);

  for (const k of ["clip", "showRing", "showSun", "showPl"]) ui[k].addEventListener("change", applyUI);
  ui.fit.addEventListener("click", fit);

  let prev = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    if (ui.anim.checked && data) { tc += dt * parseFloat(ui.speed.value) * 0.5; pose(); }
    controls.update();
    renderer.render(scene, camera);
  });

  function clear() { dispose(ringMesh); dispose(sunMesh); dispose(plMesh); ringMesh = sunMesh = plMesh = null; data = null; }

  const api = { update, clear, fit, camera, controls, renderer };
  window.__pbView = api;          // debugging / automated checks
  return api;
}
