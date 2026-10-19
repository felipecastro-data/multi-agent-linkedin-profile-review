import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeRobot } from './robots.js';

const R = 5;          // half the room size
const FY = 0.1;       // floor surface height
const H = 3.3;        // wall height
const C = { x: 0, z: 0.85 }; // centre of the four-desk pod
// Pinwheel: each desk backs onto one arm of the cross divider around a centre column.
const DESKS = {
  scraper: { x: C.x - 1.42, z: C.z - 0.56, yaw: Math.PI },
  'career-coach': { x: C.x + 0.56, z: C.z - 1.42, yaw: Math.PI / 2 },
  recruiter: { x: C.x - 0.56, z: C.z + 1.42, yaw: -Math.PI / 2 },
  synthesis: { x: C.x + 1.42, z: C.z + 0.56, yaw: 0 },
};
const ROBOTS = {
  scraper: { antenna: 'ball' },
  recruiter: { antenna: 'ears' },
  'career-coach': { antenna: 'dish' },
  synthesis: { antenna: 'twin' },
  orchestrator: { antenna: 'visor', scale: 1.15, tie: 0x2f4f8f },
};
const V2 = (x, z) => new THREE.Vector2(x, z);
// Walkway ring around the pod, in order; robots route along it. The top edge
// runs between the career coach's desk and the end of the kitchenette wall,
// and its third point sits in front of the kitchenette opening.
const RING = [V2(-3, -2.0), V2(0, -2.0), V2(2.75, -1.9), V2(3, C.z), V2(3, C.z + 3), V2(0, C.z + 3), V2(-3, C.z + 3), V2(-3, C.z)];
const KITCHEN_DOOR = 2; // ring index just outside the kitchenette opening
const DOOR_IN = V2(2.7, -2.95); // just inside the opening
const KITCHEN_CENTER = V2(2.95, -3.65);
const KITCHEN_SPOTS = { scraper: V2(2.35, -3.4), recruiter: V2(2.45, -3.95), 'career-coach': V2(3.55, -3.4), synthesis: V2(3.5, -3.95) };
const inKitchen = (p) => p.x > 1.9 && p.y < -2.45;
const HOME = V2(-3.2, 4.15);

const SCREEN_LINES = {
  scraper: ['navigate(profile_url)', 'scroll → experience', "click 'Show all skills'", 'read_page(about)', 'get_page_text()', 'extract headline', 'extract positions[]', 'note missing_fields', 'javascript_tool(dom)', 'write profile.json'],
  recruiter: ['score = rubric(profile)', 'WebSearch(salary range)', 'WebFetch(job board)', 'gap: skill ∉ postings', 'draft headline v2', 'cite r3, r7', 'check certifications', 'rank keywords', 'write recruiter.json'],
  'career-coach': ['WebFetch(WEF jobs report)', 'WebFetch(BLS OOH)', 'compare CO / MX / ES / US', 'SWOT.opportunities', 'cite s2, s5', 'IC vs management', 'skip_for_now[]', 'tenure outlook', 'write career_coach.json'],
  synthesis: ['read recruiter.json', 'read career_coach.json', 'merge → summary', 'diff vs previous run', 'build plan.actions', 'resolve conflicts', 'validate schema v2', 'write run.json'],
  orchestrator: ['new_run.py', 'Agent(scraper)', 'Agent(recruiter) ‖ Agent(coach)', 'wait for both', 'Agent(synthesis)', 'validate_run.py', 'publish.py', 'report'],
};

const PAL = {
  light: { wall: 0xf1f3f1, trim: 0x9db0c6, floor: 0x6fa452, slab: 0xf5f6f5, desk: 0xf8f9f8, divider: 0x4f9c4b, chair: 0x4a77a3, mat: 0xc4cdd0, kitchen: 0xe9ecef, env: 0.66, hemi: 0.35, sun: 2.2, sunColor: 0xfff3e2, lamps: 0 },
  dark: { wall: 0x9aa6b3, trim: 0x5e7390, floor: 0x416f32, slab: 0x8a96a2, desk: 0xc9d0d6, divider: 0x2f6a33, chair: 0x2f4f70, mat: 0x5c666b, kitchen: 0x8a949c, env: 0.24, hemi: 0.3, sun: 0.75, sunColor: 0x9db6ff, lamps: 1 },
};

const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
function rbox(w, h, d, r, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function sphere(r, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function tube(points, r, mat) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 40, r, 12), mat);
  m.castShadow = true;
  return m;
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function deskToWorld(id, lx, lz) {
  const s = DESKS[id], c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  return V2(s.x + lx * c + lz * n, s.z - lx * n + lz * c);
}
function ringPath(a, b) {
  const n = RING.length, fwd = (b - a + n) % n, back = (a - b + n) % n, step = fwd <= back ? 1 : -1;
  const pts = [];
  for (let i = a; ; i = (i + step + n) % n) { pts.push(RING[i].clone()); if (i === b) break; }
  return pts;
}
const twoNearest = (p) => RING.map((r, i) => [r.distanceTo(p), i]).sort((x, y) => x[0] - y[0]).slice(0, 2).map((x) => x[1]);
// Path from -> ring -> to; tries the two nearest ring points at each end and keeps the shortest.
function route(from, to, startIdx, goalIdx) {
  let best = null, bestLen = Infinity;
  for (const a of startIdx != null ? [startIdx] : twoNearest(from)) {
    for (const b of goalIdx != null ? [goalIdx] : twoNearest(to)) {
      const pts = [...ringPath(a, b), to.clone()];
      let d = 0, p = from;
      for (const q of pts) { d += p.distanceTo(q); p = q; }
      if (d < bestLen) { bestLen = d; best = pts; }
    }
  }
  return best;
}

