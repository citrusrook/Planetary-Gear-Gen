// three.js preview of every part (instanced), optional animation and mid-height section.
// Animation: single bearing -> ring fixed, planets orbit; with planet pins -> carrier fixed, sun and
// ring counter-rotate; gear train -> the bearings turn against each other on their outer teeth.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const COLORS = { ring: 0xcccfd9, sun: 0xf29926, planet: 0x408ce6, pin: 0x7a8494, carrier: 0x5bb381, shaft: 0xd9b23d };
const SHOW = { ring: "showRing", sun: "showSun", shaft: "showSun", planet: "showPl", pin: "showPl", carrier: "showPl" };

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
  const mats = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, mat(c)]));

  let meshes = [], data = null, tc = 0, H = 5, span = 16, centre = [0, 0], sizeKey = "";
  const tmp = new THREE.Object3D();

  const geom = (body) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(body.pos), 3));
    g.setIndex(new THREE.BufferAttribute(body.idx, 1));
    g.computeBoundingSphere();
    return g;
  };

  function clear() {
    for (const m of meshes) { root.remove(m.mesh); m.mesh.geometry.dispose(); }
    meshes = []; data = null;
  }

  function update(r) {
    const first = !data;
    clear();
    data = r;
    const centres = Object.fromEntries(r.bearings.map((b, i) => [b.name, { ...b, i }]));
    for (const pt of r.parts) {
      const mesh = new THREE.InstancedMesh(geom(pt.body), mats[pt.name] || mats.ring, pt.inst.length);
      root.add(mesh);
      meshes.push({ mesh, pt, b: centres[pt.bearing] || centres.A });
    }
    H = r.p.H;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of r.bearings) { x0 = Math.min(x0, b.cx - b.Rmax); x1 = Math.max(x1, b.cx + b.Rmax); y0 = Math.min(y0, b.cy - b.Rmax); y1 = Math.max(y1, b.cy + b.Rmax); }
    for (const { pt, mesh } of meshes) {
      mesh.geometry.computeBoundingSphere();
      const rr = mesh.geometry.boundingSphere.radius;
      for (const q of pt.inst) { x0 = Math.min(x0, q.x - rr); x1 = Math.max(x1, q.x + rr); y0 = Math.min(y0, q.y - rr); y1 = Math.max(y1, q.y + rr); }
    }
    centre = [(x0 + x1) / 2, (y0 + y1) / 2];
    span = Math.max(x1 - x0, y1 - y0) / 2;
    root.position.set(-centre[0], -H / 2, centre[1]);
    clipPlane.constant = 0;                 // world y=0 is mid-height
    pose();
    applyUI();
    const k = `${span.toFixed(1)}|${H}`;
    if (first || k !== sizeKey) fit();
    sizeKey = k;
  }

  function pose() {
    if (!data) return;
    const g = data.g, A = data.bearings[0];
    const pins = !!data.p.planet_pins && !data.multi;
    for (const { mesh, pt, b } of meshes) {
      pt.inst.forEach((q, i) => {
        let x = q.x, y = q.y, rot = q.rot;
        if (data.multi) {                                     // rigid bearings turning on their outer teeth
          if (pt.name !== "carrier" && pt.name !== "shaft") {
            const phi = tc * (b.i % 2 ? -1 : 1) * A.Ze / b.Ze;
            const dx = x - b.cx, dy = y - b.cy, c = Math.cos(phi), s = Math.sin(phi);
            x = b.cx + c * dx - s * dy; y = b.cy + c * dy + s * dx; rot += phi;
          }
        } else if (pins) {                                    // carrier (pins) fixed: sun drives, ring counter-turns
          if (pt.name === "sun") rot += tc;
          else if (pt.name === "ring") rot -= tc * g.Zs / g.Zr;
          else if (pt.name === "planet") rot -= tc * g.Zs / g.Zp;
        } else {                                              // ring fixed, carrier turns
          if (pt.name === "sun") rot += tc * (1 + g.Zr / g.Zs);
          else if (pt.name === "planet" || pt.name === "pin") {
            const th = q.orbit + tc;
            x = g.a * Math.cos(th); y = g.a * Math.sin(th);
            if (pt.name === "planet") rot += tc * (1 - g.Zr / g.Zp);
          }
        }
        tmp.position.set(x, y, 0);
        tmp.rotation.set(0, 0, rot);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function applyUI() {
    const cp = ui.clip.checked ? [clipPlane] : [];
    for (const m of Object.values(mats)) { m.clippingPlanes = cp; m.needsUpdate = true; }
    for (const { mesh, pt } of meshes) mesh.visible = ui[SHOW[pt.name] || "showRing"].checked;
  }

  function fit() {
    const d = Math.max(span, H) * 3.2;
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

  const api = { update, clear, fit, camera, controls, renderer };
  window.__pbView = api;          // debugging / automated checks
  return api;
}
