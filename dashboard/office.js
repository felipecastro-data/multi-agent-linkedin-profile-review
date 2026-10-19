import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makePerson } from './people.js';

const R = 5;          // half the room size
const FY = 0.1;       // floor surface height
const H = 3.3;        // wall height
const C = { x: 0, z: 0.6 }; // centre of the four-desk pod
// Pinwheel: each desk backs onto one arm of the green cross divider.
const DESKS = {
  scraper: { x: C.x - 1.06, z: C.z - 0.56, yaw: Math.PI },
  'career-coach': { x: C.x + 0.56, z: C.z - 1.06, yaw: Math.PI / 2 },
  recruiter: { x: C.x - 0.56, z: C.z + 1.06, yaw: -Math.PI / 2 },
  synthesis: { x: C.x + 1.06, z: C.z + 0.56, yaw: 0 },
};
const MANAGER = { x: -2.55, z: 3.35 };

const PEOPLE = {
  scraper: { skin: 0xe9c3a0, hair: 0x2b2420, hairStyle: 'short', pants: 0x2f3a4c, letter: 'S' },
  recruiter: { skin: 0xc68c64, hair: 0x1d1714, hairStyle: 'ponytail', pants: 0x3b4252, letter: 'R' },
  'career-coach': { skin: 0x8d5a3b, hair: 0x15110f, hairStyle: 'curly', pants: 0x2c3442, letter: 'C' },
  synthesis: { skin: 0xf1d2b6, hair: 0x7a4a26, hairStyle: 'bun', pants: 0x36404f, letter: 'Σ' },
  orchestrator: { skin: 0xd9a77f, hair: 0x5d5a57, hairStyle: 'side', pants: 0x2b2f38 },
};

const SCREEN_LINES = {
  scraper: ['navigate(profile_url)', 'scroll → experience', "click 'Show all skills'", 'read_page(about)', 'get_page_text()', 'extract headline', 'extract positions[]', 'note missing_fields', 'javascript_tool(dom)', 'write profile.json'],
  recruiter: ['score = rubric(profile)', 'WebSearch(salary range)', 'WebFetch(job board)', 'gap: skill ∉ postings', 'draft headline v2', 'cite r3, r7', 'check certifications', 'rank keywords', 'write recruiter.json'],
  'career-coach': ['WebFetch(WEF jobs report)', 'WebFetch(BLS OOH)', 'compare CO / MX / ES / US', 'SWOT.opportunities', 'cite s2, s5', 'IC vs management', 'skip_for_now[]', 'tenure outlook', 'write career_coach.json'],
  synthesis: ['read recruiter.json', 'read career_coach.json', 'merge → summary', 'diff vs previous run', 'build plan.actions', 'resolve conflicts', 'validate schema v2', 'write run.json'],
  orchestrator: ['new_run.py', 'Agent(scraper)', 'Agent(recruiter) ‖ Agent(coach)', 'wait for both', 'Agent(synthesis)', 'validate_run.py', 'publish.py', 'report'],
};

const PAL = {
  light: { wall: 0xf1f3f1, trim: 0x9db0c6, floor: 0x6f9c50, slab: 0xf5f6f5, desk: 0xf7f8f7, divider: 0x2e6a3c, chair: 0x2c3a52, mat: 0xb5bcc0, kitchen: 0xe9ecef, env: 0.62, hemi: 0.35, sun: 2.3, sunColor: 0xfff3e2, lamps: 0 },
  dark: { wall: 0x9aa6b3, trim: 0x5e7390, floor: 0x456f36, slab: 0x8a96a2, desk: 0xc9d0d6, divider: 0x1e4a29, chair: 0x1d273a, mat: 0x5c666b, kitchen: 0x8a949c, env: 0.24, hemi: 0.3, sun: 0.75, sunColor: 0x9db6ff, lamps: 1 },
};

