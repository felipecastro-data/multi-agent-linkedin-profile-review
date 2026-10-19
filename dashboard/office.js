import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const FY = 0.1; // floor surface height
const POD = new THREE.Vector3(1.0, FY, 0.8);
const SPOTS = {
  scraper: [POD.x, FY, POD.z - 2.6],
  recruiter: [POD.x - 2.5, FY, POD.z],
  'career-coach': [POD.x + 2.5, FY, POD.z],
  synthesis: [POD.x, FY, POD.z + 2.6],
  orchestrator: [-4.3, FY + 0.12, -4.8],
};

const LABEL_Y = { scraper: 3.4, recruiter: 2.5, 'career-coach': 2.5, synthesis: 2.5, orchestrator: 3.6 };
const SCREEN_LINES = {
  scraper: ['navigate(profile_url)', 'scroll → experience', "click 'Show all skills'", 'read_page(about)', 'get_page_text()', 'extract headline', 'extract positions[]', 'note missing_fields', 'javascript_tool(dom)', 'write profile.json'],
  recruiter: ['score = rubric(profile)', 'WebSearch(salary range)', 'WebFetch(job board)', 'gap: skill ∉ postings', 'draft headline v2', 'cite r3, r7', 'check certifications', 'rank keywords', 'write recruiter.json'],
  'career-coach': ['WebFetch(WEF jobs report)', 'WebFetch(BLS OOH)', 'compare CO / MX / ES / US', 'SWOT.opportunities', 'cite s2, s5', 'IC vs management', 'skip_for_now[]', 'tenure outlook', 'write career_coach.json'],
  synthesis: ['read recruiter.json', 'read career_coach.json', 'merge → summary', 'diff vs previous run', 'build plan.actions', 'resolve conflicts', 'validate schema v2', 'write run.json'],
  orchestrator: ['new_run.py', 'Agent(scraper)', 'Agent(recruiter) ‖ Agent(coach)', 'wait for both', 'Agent(synthesis)', 'validate_run.py', 'publish.py', 'report'],
};