export function createOffice(canvas, { agents, onPick, onHover }) {
  const hq = window.matchMedia('(pointer: fine)').matches && Math.min(screen.width, screen.height) >= 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !hq, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, hq ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = PAL.light.env;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.28;
  controls.minAzimuthAngle = 0.08;
  controls.maxAzimuthAngle = 1.5;
  controls.rotateSpeed = 0.6;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- post-processing (desktop): ambient occlusion for the soft clay look ----
  let composer = null;
  if (hq) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 16, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.9;
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }

  // ---- lights -----------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8c9b0, PAL.light.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.light.sunColor, PAL.light.sun);
  sun.position.set(6, 11, 7.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 2, far: 30 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const lampLights = [];

  const M = {
    wall: std(PAL.light.wall, 0.75), trim: std(PAL.light.trim, 0.55), floor: std(PAL.light.floor, 0.6),
    slab: std(PAL.light.slab, 0.7), desk: std(PAL.light.desk, 0.35), divider: std(PAL.light.divider, 0.8),
    chair: std(PAL.light.chair, 0.55), mat: std(PAL.light.mat, 0.3, { transparent: true, opacity: 0.55 }),
    kitchen: std(PAL.light.kitchen, 0.4), seam: std(0xdde3e6, 0.8),
    dark: std(0x2a3038, 0.4), white: std(0xfbfbfa, 0.35), steel: std(0xc5ccd3, 0.3, { metalness: 0.4 }),
    blue: std(0x3f8ae0, 0.3), plastic: std(0xe9eef1, 0.35), leaf: std(0x3d8a3a, 0.6),
    bezel: std(0x6c9cc2, 0.4), glass: std(0x0b0f14, 0.12), kbBase: std(0xa9d3ea, 0.4), ball: std(0x3c74ad, 0.25),
    frame: std(0xf6f7f6, 0.35),
  };

  const world = new THREE.Group();
  scene.add(world);

  // ---- room shell -------------------------------------------------------------
  world.add(rbox(2 * R + 0.5, 0.55, 2 * R + 0.5, 0.12, M.slab, 0, -0.27, 0));
  world.add(rbox(2 * R + 0.02, 0.14, 2 * R + 0.02, 0.05, M.floor, 0, FY - 0.07, 0));

  function wallAlongZ(x, z0, z1, thick = 0.26) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const g = new THREE.Group();
    g.add(rbox(thick, H, len, 0.04, M.wall, x, FY + H / 2, zc));
    g.add(rbox(thick + 0.12, 0.14, len + 0.12, 0.05, M.trim, x, FY + H + 0.05, zc));
    g.add(rbox(thick + 0.05, 0.13, len - 0.02, 0.03, M.trim, x, FY + 0.065, zc));
    return g;
  }
  function wallAlongX(z, x0, x1, thick = 0.26) {
    const len = x1 - x0, xc = (x0 + x1) / 2;
    const g = new THREE.Group();
    g.add(rbox(len, H, thick, 0.04, M.wall, xc, FY + H / 2, z));
    g.add(rbox(len + 0.12, 0.14, thick + 0.12, 0.05, M.trim, xc, FY + H + 0.05, z));
    g.add(rbox(len - 0.02, 0.13, thick + 0.05, 0.03, M.trim, xc, FY + 0.065, z));
    return g;
  }
  world.add(wallAlongZ(-R, -R - 0.13, R));
  world.add(wallAlongX(-R, -R, R + 0.13));
  for (let i = 0; i < 5; i++) {
    world.add(rbox(0.02, H - 0.35, 0.03, 0.01, M.seam, -R + 0.14, FY + H / 2, -3.6 + i * 1.75));
    if (i < 3) world.add(rbox(0.03, H - 0.35, 0.02, 0.01, M.seam, -3.6 + i * 1.75, FY + H / 2, -R + 0.14));
  }

  // door on wall A
  world.add(rbox(0.06, 2.3, 1.2, 0.03, std(0xd9e0e3, 0.6), -R + 0.15, FY + 1.15, 3.6));
  world.add(rbox(0.05, 2.2, 1.08, 0.03, M.white, -R + 0.18, FY + 1.11, 3.6));
  world.add(rbox(0.03, 0.22, 0.08, 0.015, M.trim, -R + 0.22, FY + 1.05, 3.2));
  world.add(rbox(0.05, 0.03, 0.12, 0.012, M.steel, -R + 0.25, FY + 1.08, 3.2));
  // mail trays on wall A
  for (let i = 0; i < 2; i++) {
    world.add(rbox(0.16, 0.3, 0.46, 0.04, M.trim, -R + 0.2, FY + 1.9 - i * 0.42, -0.9));
    world.add(rbox(0.06, 0.2, 0.36, 0.02, i ? M.white : M.blue, -R + 0.24, FY + 1.95 - i * 0.42, -0.9));
  }
  // security dome on wall A
  const camHead = new THREE.Group();
  camHead.position.set(-R + 0.3, FY + 2.8, -3.4);
  camHead.add(rbox(0.18, 0.06, 0.18, 0.03, M.white, -0.06, 0.12, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.white);
  dome.position.y = 0.1;
  const lens = sphere(0.09, M.dark, 0, 0.02, 0);
  const led = sphere(0.02, new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 0.07, 0.04, 0.06);
  camHead.add(dome, lens, led);
  world.add(camHead);

  // wall display on wall B
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 1024; wallCanvas.height = 560;
  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.anisotropy = 8;
  const wallScreen = new THREE.Group();
  wallScreen.position.set(-2.3, FY + 2.0, -R + 0.18);
  wallScreen.add(rbox(3.0, 1.66, 0.08, 0.04, M.dark));
  const wallFace = new THREE.Mesh(new THREE.PlaneGeometry(2.86, 1.52), new THREE.MeshBasicMaterial({ map: wallTex, toneMapped: false }));
  wallFace.position.z = 0.045;
  wallScreen.add(wallFace);
  world.add(wallScreen);
  let wallInfo = { title: 'Agent Office', lines: ['Loading…'] };
  function drawWall() {
    const c = wallCanvas.getContext('2d');
    const w = wallCanvas.width, h = wallCanvas.height;
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0f1c2b'); g.addColorStop(1, '#17304a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7fd08a'; c.font = '600 44px ui-monospace, Menlo, monospace';
    c.fillText(wallInfo.title, 48, 84);
    c.fillStyle = '#d7e6f5'; c.font = '38px ui-monospace, Menlo, monospace';
    wallInfo.lines.slice(0, 5).forEach((l, i) => c.fillText(l, 48, 170 + i * 74));
    wallTex.needsUpdate = true;
  }
  drawWall();

  // kitchenette alcove (back-right corner)
  const KX = 1.8, KZ = -2.4;
  world.add(wallAlongZ(KX, -R, KZ + 0.09, 0.18));
  world.add(wallAlongX(KZ, 3.4, R + 0.13, 0.18));
  world.add(rbox(1.68, 0.5, 0.18, 0.03, M.wall, (KX + 3.4) / 2 + 0.04, FY + H - 0.25, KZ));
  world.add(rbox(R - KX - 0.1, 0.02, KZ + R - 0.1, 0.01, M.kitchen, (KX + R) / 2, FY + 0.012, (KZ - R) / 2));
  const kitchen = new THREE.Group();
  kitchen.add(rbox(1.95, 0.86, 0.6, 0.03, M.white, 2.93, FY + 0.43, -R + 0.45));
  kitchen.add(rbox(2.02, 0.05, 0.66, 0.02, std(0xd3d9de, 0.3), 2.93, FY + 0.885, -R + 0.47));
  for (let i = 0; i < 3; i++) {
    kitchen.add(rbox(0.6, 0.74, 0.02, 0.01, M.plastic, 2.28 + i * 0.65, FY + 0.43, -R + 0.76));
    kitchen.add(rbox(0.14, 0.02, 0.02, 0.008, M.steel, 2.28 + i * 0.65, FY + 0.72, -R + 0.78));
  }
  kitchen.add(rbox(1.95, 0.7, 0.36, 0.03, M.white, 2.93, FY + 2.15, -R + 0.33));
  for (let i = 0; i < 3; i++) kitchen.add(rbox(0.6, 0.62, 0.02, 0.01, M.plastic, 2.28 + i * 0.65, FY + 2.15, -R + 0.52));
  kitchen.add(rbox(0.52, 0.3, 0.38, 0.04, M.white, 2.45, FY + 1.06, -R + 0.42), rbox(0.32, 0.2, 0.01, 0.01, M.dark, 2.38, FY + 1.06, -R + 0.615));
  const mwLed = sphere(0.016, new THREE.MeshBasicMaterial({ color: 0x40e070 }), 2.63, FY + 1.12, -R + 0.62);
  kitchen.add(mwLed);
  kitchen.add(rbox(0.24, 0.36, 0.3, 0.04, M.dark, 3.3, FY + 1.09, -R + 0.42), rbox(0.14, 0.03, 0.12, 0.01, M.steel, 3.3, FY + 0.93, -R + 0.55));
  kitchen.add(cyl(0.035, 0.035, 0.12, M.blue, 3.62, FY + 0.97, -R + 0.5));
  kitchen.add(rbox(0.74, 2.0, 0.66, 0.05, M.white, 4.42, FY + 1.0, -R + 0.48));
  kitchen.add(rbox(0.72, 0.012, 0.02, 0.004, M.seam, 4.42, FY + 1.35, -R + 0.82));
  kitchen.add(rbox(0.03, 0.4, 0.04, 0.015, M.steel, 4.12, FY + 1.6, -R + 0.84), rbox(0.03, 0.5, 0.04, 0.015, M.steel, 4.12, FY + 0.9, -R + 0.84));
  world.add(kitchen);

  // clock on the alcove's front wall (faces +z)
  const clock = new THREE.Group();
  clock.position.set(4.2, FY + 2.15, KZ + 0.11);
  const face = cyl(0.42, 0.42, 0.05, M.white, 0, 0, 0, 48);
  face.rotation.x = Math.PI / 2;
  clock.add(face, new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 12, 48), M.trim));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = rbox(0.022, i % 3 === 0 ? 0.09 : 0.05, 0.012, 0.005, M.dark, Math.sin(a) * 0.34, Math.cos(a) * 0.34, 0.03);
    tick.rotation.z = -a;
    clock.add(tick);
  }
  const hands = [0.19, 0.29, 0.32].map((len, i) => {
    const g = new THREE.Group();
    const hand = rbox(i === 2 ? 0.01 : 0.022, len, 0.01, 0.004, i === 2 ? std(0xd23c3c) : M.dark, 0, len / 2 - 0.03, 0.04 + i * 0.008);
    hand.castShadow = false;
    g.add(hand);
    clock.add(g);
    return g;
  });
  world.add(clock);

  // plant in the back corner
  const plant = new THREE.Group();
  plant.position.set(-R + 0.65, FY, -R + 0.65);
  plant.add(cyl(0.24, 0.19, 0.5, M.white, 0, 0.25, 0));
  plant.add(cyl(0.21, 0.21, 0.04, std(0x4a3a2c, 0.9), 0, 0.49, 0));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), M.leaf);
    leaf.scale.set(0.45, 1.25, 0.16);
    leaf.position.set(Math.cos(a) * 0.17, 0.75 + (i % 3) * 0.12, Math.sin(a) * 0.17);
    leaf.rotation.set(Math.sin(a) * 0.55, -a, Math.cos(a) * 0.55);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  world.add(plant);

  // ---- pod: white centre column + four framed green dividers ------------------------
  const pod = new THREE.Group();
  pod.add(rbox(0.72, 1.32, 0.72, 0.07, M.frame, C.x, FY + 0.66, C.z));
  const ARM = 2.09, ARM_C = 0.36 + ARM / 2, DH = 1.28;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const alongX = dx !== 0;
    const cx = C.x + dx * ARM_C, cz = C.z + dz * ARM_C;
    pod.add(rbox(alongX ? ARM : 0.07, DH, alongX ? 0.07 : ARM, 0.035, M.frame, cx, FY + DH / 2 + 0.01, cz));
    pod.add(rbox(alongX ? ARM - 0.1 : 0.085, DH - 0.1, alongX ? 0.085 : ARM - 0.1, 0.03, M.divider, cx, FY + DH / 2 + 0.01, cz));
  }
  world.add(pod);

  // soft contact shadow under the floating slab
  const sh = document.createElement('canvas');
  sh.width = sh.height = 128;
  const sc = sh.getContext('2d');
  const rg = sc.createRadialGradient(64, 64, 6, 64, 64, 62);
  rg.addColorStop(0, 'rgba(10,20,30,.5)'); rg.addColorStop(1, 'rgba(10,20,30,0)');
  sc.fillStyle = rg; sc.fillRect(0, 0, 128, 128);
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -2.4;
  scene.add(shadowPlane);

  // ---- desks ----------------------------------------------------------------------
  const stations = {};
  const screens = [];

  function makeScreen(id, w, h) {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = Math.round(320 * (h / w));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screens.push({ id, cv, tex, seed: Math.random() * 100, speed: 14 + Math.random() * 8 });
    return m;
  }

  // retro CRT terminal: white shell, blue bezel, black screen, side dial
  function crt(id) {
    const g = new THREE.Group();
    g.add(rbox(0.46, 0.05, 0.4, 0.025, M.white, 0, 0.025, 0));
    g.add(rbox(0.34, 0.14, 0.3, 0.05, M.white, 0, 0.12, 0));
    const knob = cyl(0.055, 0.055, 0.04, M.dark, 0.205, 0.15, 0.03, 28);
    knob.rotation.z = Math.PI / 2;
    const knobRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 10, 28), M.white);
    knobRing.rotation.y = Math.PI / 2;
    knobRing.position.set(0.226, 0.15, 0.03);
    g.add(knob, knobRing);
    g.add(rbox(0.66, 0.5, 0.58, 0.15, M.white, 0, 0.44, -0.02));
    g.add(rbox(0.5, 0.38, 0.2, 0.1, M.white, 0, 0.44, -0.33));
    g.add(rbox(0.6, 0.43, 0.05, 0.11, M.bezel, 0, 0.44, 0.265));
    g.add(rbox(0.43, 0.31, 0.03, 0.07, M.glass, 0.055, 0.448, 0.29));
    const scr = makeScreen(id, 0.39, 0.27);
    scr.position.set(0.055, 0.448, 0.3065);
    g.add(scr);
    g.add(rbox(0.06, 0.008, 0.004, 0.002, new THREE.MeshBasicMaterial({ color: 0xffffff }), -0.09, 0.585, 0.306));
    return g;
  }

  function chair() {
    const g = new THREE.Group();
    g.add(rbox(0.56, 0.11, 0.54, 0.055, M.chair, 0, 0.445, 0));
    const back = rbox(0.52, 0.44, 0.1, 0.06, M.chair, 0, 0.8, 0.27);
    back.rotation.x = 0.12;
    g.add(back, rbox(0.07, 0.28, 0.05, 0.02, M.dark, 0, 0.55, 0.27));
    for (const s of [-1, 1]) {
      g.add(tube([[s * 0.26, 0.46, 0.21], [s * 0.31, 0.6, 0.2], [s * 0.315, 0.67, 0.08], [s * 0.315, 0.67, -0.12], [s * 0.3, 0.58, -0.2], [s * 0.27, 0.47, -0.17]], 0.022, M.dark));
    }
    g.add(cyl(0.03, 0.03, 0.3, M.steel, 0, 0.25, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = rbox(0.3, 0.035, 0.05, 0.015, M.dark, Math.cos(a) * 0.15, 0.085, Math.sin(a) * 0.15);
      leg.rotation.y = -a;
      g.add(leg, sphere(0.038, M.dark, Math.cos(a) * 0.3, 0.038, Math.sin(a) * 0.3));
    }
    return g;
  }

  function desk(id) {
    const g = new THREE.Group();
    g.add(rbox(2.0, 0.09, 1.0, 0.045, M.desk, 0, 0.755, 0));
    g.add(rbox(0.52, 0.71, 0.92, 0.05, M.desk, 0.7, 0.355, 0));
    g.add(rbox(0.48, 0.01, 0.006, 0.003, M.seam, 0.7, 0.44, 0.461));
    g.add(rbox(0.16, 0.025, 0.012, 0.006, M.plastic, 0.7, 0.62, 0.462));
    g.add(rbox(0.06, 0.71, 0.92, 0.03, M.desk, -0.94, 0.355, 0));
    const mon = crt(id);
    mon.position.set(-0.08, 0.8, -0.18);
    g.add(mon);
    // keyboard with trackball
    const kbCv = document.createElement('canvas');
    kbCv.width = 256; kbCv.height = 80;
    const kbTex = new THREE.CanvasTexture(kbCv);
    kbTex.colorSpace = THREE.SRGBColorSpace;
    g.add(rbox(0.54, 0.035, 0.19, 0.025, M.kbBase, -0.08, 0.818, 0.3));
    const kbTop = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.155), new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.4, transparent: true }));
    kbTop.rotation.x = -Math.PI / 2;
    kbTop.position.set(-0.08, 0.8365, 0.3);
    g.add(kbTop, sphere(0.024, M.ball, 0.135, 0.84, 0.31));
    // gooseneck lamp
    const lamp = new THREE.Group();
    lamp.position.set(0.62, 0.8, -0.2);
    lamp.add(cyl(0.075, 0.085, 0.025, M.white, 0, 0.012, 0));
    lamp.add(tube([[0, 0.02, 0], [0, 0.16, 0], [-0.02, 0.27, 0.03], [-0.08, 0.32, 0.1], [-0.13, 0.3, 0.15]], 0.012, M.white));
    const lampMat = std(0xffffff, 0.35, { emissive: 0xfff0b0, emissiveIntensity: 0.05, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 24, 1, true), lampMat);
    shade.position.set(-0.14, 0.27, 0.16);
    shade.rotation.set(0.35, 0, 0.25);
    shade.castShadow = true;
    lamp.add(shade, sphere(0.022, new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), -0.145, 0.24, 0.17));
    const pl = new THREE.PointLight(0xffdfa0, 0, 3.2, 2);
    pl.position.set(-0.15, 0.2, 0.2);
    lamp.add(pl);
    lampLights.push(pl);
    g.add(lamp);
    // mug with steam
    const mug = new THREE.Group();
    mug.position.set(0.66, 0.8, 0.26);
    mug.add(cyl(0.045, 0.042, 0.1, M.blue, 0, 0.05, 0));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16), M.blue);
    handle.position.set(0.05, 0.05, 0);
    mug.add(handle);
    const steam = [0, 1, 2].map((i) => {
      const s = sphere(0.02, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 0, 0.12, 0);
      s.castShadow = false;
      s.userData.phase = i / 3;
      mug.add(s);
      return s;
    });
    g.add(mug);
    return { g, kbCv, kbTex, steam, lampMat, mug };
  }

  function carryMug() {
    const mug = new THREE.Group();
    mug.add(cyl(0.045, 0.042, 0.1, M.blue, 0, 0, 0));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16), M.blue);
    handle.position.set(0.05, 0, 0);
    mug.add(handle);
    mug.visible = false;
    return mug;
  }

  function buildStation(id) {
    const spot = DESKS[id];
    const accent = agents[id].color;
    const group = new THREE.Group();
    group.userData.agentId = id;
    group.position.set(spot.x, FY, spot.z);
    group.rotation.y = spot.yaw;
    const d = desk(id);
    group.add(d.g);
    const ch = chair();
    ch.position.set(0, 0, 0.74);
    group.add(ch);
    const rug = rbox(1.5, 0.012, 1.3, 0.05, M.mat, 0, 0.006, 0.8);
    rug.castShadow = false;
    group.add(rug);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.92, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, 0.8);
    group.add(ring);
    world.add(group);

    const bot = makeRobot({ accent, ...ROBOTS[id] });
    bot.root.userData.agentId = id;
    world.add(bot.root);
    const mug = carryMug();
    mug.position.set(0.13, 0.17, -0.2);
    bot.spine.add(mug);
    const seat = deskToWorld(id, 0, 0.7);
    stations[id] = {
      id, group, bot, chair: ch, ring, kbCv: d.kbCv, kbTex: d.kbTex, steam: d.steam, lampMat: d.lampMat,
      deskMug: d.mug, carryMug: mug, phase: Math.random() * 6, state: 'waiting', hot: 0, lean: -0.15, idleMix: 0,
      docLocal: new THREE.Vector3(-0.08, 1.45, -0.18),
      mode: 'seated', doneFor: 0, sit: 1, pos: seat.clone(), yaw: spot.yaw, path: [], cruise: 1, vel: 0, stride: 0, turnStep: 0, turnSpeed: 0, headErr: 0,
      seat, exit: deskToWorld(id, 0, 1.9), kitchen: KITCHEN_SPOTS[id], brief: deskToWorld(id, 1.3, 1.0),
    };
  }
  for (const id of Object.keys(DESKS)) buildStation(id);

  // ---- the manager (orchestrator) walks between the desks -------------------------------
  const boss = makeRobot({ accent: agents.orchestrator.color, ...ROBOTS.orchestrator });
  boss.root.userData.agentId = 'orchestrator';
  boss.setSit(0);
  world.add(boss.root);
  const tablet = new THREE.Group();
  tablet.position.set(-0.02, 0.17, -0.27);
  tablet.rotation.x = -0.93;
  tablet.add(rbox(0.2, 0.27, 0.014, 0.012, M.dark));
  const tabScr = makeScreen('orchestrator', 0.17, 0.23);
  tabScr.position.z = 0.009;
  tablet.add(tabScr);
  boss.spine.add(tablet);
  const bossRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(agents.orchestrator.color), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  bossRing.rotation.x = -Math.PI / 2;
  bossRing.position.y = 0.02;
  boss.root.add(bossRing);
  stations.orchestrator = {
    id: 'orchestrator', bot: boss, ring: bossRing, phase: 1.3, state: 'waiting', hot: 0,
    pos: HOME.clone(), yaw: Math.atan2(-(C.x - HOME.x), -(C.z - HOME.y)), path: [], cruise: 1, vel: 0, stride: 0, turnStep: 0, turnSpeed: 0, headErr: 0,
    queue: [], mode: 'home', target: null, briefUntil: 0,
  };

  // ---- documents in flight ----------------------------------------------------------------
  const docs = [];
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Group();
    d.add(rbox(0.3, 0.02, 0.4, 0.006, std(0xffffff, 0.4, { emissive: 0xffffff, emissiveIntensity: 0.25 })));
    const stripe = rbox(0.3, 0.024, 0.07, 0.006, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.003, -0.13);
    d.add(stripe);
    d.userData.stripe = stripe;
    d.visible = false;
    world.add(d);
    docs.push(d);
  }
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), bez = new THREE.Vector3();
  function docPoint(id, out) {
    if (id === 'orchestrator') { tablet.getWorldPosition(out); out.y += 0.25; return out; }
    const st = stations[id];
    return out.copy(st.docLocal).applyMatrix4(st.group.matrixWorld);
  }
  function placeDoc(d, from, to, p, color) {
    docPoint(from, va); docPoint(to, vb);
    vc.copy(va).lerp(vb, 0.5); vc.y += 1.5;
    const t = ease(p);
    bez.copy(va).multiplyScalar((1 - t) * (1 - t)).addScaledVector(vc, 2 * (1 - t) * t).addScaledVector(vb, t * t);
    world.worldToLocal(bez);
    d.position.copy(bez);
    d.rotation.set(Math.sin(p * 9) * 0.25, p * 6.5, Math.cos(p * 7) * 0.25);
    d.scale.setScalar(Math.sin(Math.min(1, p) * Math.PI) * 0.35 + 0.8);
    d.userData.stripe.material.color.set(color);
    d.visible = true;
  }
  let flights = [];

  // ---- interaction ------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groups = Object.values(stations).flatMap((s) => (s.group ? [s.group, s.bot.root] : [s.bot.root]));
  let hoverId = null, selectedId = null, down = null;
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    for (const h of raycaster.intersectObjects(groups, true)) {
      let o = h.object;
      while (o && !o.userData.agentId) o = o.parent;
      if (o) return o.userData.agentId;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved < 6 && quick) onPick(pickAt(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || down) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id !== hoverId) { hoverId = id; canvas.style.cursor = id ? 'pointer' : 'grab'; onHover && onHover(id); }
  });
  canvas.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; onHover && onHover(null); } });
  canvas.style.cursor = 'grab';
  canvas.tabIndex = 0;

  // ---- camera --------------------------------------------------------------------------------
  const homeTarget = new THREE.Vector3(0.2, 0.55, 0.3);
  let homeDist = 26;
  const want = { target: homeTarget.clone(), dist: null, settle: false };
  const viewOff = { x: 0, y: 0, tx: 0, ty: 0 };
  let W = 1, Hh = 1;
  function fitDistance(aspect) {
    const base = 22.5;
    return aspect >= 1.3 ? base : base * Math.min(2.4, Math.pow(1.3 / aspect, 0.75));
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 16 || h < 16) return; // hidden or not laid out yet; the observer fires again when it is
    W = w; Hh = h;
    renderer.setSize(W, Hh, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, Hh); }
    camera.aspect = W / Hh;
    // portrait screens: shift the framing toward the manager so the whole team fits
    if (camera.aspect < 1) homeTarget.set(-0.7, 0.55, 0.8); else homeTarget.set(0.2, 0.55, 0.3);
    if (!selectedId) want.target.copy(homeTarget);
    const oldHome = homeDist;
    homeDist = fitDistance(camera.aspect);
    if (!controls._init) {
      camera.position.copy(homeTarget).add(new THREE.Vector3(1, 0.86, 1).normalize().multiplyScalar(homeDist));
      controls.target.copy(homeTarget);
      controls._init = true;
    } else if (!selectedId) {
      const v = camera.position.clone().sub(controls.target);
      v.setLength(v.length() * (homeDist / oldHome));
      camera.position.copy(controls.target).add(v);
    }
    controls.minDistance = homeDist * 0.28;
    controls.maxDistance = homeDist * 1.25;
    applyViewOffset();
  }
  function applyViewOffset() {
    if (Math.abs(viewOff.x) < 0.5 && Math.abs(viewOff.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, Hh, viewOff.x, viewOff.y, W, Hh);
    camera.updateProjectionMatrix();
  }
  const focusPoint = new THREE.Vector3();
  function focusTarget(id, out) {
    stations[id].bot.head.getWorldPosition(out);
    world.worldToLocal(out);
    return out.add(new THREE.Vector3(0, -0.35, 0));
  }
  function focus(id, offset = { x: 0, y: 0 }) {
    selectedId = id;
    viewOff.tx = offset.x; viewOff.ty = offset.y;
    if (id) {
      focusTarget(id, want.target);
      want.dist = homeDist * 0.48;
    } else {
      want.target.copy(homeTarget);
      want.dist = homeDist;
    }
    want.settle = true;
  }

  // ---- theme ----------------------------------------------------------------------------------
  let dark = false;
  function setTheme(isDark) {
    dark = isDark;
    const p = isDark ? PAL.dark : PAL.light;
    for (const k of ['wall', 'trim', 'floor', 'slab', 'desk', 'divider', 'chair', 'mat', 'kitchen']) M[k].color.set(p[k]);
    scene.environmentIntensity = p.env;
    hemi.intensity = p.hemi;
    sun.color.set(p.sunColor); sun.intensity = p.sun;
    lampLights.forEach((l) => (l.intensity = p.lamps * 1.1));
  }

  // ---- screens: code while working, globe screensaver while waiting, check when done -------
  function drawGlobe(c, w, h, t) {
    const cx = w / 2, cy = h / 2, r = h * 0.3;
    c.strokeStyle = '#f2f2f2';
    c.lineWidth = 3;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 3; k++) {
      const rx = Math.abs(Math.cos(t * 0.5 + (k * Math.PI) / 3)) * r;
      c.beginPath(); c.ellipse(cx, cy, Math.max(1, rx), r, 0, 0, Math.PI * 2); c.stroke();
    }
    for (const f of [-0.5, 0, 0.5]) {
      const y = cy + f * r, half = Math.sqrt(1 - f * f) * r;
      c.beginPath(); c.ellipse(cx, y, half, half * 0.14, 0, 0, Math.PI * 2); c.stroke();
    }
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.32);
    const bw = r * 2.5, bh = r * 0.52;
    c.fillStyle = '#05070a';
    c.beginPath(); c.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); c.fill();
    c.lineWidth = 3; c.stroke();
    c.fillStyle = '#f2f2f2';
    c.font = `800 ${Math.round(bh * 0.5)}px system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('AGENT OFFICE', 0, 2);
    c.restore();
  }
  function drawScreens(t) {
    for (const s of screens) {
      const c = s.cv.getContext('2d');
      const w = s.cv.width, h = s.cv.height;
      c.fillStyle = '#05070a';
      c.fillRect(0, 0, w, h);
      const st = stations[s.id];
      const mode = s.id === 'orchestrator' ? 'working' : st.state;
      if (mode === 'waiting') { drawGlobe(c, w, h, t); s.tex.needsUpdate = true; continue; }
      if (mode === 'done') {
        c.fillStyle = '#3ecf6e';
        c.beginPath(); c.arc(w / 2, h * 0.42, h * 0.22, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#05070a'; c.lineWidth = h * 0.05; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(w / 2 - h * 0.1, h * 0.43); c.lineTo(w / 2 - h * 0.02, h * 0.51); c.lineTo(w / 2 + h * 0.11, h * 0.34); c.stroke();
        c.fillStyle = '#f2f2f2'; c.font = '700 22px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('DONE', w / 2, h * 0.84);
        c.textAlign = 'left';
        s.tex.needsUpdate = true;
        continue;
      }
      const lines = SCREEN_LINES[s.id];
      c.fillStyle = agents[s.id].color;
      c.fillRect(0, 0, w, 22);
      c.fillStyle = '#fff';
      c.font = '600 14px ui-monospace, Menlo, monospace';
      c.fillText('● ' + s.id, 10, 16);
      c.font = '15px ui-monospace, Menlo, monospace';
      const pos = t * s.speed * 1.6 + s.seed * 20;
      const off = pos % 20, first = Math.floor(pos / 20);
      for (let i = 0; i < Math.ceil(h / 20) + 1; i++) {
        const y = 44 + i * 20 - off;
        if (y < 28) continue;
        c.fillStyle = i % 3 === 0 ? '#9be7a6' : i % 3 === 1 ? '#e6eef7' : '#ffe19a';
        c.fillText('> ' + lines[(first + i) % lines.length], 10, y);
      }
      if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = '#9be7a6'; c.fillRect(10, h - 18, 9, 13); }
      s.tex.needsUpdate = true;
    }
    for (const st of Object.values(stations)) {
      if (!st.kbCv) continue;
      const c = st.kbCv.getContext('2d');
      c.clearRect(0, 0, 256, 80);
      const key = (x, y, w, hot) => { c.fillStyle = hot ? '#e6f7ff' : '#5fb0dc'; c.beginPath(); c.roundRect(x, y, w, 12, 3); c.fill(); };
      const working = st.state === 'working' && st.mode === 'seated';
      for (let k = 0; k < 9; k++) key(14 + k * 16, 8, 12, false);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) key(10 + k * 16 + r * 4, 26 + r * 15, 13, working && Math.random() < 0.06);
      key(48, 70, 90, false);
      for (let k = 0; k < 3; k++) key(186 + k * 16, 8, 12, false);
      st.kbTex.needsUpdate = true;
    }
  }

  // ---- animation --------------------------------------------------------------------------------
  const rel = new THREE.Vector3(), tgt = new THREE.Vector3(), headW = new THREE.Vector3();
  const KEYS_L = new THREE.Vector3(-0.22, 0.845, 0.3), KEYS_R = new THREE.Vector3(-0.0, 0.845, 0.3), BALL = new THREE.Vector3(0.135, 0.86, 0.31);
  const mugLow = new THREE.Vector3(0.13, 0.17, -0.2), mugHigh = new THREE.Vector3(0.06, 0.4, -0.24);

  // ---- walking: follow the path with eased speed, a capped turn rate and a step cycle ----
  function remaining(st) {
    let d = 0, p = st.pos;
    for (const q of st.path) { d += p.distanceTo(q); p = q; }
    return d;
  }
  function turnBy(st, err, dt) {
    const max = (3 + 2 * st.vel) * dt;
    const d = THREE.MathUtils.clamp(err, -max, max);
    st.yaw += d;
    st.turnStep += Math.abs(d);
    st.turnSpeed += (Math.abs(d) / Math.max(dt, 1e-3) - st.turnSpeed) * Math.min(1, dt * 10);
    return d;
  }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function turnTo(st, yaw, dt) { turnBy(st, wrap(yaw - st.yaw), dt); }
  function stepWalk(st, dt) {
    if (!st.path.length) { st.vel += (0 - st.vel) * Math.min(1, dt * 8); st.headErr = 0; return; }
    if (st.path.length > 1 && st.pos.distanceTo(st.path[0]) < 0.12 + 0.15 * st.vel) st.path.shift(); // round the corner
    const target = st.path[0];
    const dx = target.x - st.pos.x, dz = target.y - st.pos.y;
    const dist = Math.hypot(dx, dz);
    const err = wrap(Math.atan2(-dx, -dz) - st.yaw);
    st.headErr = err;
    turnBy(st, err, dt);
    // slow down when facing away (turn on the spot first) and when arriving
    let vT = st.cruise * Math.pow(Math.max(0, Math.cos(err)), 3);
    const left = remaining(st);
    if (left < 0.8) vT *= Math.max(0.12, left / 0.8);
    st.vel += (vT - st.vel) * Math.min(1, dt * (vT > st.vel ? 3 : 6));
    const step = st.vel * dt;
    st.pos.x -= Math.sin(st.yaw) * step;
    st.pos.y -= Math.cos(st.yaw) * step;
    st.stride += step;
    if (st.path.length === 1 && dist < 0.1) { st.pos.copy(target); st.path.shift(); }
  }
  function walk(st, dt) {
    for (let left = dt; left > 1e-4; left -= 0.03) stepWalk(st, Math.min(0.03, left)); // sub-steps keep steering stable on slow frames
    return st.path.length > 0;
  }
  function gait(st, bot, sit) {
    st.turnSpeed *= 0.9;
    const amp = Math.min(1, st.vel / 0.45 + Math.min(0.7, st.turnSpeed / 2.5));
    const phase = (st.stride / 0.62) * Math.PI * 2 + st.turnStep * 1.8;
    const swing = bot.setGait(sit, phase, amp) * amp;
    bot.spine.rotation.x = (1 - sit) * (0.03 + 0.07 * Math.min(1, st.vel / st.cruise));
    return swing;
  }
  function place(st) {
    st.bot.root.position.set(st.pos.x, FY, st.pos.y);
    st.bot.root.rotation.y = st.yaw;
  }

  function animateTypist(st, t, dt) {
    const b = st.bot;
    // behaviour: finish → coffee break in the kitchenette → back to the desk when the run restarts
    st.doneFor = st.state === 'done' ? st.doneFor + dt : 0;
    if (st.mode === 'seated' && st.doneFor > 1.0) {
      st.mode = 'out';
      st.path = [st.exit.clone(), ...route(st.exit, DOOR_IN, undefined, KITCHEN_DOOR), st.kitchen.clone()];
      st.cruise = 1.15;
    } else if ((st.mode === 'out' || st.mode === 'break') && st.state !== 'done') {
      st.mode = 'back';
      const leg = inKitchen(st.pos) ? [DOOR_IN.clone(), ...route(DOOR_IN, st.exit, KITCHEN_DOOR)] : route(st.pos, st.exit);
      st.path = [...leg, st.seat.clone()];
      st.cruise = st.state === 'working' ? 1.3 : 1.05;
    }
    let walking = false;
    if (st.mode === 'seated') {
      st.pos.lerp(st.seat, Math.min(1, dt * 6));
      const err = wrap(DESKS[st.id].yaw - st.yaw);
      turnBy(st, err, dt);
      st.vel = 0;
      st.sit += ((Math.abs(err) < 0.35 ? 1 : 0) - st.sit) * Math.min(1, dt * 5);
    } else {
      st.sit += (0 - st.sit) * Math.min(1, dt * 5);
      if (st.sit < 0.2) walking = walk(st, dt);
      if (!walking && st.mode === 'out' && st.sit < 0.2) st.mode = 'break';
      if (!walking && st.mode === 'back' && st.sit < 0.2) st.mode = 'seated';
      if (st.mode === 'break') turnTo(st, Math.atan2(-(KITCHEN_CENTER.x - st.pos.x), -(KITCHEN_CENTER.y - st.pos.y)), dt);
    }
    const swing = gait(st, b, st.sit);
    place(st);
    const standing = st.mode !== 'seated' || st.sit < 0.9;
    // the chair rolls aside so the robot can step out and back in
    st.chair.position.x += ((standing ? -0.62 : 0) - st.chair.position.x) * Math.min(1, dt * 4);
    st.chair.position.z += ((standing ? 0.95 : 0.74) - st.chair.position.z) * Math.min(1, dt * 4);
    const moving = walking || st.vel > 0.05;
    const away = st.mode !== 'seated';
    st.carryMug.visible = away;
    st.deskMug.visible = !away;

    const working = st.state === 'working';
    if (!away) {
      const leanT = working ? -0.17 : st.state === 'done' ? 0.02 : -0.08;
      st.lean += (leanT - st.lean) * Math.min(1, dt * 3);
      b.spine.rotation.x = st.lean + Math.sin(t * 1.3 + st.phase) * 0.012;
      b.neckG.rotation.x = -st.lean * 0.4 + 0.08 + Math.sin(t * 0.7 + st.phase) * 0.03;
      b.neckG.rotation.y = Math.sin(t * 0.45 + st.phase) * (working ? 0.06 : 0.2);
      st.idleMix += ((working ? 0 : 1) - st.idleMix) * Math.min(1, dt * 2.5);
      const sp = working ? 15 : 6;
      b.arms.forEach((arm, i) => {
        const ph = t * sp + st.phase + i * 1.7;
        tgt.copy(i === 0 ? KEYS_L : KEYS_R);
        if (i === 1) tgt.lerp(BALL, st.idleMix);
        tgt.x += Math.sin(ph * 0.37) * 0.02;
        tgt.y += Math.max(0, Math.sin(ph)) * (working ? 0.014 : 0.004);
        st.group.localToWorld(tgt);
        arm.shoulder.rotation.y = arm.s * 0.25;
        b.reach(arm, tgt, -0.15);
        arm.fingers.forEach((f, k) => (f.rotation.x = -0.3 - Math.max(0, Math.sin(t * (working ? 17 : 5) + k * 2.1 + i)) * (working ? 0.6 : 0.15)));
      });
      b.drawFace(working ? 'work' : st.state === 'done' ? 'done' : 'wait', t);
    } else {
      b.neckG.rotation.x = moving ? 0.06 + Math.abs(swing) * 0.03 : 0.02 + Math.sin(t * 1.4 + st.phase) * 0.04;
      b.neckG.rotation.y = st.mode === 'break' && !moving ? Math.sin(t * 0.6 + st.phase) * 0.3 : THREE.MathUtils.clamp(st.headErr * 0.6, -0.5, 0.5);
      const sip = st.mode === 'break' && Math.sin(t * 0.8 + st.phase) > 0.75 ? 1 : 0;
      st.carryMug.position.lerp(sip ? mugHigh : mugLow, Math.min(1, dt * 4));
      const [left, right] = b.arms;
      right.shoulder.rotation.y = 0.3;
      st.carryMug.getWorldPosition(tgt);
      tgt.y -= 0.02;
      b.reach(right, tgt, 0.2);
      left.shoulder.rotation.y = 0;
      b.setArm(left, 0.1 - swing * 0.45, 0.3 + Math.max(0, swing) * 0.25, 0);
      b.drawFace(moving ? 'walk' : 'coffee', t);
    }
  }

  function animateBoss(st, t, dt) {
    const b = st.bot;
    if (st.mode !== 'walking' && st.mode !== 'brief' && st.queue.length) {
      const target = st.queue.shift();
      st.target = target === 'publish' ? null : target;
      st.path = route(st.pos, target === 'publish' ? HOME : stations[target].brief);
      st.mode = 'walking';
    }
    let walking = false;
    if (st.mode === 'walking') {
      walking = walk(st, dt);
      if (!walking) {
        if (st.target) { st.mode = 'brief'; st.briefUntil = t + 2.6; }
        else st.mode = 'home';
      }
    } else if (st.mode === 'brief') {
      const seat = stations[st.target].pos;
      turnTo(st, Math.atan2(-(seat.x - st.pos.x), -(seat.y - st.pos.y)), dt);
      if (t > st.briefUntil) {
        st.target = null;
        if (!st.queue.length) { st.path = route(st.pos, HOME); st.mode = 'walking'; } else st.mode = 'home';
      }
    } else {
      turnTo(st, Math.atan2(-(C.x - st.pos.x), -(C.z - st.pos.y)) + Math.sin(t * 0.25) * 0.3, dt * 0.5);
    }
    const swing = gait(st, b, 0);
    place(st);
    const moving = walking || st.vel > 0.05;
    const briefing = st.mode === 'brief';
    b.neckG.rotation.x = briefing ? 0 : moving ? 0.05 + Math.abs(swing) * 0.03 : 0.25 + Math.sin(t * 0.6) * 0.1;
    b.neckG.rotation.y = briefing ? Math.sin(t * 2) * 0.08 : moving ? THREE.MathUtils.clamp(st.headErr * 0.6, -0.5, 0.5) : Math.sin(t * 0.5) * 0.2;
    const [left, right] = b.arms;
    tablet.getWorldPosition(tgt);
    left.shoulder.rotation.y = -0.3;
    b.reach(left, tgt.add(new THREE.Vector3(0, -0.06, 0)), 0.3);
    right.shoulder.rotation.y = briefing ? 0 : 0.25;
    if (briefing) {
      b.setArm(right, 1.45 + Math.sin(t * 5) * 0.12, 0.25, 0.1);
      right.fingers.forEach((f, k) => (f.rotation.x = k ? -1.2 : 0));
    } else if (moving) {
      b.setArm(right, 0.1 + swing * 0.45, 0.3 + Math.max(0, -swing) * 0.25, 0);
    } else {
      tablet.getWorldPosition(tgt);
      b.reach(right, tgt.add(new THREE.Vector3(0, -0.03 + Math.max(0, Math.sin(t * 6)) * 0.03, 0)), 0.2);
      right.fingers.forEach((f) => (f.rotation.x = -0.3));
    }
    b.drawFace(briefing ? 'talk' : moving ? 'walk' : st.state === 'working' ? 'work' : 'wait', t);
  }

  // ---- loop -----------------------------------------------------------------------------------
  let last = performance.now() / 1000, screenClock = 0, clockT = 0, onFrame = null, running = true;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const rawDt = Math.min(0.6, now - last); // behaviour uses real time so robots keep pace on slow frames
    const dt = Math.min(0.05, rawDt);
    last = now;
    const t = now;
    const mo = reduceMotion ? 0.25 : 1;

    const bob = Math.sin(t * 0.8) * 0.08 * mo;
    world.position.y = bob;
    shadowPlane.scale.setScalar(1 - bob * 0.25);

    world.updateMatrixWorld();
    for (const st of Object.values(stations)) {
      const working = st.state === 'working';
      st.hot += ((hoverId === st.id || selectedId === st.id ? 1 : 0) - st.hot) * Math.min(1, dt * 10);
      if (st.id === 'orchestrator') animateBoss(st, t, rawDt);
      else {
        animateTypist(st, t, rawDt);
        st.steam.forEach((s) => {
          const p = (t * 0.35 + s.userData.phase) % 1;
          s.position.set(Math.sin(p * 7 + s.userData.phase * 9) * 0.025, 0.12 + p * 0.28, 0);
          s.material.opacity = (1 - p) * 0.45;
          s.scale.setScalar(0.6 + p * 1.4);
        });
        st.lampMat.emissiveIntensity = working ? 1.1 + Math.sin(t * 5) * 0.25 : dark ? 0.8 : 0.05;
      }
      st.bot.bodyMat.emissiveIntensity = st.hot * 0.3;
      st.bot.glowMat.emissiveIntensity = working ? 0.9 + Math.sin(t * 6) * 0.5 : 0.35;
      const op = Math.min(0.85, (working ? 0.5 + Math.sin(t * 4) * 0.18 : 0) + st.hot * 0.4);
      st.ring.material.opacity = op;
      st.ring.visible = op > 0.01;
    }

    const k = 1 - Math.exp(-dt * 4.5);
    if (selectedId && !want.settle) focusTarget(selectedId, want.target); // follow a walking robot
    controls.target.lerp(want.target, k);
    if (want.settle && want.dist) {
      rel.copy(camera.position).sub(controls.target);
      const r = rel.length();
      const nr = r + (want.dist - r) * k;
      rel.setLength(nr);
      camera.position.copy(controls.target).add(rel);
      if (Math.abs(nr - want.dist) < 0.08 && controls.target.distanceTo(want.target) < 0.05) want.settle = false;
    }
    if (Math.abs(viewOff.x - viewOff.tx) > 0.3 || Math.abs(viewOff.y - viewOff.ty) > 0.3) {
      viewOff.x += (viewOff.tx - viewOff.x) * k;
      viewOff.y += (viewOff.ty - viewOff.y) * k;
      applyViewOffset();
    }
    controls.update();

    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    hands[2].rotation.z = -(sec / 60) * Math.PI * 2;
    hands[1].rotation.z = -((d.getMinutes() + sec / 60) / 60) * Math.PI * 2;
    hands[0].rotation.z = -(((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
    lens.position.x = Math.sin(t * 0.5) * 0.04 * mo + 0.02;
    lens.position.z = Math.cos(t * 0.5) * 0.04 * mo;
    led.visible = Math.floor(t * 1.6) % 2 === 0;
    mwLed.visible = Math.floor(t * 0.9) % 3 !== 0;

    docs.forEach((dd) => (dd.visible = false));
    flights.slice(0, docs.length).forEach((f, i) => placeDoc(docs[i], f.from, f.to, f.p, agents[f.from].color));

    screenClock += dt; clockT += dt;
    if (screenClock > 1 / 12) { screenClock = 0; drawScreens(clockT); }

    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    if (onFrame) onFrame(dt);
  }

  function projectLabel(id) {
    stations[id].bot.head.getWorldPosition(headW);
    headW.y += id === 'orchestrator' ? 0.5 : 0.42;
    headW.project(camera);
    return { x: ((headW.x + 1) / 2) * W, y: ((1 - headW.y) / 2) * Hh, behind: headW.z > 1 };
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(frame);

  return {
    focus,
    setTheme,
    setStates(map) { for (const [id, s] of Object.entries(map)) if (stations[id]) stations[id].state = s; },
    setFlights(list) { flights = list; },
    setWall(info) { wallInfo = info; drawWall(); },
    // queue the manager to walk over and brief an agent ('publish' sends it back to its spot)
    cue(id) { const b = stations.orchestrator; if (!b.queue.includes(id) && b.target !== id) b.queue.push(id); },
    resetCues() { const b = stations.orchestrator; b.queue = []; },
    projectLabel,
    set onFrame(fn) { onFrame = fn; },
    get selected() { return selectedId; },
    dispose() { running = false; renderer.dispose(); },
    _debug: { camera, controls, stations, docs, hq, scene },
  };
}