const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
function rbox(w, h, d, r, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), mat);
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
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

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
    wall: std(PAL.light.wall, 0.75), trim: std(PAL.light.trim, 0.55), floor: std(PAL.light.floor, 0.95),
    slab: std(PAL.light.slab, 0.7), desk: std(PAL.light.desk, 0.45), divider: std(PAL.light.divider, 0.85),
    chair: std(PAL.light.chair, 0.6), mat: std(PAL.light.mat, 0.6, { transparent: true, opacity: 0.6 }),
    kitchen: std(PAL.light.kitchen, 0.4), seam: std(0xdde3e6, 0.8),
    dark: std(0x262b33, 0.4), white: std(0xfbfbfa, 0.4), steel: std(0xc5ccd3, 0.3, { metalness: 0.4 }),
    blue: std(0x2f6fd6, 0.35), plastic: std(0xe6ebef, 0.35), leaf: std(0x3d8a3a, 0.6),
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
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 12, 48), M.trim);
  clock.add(face, rim);
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

  // cross divider in the middle of the pod
  const pod = new THREE.Group();
  pod.add(rbox(4.3, 1.3, 0.07, 0.03, M.divider, C.x, FY + 0.7, C.z));
  pod.add(rbox(0.07, 1.3, 4.3, 0.03, M.divider, C.x, FY + 0.7, C.z));
  pod.add(rbox(4.34, 0.05, 0.11, 0.02, M.plastic, C.x, FY + 1.37, C.z));
  pod.add(rbox(0.11, 0.05, 4.34, 0.02, M.plastic, C.x, FY + 1.37, C.z));
  for (const [x, z] of [[2.15, 0], [-2.15, 0], [0, 2.15], [0, -2.15], [0, 0]]) pod.add(rbox(0.1, 1.36, 0.1, 0.03, M.plastic, C.x + x, FY + 0.68, C.z + z));
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

  function makeScreen(id, w, h, accent) {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = Math.round(320 * (h / w));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screens.push({ id, cv, tex, accent, seed: Math.random() * 100, speed: 14 + Math.random() * 8 });
    return m;
  }

  function monitor(id, accent) {
    const g = new THREE.Group();
    g.add(rbox(0.28, 0.02, 0.22, 0.01, M.white, 0, 0.01, 0.02));
    g.add(rbox(0.07, 0.16, 0.06, 0.02, M.white, 0, 0.09, -0.02));
    g.add(rbox(0.64, 0.46, 0.36, 0.07, M.white, 0, 0.39, 0));
    g.add(rbox(0.46, 0.32, 0.2, 0.07, M.white, 0, 0.39, -0.22));
    g.add(rbox(0.56, 0.38, 0.02, 0.025, M.dark, 0, 0.395, 0.175));
    const scr = makeScreen(id, 0.5, 0.33, accent);
    scr.position.set(0, 0.395, 0.187);
    g.add(scr);
    g.add(rbox(0.06, 0.012, 0.01, 0.004, new THREE.MeshBasicMaterial({ color: accent }), 0.22, 0.19, 0.18));
    return g;
  }

  function chair() {
    const g = new THREE.Group();
    g.add(rbox(0.56, 0.09, 0.52, 0.045, M.chair, 0, 0.44, 0));
    const back = rbox(0.52, 0.58, 0.08, 0.04, M.chair, 0, 0.82, 0.27);
    back.rotation.x = 0.1;
    g.add(back, rbox(0.42, 0.18, 0.06, 0.03, M.chair, 0, 0.66, 0.24));
    g.add(rbox(0.06, 0.26, 0.04, 0.015, M.dark, 0, 0.5, 0.22));
    for (const s of [-1, 1]) {
      g.add(rbox(0.035, 0.2, 0.035, 0.012, M.dark, s * 0.3, 0.55, 0.02));
      g.add(rbox(0.07, 0.03, 0.26, 0.014, M.dark, s * 0.3, 0.66, 0.0));
    }
    g.add(cyl(0.028, 0.028, 0.3, M.steel, 0, 0.25, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = rbox(0.3, 0.035, 0.05, 0.015, M.dark, Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15);
      leg.rotation.y = -a;
      g.add(leg, sphere(0.035, M.dark, Math.cos(a) * 0.3, 0.035, Math.sin(a) * 0.3));
    }
    return g;
  }

  function desk(withPlant) {
    const g = new THREE.Group();
    g.add(rbox(2.0, 0.05, 1.0, 0.02, M.desk, 0, 0.735, 0));
    g.add(rbox(0.5, 0.68, 0.88, 0.03, M.desk, 0.68, 0.35, 0.02));
    for (let i = 0; i < 3; i++) {
      g.add(rbox(0.44, 0.19, 0.02, 0.008, M.plastic, 0.68, 0.14 + i * 0.215, 0.465));
      g.add(rbox(0.12, 0.016, 0.02, 0.007, M.trim, 0.68, 0.2 + i * 0.215, 0.48));
    }
    g.add(rbox(0.05, 0.7, 0.88, 0.015, M.desk, -0.95, 0.35, 0.02));
    // keyboard + mouse
    const kbCv = document.createElement('canvas');
    kbCv.width = 192; kbCv.height = 64;
    const kbTex = new THREE.CanvasTexture(kbCv);
    kbTex.colorSpace = THREE.SRGBColorSpace;
    g.add(rbox(0.46, 0.025, 0.15, 0.01, std(0xdfe6ee, 0.4), -0.05, 0.775, 0.32));
    const kbTop = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.125), new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.5 }));
    kbTop.rotation.x = -Math.PI / 2;
    kbTop.position.set(-0.05, 0.789, 0.32);
    g.add(kbTop);
    g.add(rbox(0.22, 0.004, 0.18, 0.002, std(0x30425e, 0.8), 0.33, 0.762, 0.33));
    const mouse = sphere(0.035, M.white, 0.33, 0.775, 0.33);
    mouse.scale.set(0.8, 0.5, 1.2);
    g.add(mouse);
    // mug with steam
    const mug = new THREE.Group();
    mug.position.set(0.62, 0.76, 0.12);
    mug.add(cyl(0.045, 0.04, 0.1, M.blue, 0, 0.05, 0));
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
    // architect lamp
    const lamp = new THREE.Group();
    lamp.position.set(-0.78, 0.76, -0.3);
    lamp.add(cyl(0.08, 0.09, 0.03, M.white, 0, 0.015, 0));
    const a1 = rbox(0.025, 0.36, 0.025, 0.01, M.white, 0.04, 0.19, 0);
    a1.rotation.z = -0.25;
    const a2 = rbox(0.025, 0.3, 0.025, 0.01, M.white, 0.12, 0.42, 0.06);
    a2.rotation.set(0.6, 0, -0.9);
    lamp.add(a1, a2, sphere(0.022, M.white, 0.085, 0.36, 0));
    const lampMat = std(0xffffff, 0.4, { emissive: 0xfff0b0, emissiveIntensity: 0.1, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.13, 24, 1, true), lampMat);
    shade.position.set(0.22, 0.5, 0.15);
    shade.rotation.set(0.7, 0, -0.3);
    shade.castShadow = true;
    lamp.add(shade);
    lamp.add(sphere(0.028, new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), 0.22, 0.46, 0.17));
    const pl = new THREE.PointLight(0xffdfa0, 0, 3.5, 2);
    pl.position.set(0.22, 0.42, 0.2);
    lamp.add(pl);
    lampLights.push(pl);
    g.add(lamp);
    const paper = rbox(0.22, 0.02, 0.3, 0.004, M.white, 0.42, 0.77, -0.22);
    paper.rotation.y = 0.2;
    g.add(paper);
    if (withPlant) {
      const p = new THREE.Group();
      p.position.set(0.82, 0.76, -0.3);
      p.add(cyl(0.06, 0.05, 0.1, M.white, 0, 0.05, 0));
      for (let i = 0; i < 6; i++) {
        const lf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.leaf);
        lf.scale.set(0.5, 1.3, 0.2);
        const a = (i / 6) * Math.PI * 2;
        lf.position.set(Math.cos(a) * 0.04, 0.16, Math.sin(a) * 0.04);
        lf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
        lf.castShadow = true;
        p.add(lf);
      }
      g.add(p);
    }
    return { g, kbCv, kbTex, steam, lampMat };
  }

  const topColor = (accent) => new THREE.Color(accent).lerp(new THREE.Color(0x30343c), 0.18).getHex();

  function buildStation(id) {
    const spot = DESKS[id];
    const accent = agents[id].color;
    const group = new THREE.Group();
    group.userData.agentId = id;
    group.position.set(spot.x, FY, spot.z);
    group.rotation.y = spot.yaw;
    const d = desk(id === 'scraper' || id === 'synthesis');
    group.add(d.g);
    const mon = monitor(id, accent);
    mon.position.set(-0.05, 0.76, -0.22);
    group.add(mon);
    const ch = chair();
    ch.position.set(0, 0, 0.92);
    group.add(ch);
    const rug = rbox(1.5, 0.012, 1.3, 0.006, M.mat, 0, 0.006, 0.88);
    rug.castShadow = false;
    group.add(rug);
    const person = makePerson({ pose: 'sit', top: topColor(accent), accent, headphones: true, ...PEOPLE[id] });
    person.root.position.set(0, 0.48, 0.9);
    group.add(person.root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.98, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, 0.85);
    group.add(ring);
    world.add(group);
    stations[id] = {
      id, group, person, chair: ch, ring, kbCv: d.kbCv, kbTex: d.kbTex, steam: d.steam, lampMat: d.lampMat,
      bodyMat: person.torso.material, phase: Math.random() * 6, state: 'waiting', hot: 0, lean: -0.2, mouseMix: 0,
      docLocal: new THREE.Vector3(-0.05, 1.45, -0.22),
    };
  }
  for (const id of Object.keys(DESKS)) buildStation(id);

  // ---- the manager (orchestrator) stands next to the pod ---------------------------------
  const boss = makePerson({ pose: 'stand', top: 0x3a3f48, blazer: topColor(agents.orchestrator.color), accent: '#2f4f8f', ...PEOPLE.orchestrator });
  const bossGroup = new THREE.Group();
  bossGroup.userData.agentId = 'orchestrator';
  bossGroup.position.set(MANAGER.x, FY, MANAGER.z);
  bossGroup.add(boss.root);
  // tablet held in front of the chest, screen tilted up toward the face
  const tablet = new THREE.Group();
  tablet.position.set(0, 0.16, -0.3);
  tablet.rotation.x = -0.93;
  tablet.add(rbox(0.22, 0.3, 0.014, 0.012, M.dark));
  const tabScr = makeScreen('orchestrator', 0.19, 0.26, agents.orchestrator.color);
  tabScr.position.z = 0.009;
  tablet.add(tabScr);
  boss.spine.add(tablet);
  const bossRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(agents.orchestrator.color), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  bossRing.rotation.x = -Math.PI / 2;
  bossRing.position.y = 0.02;
  bossGroup.add(bossRing);
  world.add(bossGroup);
  stations.orchestrator = {
    id: 'orchestrator', group: bossGroup, person: boss, ring: bossRing, bodyMat: boss.torso.material,
    phase: 1.3, state: 'waiting', hot: 0, cue: null, cueUntil: 0, point: 0,
    yaw: Math.atan2(-(C.x - MANAGER.x), -(C.z - MANAGER.z)),
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
    const st = stations[id];
    if (id === 'orchestrator') { tablet.getWorldPosition(out); out.y += 0.25; return out; }
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
  const groups = Object.values(stations).map((s) => s.group);
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
  function focus(id, offset = { x: 0, y: 0 }) {
    selectedId = id;
    viewOff.tx = offset.x; viewOff.ty = offset.y;
    if (id) {
      stations[id].person.head.getWorldPosition(focusPoint);
      world.worldToLocal(focusPoint);
      want.target.copy(focusPoint).add(new THREE.Vector3(0, -0.45, 0));
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

  // ---- screens & keyboards --------------------------------------------------------------------
  function drawScreens(t) {
    for (const s of screens) {
      const key = s.id;
      const lines = SCREEN_LINES[key];
      const c = s.cv.getContext('2d');
      const w = s.cv.width, h = s.cv.height;
      c.fillStyle = '#0a1912';
      c.fillRect(0, 0, w, h);
      c.fillStyle = s.accent;
      c.fillRect(0, 0, w, 22);
      c.fillStyle = '#fff';
      c.font = '600 14px ui-monospace, Menlo, monospace';
      c.fillText('● ' + key, 8, 16);
      c.font = '15px ui-monospace, Menlo, monospace';
      const st = stations[key];
      const speed = st && st.state === 'working' ? 1.8 : 0.8;
      const pos = t * s.speed * speed + s.seed * 20;
      const off = pos % 20, first = Math.floor(pos / 20);
      const rows = Math.ceil(h / 20) + 1;
      for (let i = 0; i < rows; i++) {
        const line = lines[(first + i) % lines.length];
        const y = 44 + i * 20 - off;
        if (y < 28) continue;
        c.fillStyle = i % 3 === 0 ? '#9be7a6' : i % 3 === 1 ? '#cfe3ff' : '#ffe19a';
        c.fillText('> ' + line, 8, y);
      }
      if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = '#9be7a6'; c.fillRect(8, h - 18, 9, 13); }
      s.tex.needsUpdate = true;
    }
    for (const st of Object.values(stations)) {
      if (!st.kbCv) continue;
      const c = st.kbCv.getContext('2d');
      c.fillStyle = '#e9eef3'; c.fillRect(0, 0, 192, 64);
      c.fillStyle = '#c2cbd5';
      for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) c.fillRect(5 + k * 13, 5 + r * 14.5, 11, 11);
      c.fillStyle = agents[st.id].color;
      const n = st.state === 'working' ? 4 : 1;
      for (let i = 0; i < n; i++) c.fillRect(5 + Math.floor(Math.random() * 14) * 13, 5 + Math.floor(Math.random() * 4) * 14.5, 11, 11);
      st.kbTex.needsUpdate = true;
    }
  }

  // ---- animation --------------------------------------------------------------------------------
  const rel = new THREE.Vector3(), tgt = new THREE.Vector3(), tgt2 = new THREE.Vector3(), headW = new THREE.Vector3();
  const KEYS_L = new THREE.Vector3(-0.16, 0.805, 0.34), KEYS_R = new THREE.Vector3(0.06, 0.805, 0.34), MOUSE = new THREE.Vector3(0.33, 0.81, 0.36);

  function animateTypist(st, t, dt) {
    const p = st.person;
    const working = st.state === 'working';
    const done = st.state === 'done';
    const leanT = working ? -0.24 : done ? -0.06 : -0.16;
    st.lean += (leanT - st.lean) * Math.min(1, dt * 3);
    p.spine.rotation.x = st.lean + Math.sin(t * 1.3 + st.phase) * 0.01;
    p.neckG.rotation.x = -st.lean * 0.6 + 0.04 + Math.sin(t * 0.7 + st.phase) * 0.03;
    p.neckG.rotation.y = Math.sin(t * 0.45 + st.phase) * (working ? 0.06 : 0.18);
    st.mouseMix += ((working ? 0 : 1) - st.mouseMix) * Math.min(1, dt * 2.5);
    const sp = working ? 15 : 7;
    p.arms.forEach((arm, i) => {
      const ph = t * sp + st.phase + i * 1.7;
      tgt.copy(i === 0 ? KEYS_L : KEYS_R);
      if (i === 1) tgt.lerp(MOUSE, st.mouseMix);
      tgt.x += Math.sin(ph * 0.37) * 0.025;
      tgt.y += Math.max(0, Math.sin(ph)) * (working ? 0.012 : 0.004);
      tgt.z += Math.sin(ph * 0.23) * 0.01;
      st.group.localToWorld(tgt);
      arm.shoulder.rotation.y = arm.s * 0.2;
      p.reach(arm, tgt, -0.15);
      arm.fingers.forEach((f, k) => {
        const tap = Math.max(0, Math.sin(t * (working ? 16 : 5) + k * 1.9 + i * 0.8 + st.phase));
        f.rotation.x = -0.35 - tap * (working ? 0.55 : 0.15);
      });
    });
    p.blink(t);
  }

  function animateBoss(st, t, dt) {
    const p = st.person;
    const cueing = st.cue && t < st.cueUntil;
    let yawT = Math.atan2(-(C.x - MANAGER.x), -(C.z - MANAGER.z)) + Math.sin(t * 0.25) * 0.35;
    if (cueing) {
      const d = DESKS[st.cue];
      yawT = Math.atan2(-(d.x - MANAGER.x), -(d.z - MANAGER.z));
    }
    st.yaw += (yawT - st.yaw) * Math.min(1, dt * 2.2);
    p.root.rotation.y = st.yaw;
    p.hips.position.x = Math.sin(t * 0.8) * 0.015;
    p.hips.rotation.z = Math.sin(t * 0.8) * 0.02;
    p.spine.rotation.x = -0.03 + Math.sin(t * 1.1) * 0.01;
    const glance = !cueing && Math.sin(t * 0.6 + 1) > 0.35;
    p.neckG.rotation.x += ((glance ? 0.42 : 0.02) - p.neckG.rotation.x) * Math.min(1, dt * 3);
    p.neckG.rotation.y = cueing ? 0 : Math.sin(t * 0.5) * 0.25;
    st.point += ((cueing ? 1 : 0) - st.point) * Math.min(1, dt * 4);
    const [left, right] = p.arms;
    st.group.updateMatrixWorld(true);
    tablet.getWorldPosition(tgt);
    left.shoulder.rotation.y = -0.3;
    p.reach(left, tgt2.copy(tgt).add(new THREE.Vector3(0, -0.08, 0)), 0.3);
    right.shoulder.rotation.y = 0.2 - st.point * 0.3;
    if (st.point > 0.02) {
      const wave = Math.sin(t * 5) * 0.08;
      p.setArm(right, THREE.MathUtils.lerp(0.9, 1.5 + wave, st.point), THREE.MathUtils.lerp(1.0, 0.18, st.point), 0.1);
    } else {
      p.reach(right, tgt2.copy(tgt).add(new THREE.Vector3(0, -0.02 + Math.max(0, Math.sin(t * 6)) * 0.02, 0)), 0.2);
    }
    right.fingers.forEach((f, k) => (f.rotation.x = st.point > 0.5 ? (k === 1 ? 0 : -1.2) : -0.3));
    left.fingers.forEach((f) => (f.rotation.x = -0.6));
    p.blink(t);
  }

  // ---- loop -----------------------------------------------------------------------------------
  let last = performance.now() / 1000, screenClock = 0, clockT = 0, onFrame = null, running = true;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    const t = now;
    const mo = reduceMotion ? 0.25 : 1;

    const bob = Math.sin(t * 0.8) * 0.08 * mo;
    world.position.y = bob;
    shadowPlane.scale.setScalar(1 - bob * 0.25);

    const k = 1 - Math.exp(-dt * 4.5);
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

    world.updateMatrixWorld();
    for (const st of Object.values(stations)) {
      const working = st.state === 'working';
      st.hot += ((hoverId === st.id || selectedId === st.id ? 1 : 0) - st.hot) * Math.min(1, dt * 10);
      if (st.id === 'orchestrator') animateBoss(st, t, dt);
      else {
        animateTypist(st, t, dt);
        st.chair.rotation.y = Math.sin(t * 0.4 + st.phase) * 0.05 * mo;
        st.steam.forEach((s) => {
          const p = (t * 0.35 + s.userData.phase) % 1;
          s.position.set(Math.sin(p * 7 + s.userData.phase * 9) * 0.025, 0.12 + p * 0.28, 0);
          s.material.opacity = (1 - p) * 0.45;
          s.scale.setScalar(0.6 + p * 1.4);
        });
        st.lampMat.emissiveIntensity = working ? 1.1 + Math.sin(t * 5) * 0.25 : dark ? 0.8 : 0.08;
      }
      st.bodyMat.emissive.set(agents[st.id].color);
      st.bodyMat.emissiveIntensity = st.hot * 0.3;
      const op = Math.min(0.85, (working ? 0.5 + Math.sin(t * 4) * 0.18 : 0) + st.hot * 0.4);
      st.ring.material.opacity = op;
      st.ring.visible = op > 0.01;
    }

    docs.forEach((dd) => (dd.visible = false));
    flights.slice(0, docs.length).forEach((f, i) => placeDoc(docs[i], f.from, f.to, f.p, agents[f.from].color));

    screenClock += dt; clockT += dt;
    if (screenClock > 1 / 12) { screenClock = 0; drawScreens(clockT); }

    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    if (onFrame) onFrame(dt);
  }

  function projectLabel(id) {
    stations[id].person.head.getWorldPosition(headW);
    headW.y += id === 'orchestrator' ? 0.42 : 0.5;
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
    cue(id, seconds = 2.8) { const b = stations.orchestrator; b.cue = id; b.cueUntil = performance.now() / 1000 + seconds; },
    projectLabel,
    set onFrame(fn) { onFrame = fn; },
    get selected() { return selectedId; },
    dispose() { running = false; renderer.dispose(); },
    _debug: { camera, controls, stations, docs, hq, scene },
  };
}