const PAL = {
  light: { wall: 0xeef1ee, trim: 0x8aa0b8, floor: 0x5e9c3a, slab: 0xf3f5f3, desk: 0xf6f8f6, divider: 0x2f6b3a, chair: 0x2f3d55, mat: 0x9aa5a8, hemiSky: 0xffffff, hemiGround: 0xa9c0a0, hemi: 1.0, sun: 1.7, sunColor: 0xfff4e0, lamps: 0, screen: 1 },
  dark: { wall: 0x8a97a6, trim: 0x5a6e88, floor: 0x417d2d, slab: 0x77828c, desk: 0xb9c2c9, divider: 0x1d4527, chair: 0x1c2638, mat: 0x4c565a, hemiSky: 0x5f7396, hemiGround: 0x1d2a22, hemi: 1.05, sun: 0.9, sunColor: 0x93b0ff, lamps: 1, screen: 1.25 },
};

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, ...extra });
}
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function sphere(r, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function capsule(r, len, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material);
  m.castShadow = true;
  return m;
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createOffice(canvas, { agents, onPick, onHover }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.3;
  controls.minAzimuthAngle = 0.05;
  controls.maxAzimuthAngle = 1.52;
  controls.rotateSpeed = 0.6;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- lights ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0xa9c0a0, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.position.set(7, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  const lampLights = [];

  // ---- materials (retinted by theme) --------------------------------------
  const M = {
    wall: mat(PAL.light.wall), trim: mat(PAL.light.trim), floor: mat(PAL.light.floor, { roughness: 0.95 }),
    slab: mat(PAL.light.slab), desk: mat(PAL.light.desk), divider: mat(PAL.light.divider),
    chair: mat(PAL.light.chair), mat: mat(PAL.light.mat, { transparent: true, opacity: 0.55 }),
    skin: mat(0xf1d3b8), hair: mat(0x2a2f3a), dark: mat(0x232a35), white: mat(0xffffff), steel: mat(0xc9d1d8, { metalness: 0.3, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe4f2, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
    wood: mat(0xd8c6a3),
  };

  const world = new THREE.Group();
  scene.add(world);

  // ---- room ----------------------------------------------------------------
  const slab = box(12.4, 0.5, 12.4, M.slab, 0, -0.25, 0);
  const carpet = box(12, 0.1, 12, M.floor, 0, 0.05, 0);
  world.add(slab, carpet);
  const wallA = new THREE.Group();
  wallA.add(box(0.3, 4.2, 12.3, M.wall, -6.0, FY + 2.1, 0), box(0.46, 0.2, 12.46, M.trim, -6.0, FY + 4.25, 0));
  const wallB = new THREE.Group();
  wallB.add(box(12.3, 4.2, 0.3, M.wall, 0, FY + 2.1, -6.0), box(12.46, 0.2, 0.46, M.trim, 0, FY + 4.25, -6.0));
  world.add(wallA, wallB);
  const panelMat = mat(0xdfe5e0);
  for (let i = 0; i < 5; i++) {
    world.add(box(0.04, 3.4, 0.05, panelMat, -5.83, FY + 1.9, -1.6 + i * 2.1));
    world.add(box(0.05, 3.4, 0.04, panelMat, -4.2 + i * 2.1, FY + 1.9, -5.83));
  }
  // door frame and mail tray on wall A
  world.add(box(0.06, 2.8, 1.6, mat(0xc4cfc9), -5.83, FY + 1.4, 4.4));
  world.add(box(0.07, 2.65, 1.45, mat(0xe8eeea), -5.82, FY + 1.35, 4.4));
  const tray = new THREE.Group();
  for (let i = 0; i < 2; i++) tray.add(box(0.1, 0.5, 0.7, mat(0x9aa7b3), -5.78, FY + 2.2 - i * 0.7, -0.6));
  world.add(tray);
  world.add(box(0.05, 0.42, 0.5, mat(0x4f8cc9), -5.74, FY + 1.57, -0.6));

  // clock (wall A, faces +x)
  const clock = new THREE.Group();
  clock.position.set(-5.78, FY + 2.7, 2.1);
  clock.rotation.y = Math.PI / 2;
  const face = cyl(0.62, 0.62, 0.08, mat(0xf7f7f2), 0, 0, 0, 40);
  face.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 10, 40), M.dark);
  clock.add(face, rim);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = box(0.03, i % 3 === 0 ? 0.13 : 0.08, 0.02, M.dark, Math.sin(a) * 0.5, Math.cos(a) * 0.5, 0.05);
    tick.rotation.z = -a;
    clock.add(tick);
  }
  const hands = ['h', 'm', 's'].map((k, i) => {
    const g = new THREE.Group();
    const len = [0.28, 0.42, 0.46][i];
    const hand = box(i === 2 ? 0.012 : 0.03, len, 0.012, i === 2 ? mat(0xd23c3c) : M.dark, 0, len / 2 - 0.04, 0.07 + i * 0.01);
    hand.castShadow = false;
    g.add(hand);
    clock.add(g);
    return g;
  });
  world.add(clock);

  // security camera in the corner
  const cam = new THREE.Group();
  cam.position.set(-5.4, FY + 3.7, -2.35);
  cam.add(box(0.12, 0.26, 0.12, M.steel, 0, 0.15, 0));
  const camHead = new THREE.Group();
  camHead.add(sphere(0.2, M.white, 0, 0, 0), sphere(0.11, M.dark, 0.14, -0.02, 0));
  const led = sphere(0.03, new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 0.05, 0.14, 0.1);
  camHead.add(led);
  cam.add(camHead);
  world.add(cam);

  // wall display
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 768; wallCanvas.height = 384;
  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.anisotropy = 4;
  const wallScreen = new THREE.Group();
  wallScreen.position.set(0.4, FY + 2.6, -5.8);
  wallScreen.add(box(4.5, 2.4, 0.12, M.dark));
  const wallFace = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.15), new THREE.MeshBasicMaterial({ map: wallTex, toneMapped: false }));
  wallFace.position.z = 0.07;
  wallScreen.add(wallFace);
  world.add(wallScreen);
  let wallInfo = { title: 'Agent Office', lines: ['Loading…'] };
  function drawWall() {
    const c = wallCanvas.getContext('2d');
    const w = wallCanvas.width, h = wallCanvas.height;
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0f1c2b'); g.addColorStop(1, '#16293f');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7fd08a'; c.font = '600 30px ui-monospace, Menlo, monospace';
    c.fillText(wallInfo.title, 32, 56);
    c.fillStyle = '#cfe0f2'; c.font = '28px ui-monospace, Menlo, monospace';
    wallInfo.lines.slice(0, 5).forEach((l, i) => c.fillText(l, 32, 112 + i * 44));
    wallTex.needsUpdate = true;
  }
  drawWall();

  // kitchenette
  const counter = new THREE.Group();
  counter.position.set(4.7, FY, -5.2);
  counter.add(box(2.4, 1.0, 0.95, mat(0xf2f4f2), 0, 0.5, 0), box(2.5, 0.08, 1.05, mat(0xd7dde2), 0, 1.04, 0));
  const microwave = box(0.8, 0.5, 0.55, M.white, -0.55, 1.33, 0);
  counter.add(microwave, box(0.5, 0.34, 0.02, M.dark, -0.7, 1.33, 0.29));
  const mwLed = sphere(0.025, new THREE.MeshBasicMaterial({ color: 0x40e070 }), -0.3, 1.4, 0.29);
  counter.add(mwLed);
  counter.add(box(0.34, 0.5, 0.3, mat(0x384454), 0.55, 1.33, 0), box(0.22, 0.06, 0.2, M.steel, 0.55, 1.1, 0.12));
  const cupboard = box(2.4, 0.9, 0.5, mat(0xf2f4f2), 0, 2.9, -0.2);
  counter.add(cupboard);
  world.add(counter);

  // orchestrator glass office
  const office = new THREE.Group();
  office.add(box(3.5, 0.12, 3.5, M.wood, -4.25, FY + 0.06, -4.25));
  const gl = (w, d, x, z) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, 2.7, d), M.glass);
    g.position.set(x, FY + 1.47, z);
    return g;
  };
  office.add(gl(0.04, 3.5, -2.5, -4.25), gl(3.5, 0.04, -4.25, -2.5));
  const frameMat = mat(0x8aa0b8);
  for (const [x, z] of [[-2.5, -2.5], [-2.5, -6], [-6, -2.5]]) office.add(box(0.1, 2.8, 0.1, frameMat, x, FY + 1.52, z));
  office.add(box(0.08, 0.08, 3.6, frameMat, -2.5, FY + 2.88, -4.25), box(3.6, 0.08, 0.08, frameMat, -4.25, FY + 2.88, -2.5));
  world.add(office);

  // soft contact shadow under the floating slab
  const sh = document.createElement('canvas');
  sh.width = sh.height = 128;
  const sc = sh.getContext('2d');
  const rg = sc.createRadialGradient(64, 64, 6, 64, 64, 62);
  rg.addColorStop(0, 'rgba(10,20,30,.55)'); rg.addColorStop(1, 'rgba(10,20,30,0)');
  sc.fillStyle = rg; sc.fillRect(0, 0, 128, 128);
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -2.6;
  scene.add(shadowPlane);

  // ---- stations --------------------------------------------------------------
  const stations = {};
  const screens = [];

  function makeScreen(id, w, h, accent) {
    const cv = document.createElement('canvas');
    cv.width = 288; cv.height = Math.round(288 * (h / w));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screens.push({ id, cv, tex, accent, seed: Math.random() * 100, speed: 14 + Math.random() * 8 });
    return m;
  }

  function monitor(id, accent, x = 0, z = -0.28, ry = 0, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.scale.setScalar(scale);
    g.add(box(0.8, 0.64, 0.56, M.white, 0, 1.17, 0), box(0.26, 0.1, 0.3, M.white, 0, 0.87, 0.02), box(0.42, 0.04, 0.34, M.white, 0, 0.84, 0.02));
    const scr = makeScreen(id, 0.64, 0.46, accent);
    scr.position.set(0, 1.19, 0.285);
    g.add(scr);
    g.add(box(0.7, 0.02, 0.02, new THREE.MeshBasicMaterial({ color: accent }), 0, 0.93 + 0.005, 0.285));
    return g;
  }

  function buildStation(id, accent, wide) {
    const color = new THREE.Color(accent);
    const g = new THREE.Group();
    g.userData.agentId = id;
    g.position.set(...SPOTS[id]);
    const deskW = wide ? 2.7 : 2.2;

    // desk
    g.add(box(deskW, 0.1, 1.1, M.desk, 0, 0.8, 0));
    g.add(box(0.5, 0.75, 0.9, M.desk, -deskW / 2 + 0.3, 0.4, 0));
    g.add(box(0.08, 0.75, 0.9, M.desk, deskW / 2 - 0.1, 0.4, 0));
    const div = box(deskW + 0.1, 1.55, 0.08, M.divider, 0, 0.78, -0.62);
    g.add(div);
    g.add(box(deskW + 0.12, 0.05, 0.12, mat(0x24552d), 0, 1.57, -0.62));
    g.add(monitor(id, accent));
    if (wide) {
      g.add(monitor(id + '-l', accent, -0.95, -0.2, 0.55, 0.85));
      g.add(monitor(id + '-r', accent, 0.95, -0.2, -0.55, 0.85));
    }

    // keyboard with flickering keys
    const kbCv = document.createElement('canvas');
    kbCv.width = 160; kbCv.height = 64;
    const kbTex = new THREE.CanvasTexture(kbCv);
    kbTex.colorSpace = THREE.SRGBColorSpace;
    const kb = box(0.56, 0.04, 0.22, M.white, 0, 0.87, 0.27);
    const kbTop = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.19), new THREE.MeshBasicMaterial({ map: kbTex, toneMapped: false }));
    kbTop.rotation.x = -Math.PI / 2;
    kbTop.position.set(0, 0.892, 0.27);
    g.add(kb, kbTop);

    // mug + steam
    const mug = new THREE.Group();
    mug.position.set(deskW / 2 - 0.35, 0.85, 0.2);
    mug.add(cyl(0.065, 0.06, 0.12, mat(0x2d6cdf), 0, 0.06, 0));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), mat(0x2d6cdf));
    handle.position.set(0.07, 0.06, 0);
    mug.add(handle);
    const steam = [0, 1, 2].map((i) => {
      const s = sphere(0.025, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 0, 0.14, 0);
      s.castShadow = false;
      s.userData.phase = i / 3;
      mug.add(s);
      return s;
    });
    g.add(mug);

    // desk lamp
    const lamp = new THREE.Group();
    lamp.position.set(-deskW / 2 + 0.45, 0.85, -0.3);
    lamp.add(cyl(0.1, 0.12, 0.04, M.white, 0, 0.02, 0));
    const arm = box(0.03, 0.55, 0.03, M.white, 0, 0.3, 0);
    arm.rotation.z = -0.25;
    lamp.add(arm);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0b0, emissiveIntensity: 0.15, roughness: 0.5 });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.17, 18, 1, true), lampMat);
    shade.material.side = THREE.DoubleSide;
    shade.position.set(0.08, 0.62, 0.06);
    shade.rotation.x = 0.5;
    lamp.add(shade);
    const bulb = sphere(0.04, new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), 0.08, 0.58, 0.07);
    lamp.add(bulb);
    const pl = new THREE.PointLight(0xffe3a0, 0, 4.5, 2);
    pl.position.set(0.08, 0.55, 0.1);
    lamp.add(pl);
    lampLights.push(pl);
    g.add(lamp);

    // chair
    const chair = new THREE.Group();
    chair.position.set(0, 0, 0.62);
    chair.add(box(0.64, 0.1, 0.6, M.chair, 0, 0.5, 0));
    const back = box(0.62, 0.72, 0.09, M.chair, 0, 0.93, 0.3);
    back.rotation.x = -0.08;
    chair.add(back, cyl(0.04, 0.04, 0.4, M.dark, 0, 0.27, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = box(0.34, 0.03, 0.04, M.dark, Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17);
      spoke.rotation.y = -a;
      chair.add(spoke, sphere(0.04, M.dark, Math.cos(a) * 0.33, 0.04, Math.sin(a) * 0.33));
    }
    g.add(chair);
    const rug = box(1.7, 0.02, 1.5, M.mat, 0, 0.01, 0.55);
    rug.castShadow = false;
    g.add(rug);

    // figure (toy style, no face)
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0 });
    const fig = new THREE.Group();
    fig.position.set(0, 0.58, 0.58);
    const torso = capsule(0.2, 0.34, bodyMat);
    torso.position.set(0, 0.42, 0);
    torso.rotation.x = -0.1;
    fig.add(torso);
    const head = new THREE.Group();
    head.position.set(0, 0.95, -0.03);
    head.add(sphere(0.17, M.skin));
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), M.hair);
    hair.position.set(0, 0.01, 0.025);
    hair.castShadow = true;
    head.add(hair);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.016, 8, 24, Math.PI), M.dark);
    band.rotation.set(0, Math.PI / 2, 0);
    band.position.y = 0.03;
    head.add(band, sphere(0.045, M.dark, 0.18, 0, 0), sphere(0.045, M.dark, -0.18, 0, 0));
    fig.add(head);
    const arms = [-1, 1].map((s) => {
      const up = new THREE.Group();
      up.position.set(s * 0.27, 0.66, 0);
      const ua = capsule(0.065, 0.2, bodyMat);
      ua.position.y = -0.17;
      up.add(ua);
      const fore = new THREE.Group();
      fore.position.y = -0.34;
      const fa = capsule(0.055, 0.15, bodyMat);
      fa.position.y = -0.13;
      fore.add(fa, sphere(0.06, M.skin, 0, -0.27, 0));
      up.add(fore);
      fig.add(up);
      return { up, fore, s };
    });
    for (const s of [-1, 1]) {
      const th = capsule(0.09, 0.28, mat(0x39455a));
      th.rotation.x = Math.PI / 2;
      th.position.set(s * 0.12, 0.06, -0.25);
      const sh2 = capsule(0.075, 0.3, mat(0x39455a));
      sh2.position.set(s * 0.12, -0.2, -0.5);
      fig.add(th, sh2, box(0.14, 0.07, 0.24, M.dark, s * 0.12, -0.42, -0.55));
    }
    g.add(fig);

    // floor ring: active indicator
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.035, 0.1);
    ring.scale.set(1.55, 1.25, 1);
    g.add(ring);

    world.add(g);
    stations[id] = { group: g, id, arms, head, fig, chair, steam, lampMat, bulb, bodyMat, ring, kbCv, kbTex, phase: Math.random() * 6, state: 'waiting', hot: 0, keyBoost: 1 };
    return g;
  }
  for (const id of Object.keys(SPOTS)) buildStation(id, agents[id].color, id === 'orchestrator');

  // ---- documents in flight -----------------------------------------------------
  const docs = [];
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Group();
    d.add(box(0.36, 0.025, 0.46, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35 })));
    const stripe = box(0.36, 0.03, 0.08, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.005, -0.15);
    d.add(stripe);
    d.userData.stripe = stripe;
    d.visible = false;
    world.add(d);
    docs.push(d);
  }
  const bez = new THREE.Vector3();
  function placeDoc(d, from, to, p, color) {
    const a = new THREE.Vector3(...SPOTS[from]).add(new THREE.Vector3(0, 1.9, -0.1));
    const b = new THREE.Vector3(...SPOTS[to]).add(new THREE.Vector3(0, 1.9, -0.1));
    const c = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 1.8, 0));
    const t = ease(p);
    bez.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * (1 - t) * t).addScaledVector(b, t * t);
    d.position.copy(bez);
    d.rotation.set(Math.sin(p * 9) * 0.25, p * 6.5, Math.cos(p * 7) * 0.25);
    d.scale.setScalar(Math.sin(Math.min(1, p) * Math.PI) * 0.35 + 0.8);
    d.userData.stripe.material.color.set(color);
    d.visible = true;
  }
  let flights = [];

  // ---- interaction --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groups = Object.values(stations).map((s) => s.group);
  let hoverId = null, selectedId = null, down = null;

  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(groups, true);
    for (const h of hits) {
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

  // ---- camera ----------------------------------------------------------------------
  const homeTarget = new THREE.Vector3(0, 0.2, 0.4);
  let homeDist = 26;
  const want = { target: homeTarget.clone(), dist: null, settle: false };
  const viewOff = { x: 0, y: 0, tx: 0, ty: 0 };
  let W = 1, H = 1;

  function fitDistance(aspect) {
    const base = 33;
    return aspect >= 1.3 ? base : base * Math.min(2.4, Math.pow(1.3 / aspect, 0.75));
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 16 || h < 16) return; // hidden or not laid out yet; the observer fires again when it is
    W = w; H = h;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const oldHome = homeDist;
    homeDist = fitDistance(camera.aspect);
    if (!controls._init) {
      camera.position.copy(homeTarget).add(new THREE.Vector3(1, 0.82, 1).normalize().multiplyScalar(homeDist));
      controls.target.copy(homeTarget);
      controls._init = true;
    } else if (!selectedId) {
      const v = camera.position.clone().sub(controls.target);
      v.setLength(v.length() * (homeDist / oldHome));
      camera.position.copy(controls.target).add(v);
    }
    controls.minDistance = homeDist * 0.3;
    controls.maxDistance = homeDist * 1.25;
    applyViewOffset();
  }
  function applyViewOffset() {
    if (Math.abs(viewOff.x) < 0.5 && Math.abs(viewOff.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, viewOff.x, viewOff.y, W, H);
    camera.updateProjectionMatrix();
  }

  function focus(id, offset = { x: 0, y: 0 }) {
    selectedId = id;
    viewOff.tx = offset.x; viewOff.ty = offset.y;
    if (id) {
      want.target.set(...SPOTS[id]).add(new THREE.Vector3(0, 1.1, 0));
      want.dist = homeDist * 0.62;
    } else {
      want.target.copy(homeTarget);
      want.dist = homeDist;
    }
    want.settle = true;
  }

  // ---- theme -----------------------------------------------------------------------------
  let dark = false;
  function setTheme(isDark) {
    dark = isDark;
    const p = isDark ? PAL.dark : PAL.light;
    M.wall.color.set(p.wall); M.trim.color.set(p.trim); M.floor.color.set(p.floor); M.slab.color.set(p.slab);
    M.desk.color.set(p.desk); M.divider.color.set(p.divider); M.chair.color.set(p.chair); M.mat.color.set(p.mat);
    hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemi;
    sun.color.set(p.sunColor); sun.intensity = p.sun;
    shadowPlane.material.opacity = isDark ? 0.9 : 1;
    lampLights.forEach((l) => (l.intensity = p.lamps * 0.9));
  }

  // ---- screens & keyboards ------------------------------------------------------------------
  let screenClock = 0;
  function drawScreens(t) {
    for (const s of screens) {
      const key = s.id.replace(/-[lr]$/, '');
      const lines = SCREEN_LINES[key];
      const c = s.cv.getContext('2d');
      const w = s.cv.width, h = s.cv.height;
      c.fillStyle = dark ? '#06110c' : '#0b1a14';
      c.fillRect(0, 0, w, h);
      c.fillStyle = s.accent;
      c.fillRect(0, 0, w, 20);
      c.fillStyle = '#fff';
      c.font = '600 13px ui-monospace, Menlo, monospace';
      c.fillText('● ' + key, 8, 14);
      c.font = '14px ui-monospace, Menlo, monospace';
      const st = stations[key];
      const speed = st && st.state === 'working' ? 1.8 : 1;
      const off = (t * s.speed * speed + s.seed * 20) % 20;
      const first = Math.floor((t * s.speed * speed + s.seed * 20) / 20);
      for (let i = 0; i < 9; i++) {
        const idx = first + i;
        const line = lines[((idx % lines.length) + lines.length) % lines.length];
        const y = 40 + i * 20 - off;
        if (y < 24) continue;
        c.fillStyle = i % 3 === 0 ? '#9be7a6' : i % 3 === 1 ? '#cfe3ff' : '#ffe19a';
        c.fillText('> ' + line, 8, y);
      }
      if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = '#9be7a6'; c.fillRect(8, h - 16, 9, 12); }
      s.tex.needsUpdate = true;
    }
    const keys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
    for (const st of Object.values(stations)) {
      const c = st.kbCv.getContext('2d');
      c.fillStyle = '#e8edf2'; c.fillRect(0, 0, 160, 64);
      c.fillStyle = '#c3ccd5';
      for (let r = 0; r < 4; r++) for (let k = 0; k < 12; k++) c.fillRect(6 + k * 12.5, 6 + r * 14.5, 10, 11);
      c.fillStyle = '#' + new THREE.Color(agents[st.id].color).getHexString();
      const n = st.state === 'working' ? 4 : 2;
      for (let i = 0; i < n; i++) c.fillRect(6 + Math.floor(Math.random() * 12) * 12.5, 6 + Math.floor(Math.random() * 4) * 14.5, 10, 11);
      st.kbTex.needsUpdate = true;
    }
    void keys;
  }

  // ---- loop --------------------------------------------------------------------------------------
  let last = performance.now() / 1000, clockT = 0, onFrame = null, running = true;
  const tmp = new THREE.Vector3();
  const sph = new THREE.Spherical();
  const rel = new THREE.Vector3();

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    const t = now;
    const mo = reduceMotion ? 0.25 : 1;

    // diorama float
    const bob = Math.sin(t * 0.8) * 0.1 * mo;
    world.position.y = bob;
    shadowPlane.scale.setScalar(1 - bob * 0.25);

    // camera glide
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

    // clock
    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    hands[2].rotation.z = -(sec / 60) * Math.PI * 2;
    hands[1].rotation.z = -((d.getMinutes() + sec / 60) / 60) * Math.PI * 2;
    hands[0].rotation.z = -(((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;

    // security camera sweep + blinking leds
    camHead.rotation.y = Math.PI * 0.75 + Math.sin(t * 0.5) * 0.6 * mo;
    led.visible = Math.floor(t * 1.6) % 2 === 0;
    mwLed.visible = Math.floor(t * 0.9) % 3 !== 0;

    // stations
    for (const st of Object.values(stations)) {
      const working = st.state === 'working';
      const hotTarget = (hoverId === st.id || selectedId === st.id ? 1 : 0);
      st.hot += (hotTarget - st.hot) * Math.min(1, dt * 10);
      const sp = working ? 17 : 11;
      const lean = working ? 0.05 : 0;
      st.arms.forEach((a, i) => {
        const ph = t * sp + st.phase + i * 2.2;
        a.up.rotation.x = 1.0 + Math.sin(ph) * 0.07 + Math.sin(ph * 2.3) * 0.03;
        a.up.rotation.z = a.s * (0.12 + Math.sin(ph * 0.5) * 0.02);
        a.fore.rotation.x = -0.6 + Math.sin(ph + 1.2) * 0.2 + Math.max(0, Math.sin(ph * 1.7)) * 0.1;
      });
      st.head.rotation.x = 0.18 + Math.sin(t * 1.7 + st.phase) * 0.03 + Math.max(0, Math.sin(t * 0.4 + st.phase * 3)) * 0.05;
      st.head.rotation.y = Math.sin(t * 0.6 + st.phase) * 0.12;
      st.fig.rotation.x = lean + Math.sin(t * 1.2 + st.phase) * 0.012;
      st.fig.position.y = 0.58 + Math.sin(t * 2.1 + st.phase) * 0.004;
      st.chair.rotation.y = Math.sin(t * 0.45 + st.phase) * 0.08 * mo;
      st.steam.forEach((s) => {
        const p = (t * 0.35 + s.userData.phase) % 1;
        s.position.set(Math.sin(p * 7 + s.userData.phase * 9) * 0.03, 0.14 + p * 0.3, 0);
        s.material.opacity = (1 - p) * 0.5;
        s.scale.setScalar(0.6 + p * 1.4);
      });
      const glow = working ? 1.2 + Math.sin(t * 5) * 0.3 : dark ? 0.7 : 0.12;
      st.lampMat.emissiveIntensity = glow;
      st.bodyMat.emissiveIntensity = st.hot * 0.35 + (working ? 0.06 : 0);
      const ringOp = (working ? 0.55 + Math.sin(t * 4) * 0.2 : 0.0) + st.hot * 0.35;
      st.ring.material.opacity = Math.min(0.9, ringOp);
      st.ring.scale.set(1.55 + st.hot * 0.08 + (working ? Math.sin(t * 4) * 0.04 : 0), 1.25 + st.hot * 0.06, 1);
    }

    // documents
    docs.forEach((d) => (d.visible = false));
    flights.slice(0, docs.length).forEach((f, i) => placeDoc(docs[i], f.from, f.to, f.p, agents[f.from].color));

    // screens at ~12 fps
    screenClock += dt;
    clockT += dt;
    if (screenClock > 1 / 12) { screenClock = 0; drawScreens(clockT); }

    renderer.render(scene, camera);
    if (onFrame) onFrame(dt);
  }

  function projectLabel(id) {
    const p = new THREE.Vector3(...SPOTS[id]).add(tmp.set(0, LABEL_Y[id], 0));
    p.y += world.position.y;
    p.project(camera);
    const behind = p.z > 1;
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, behind };
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
    projectLabel,
    set onFrame(fn) { onFrame = fn; },
    get selected() { return selectedId; },
    dispose() { running = false; renderer.dispose(); },
    // exposed for tests
    _debug: { camera, controls, stations, docs },
  };
}
