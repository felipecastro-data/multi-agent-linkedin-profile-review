// Toy robots in a soft clay style: big rounded head with a screen face,
// small accent-coloured body, short legs. Same bone layout as a person
// (shoulder > upper > fore > hand) so arms can type with two-bone IK.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const std = (color, roughness = 0.45, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const rbox = (w, h, d, r, mat) => mesh(new RoundedBoxGeometry(w, h, d, 5, Math.min(r, w / 2, h / 2, d / 2)), mat);
const sph = (r, mat) => mesh(new THREE.SphereGeometry(r, 28, 20), mat);
function limb(r1, r2, len, mat) {
  const g = new THREE.CylinderGeometry(r2, r1, len, 24, 1);
  g.translate(0, -len / 2, 0);
  return mesh(g, mat);
}

const L1 = 0.19, L2 = 0.16, HAND = 0.045;
export const SEAT_HIPS = 0.565;   // hips height when seated on a chair (seat top 0.5)
export const STAND_HIPS = 0.485; // feet just touch the floor

/**
 * opts: { accent, antenna: 'ball'|'twin'|'dish'|'ears'|'visor', scale, tie }
 */
export function makeRobot(opts) {
  const accent = new THREE.Color(opts.accent);
  const M = {
    shell: std(0xf4f5f3, 0.38),
    joint: std(0xdfe4e8, 0.45),
    dark: std(0x2b3139, 0.35),
    body: std(accent.clone().lerp(new THREE.Color(0xffffff), 0.05), 0.42, { emissive: accent.clone(), emissiveIntensity: 0 }),
    accent: std(accent, 0.35),
    glow: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, roughness: 0.3 }),
    screen: std(0x0d151d, 0.15),
  };
  const root = new THREE.Group();
  const body = new THREE.Group();          // everything above the floor; scaled
  body.scale.setScalar(opts.scale || 1);
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = SEAT_HIPS;
  body.add(hips);
  hips.add(Object.assign(rbox(0.3, 0.12, 0.24, 0.06, M.joint), {}));

  const spine = new THREE.Group();
  spine.position.y = 0.06;
  hips.add(spine);
  const torso = rbox(0.36, 0.34, 0.28, 0.12, M.body);
  torso.position.y = 0.19;
  spine.add(torso);
  const belly = rbox(0.2, 0.12, 0.03, 0.03, M.shell);
  belly.position.set(0, 0.15, -0.135);
  spine.add(belly);
  const chestLight = mesh(new THREE.CircleGeometry(0.025, 24), M.glow, false);
  chestLight.position.set(0.09, 0.27, -0.142);
  chestLight.rotation.y = Math.PI;
  spine.add(chestLight);
  const backPack = rbox(0.22, 0.2, 0.06, 0.04, M.shell);
  backPack.position.set(0, 0.2, 0.15);
  spine.add(backPack);
  if (opts.tie) {
    const tie = rbox(0.05, 0.16, 0.015, 0.008, std(opts.tie, 0.4));
    tie.position.set(0, 0.25, -0.143);
    spine.add(tie);
    const collar = rbox(0.16, 0.04, 0.02, 0.01, M.shell);
    collar.position.set(0, 0.34, -0.13);
    spine.add(collar);
  }

  const neckG = new THREE.Group();
  neckG.position.y = 0.36;
  spine.add(neckG);
  const neck = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.06, 20), M.dark);
  neck.position.y = 0.02;
  neckG.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.22;
  neckG.add(head);
  head.add(rbox(0.44, 0.36, 0.38, 0.14, M.shell));
  const facePlate = rbox(0.36, 0.25, 0.03, 0.08, M.screen);
  facePlate.position.set(0, -0.005, -0.185);
  head.add(facePlate);
  const faceCv = document.createElement('canvas');
  faceCv.width = 256; faceCv.height = 176;
  const faceTex = new THREE.CanvasTexture(faceCv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.227), new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false, transparent: true }));
  face.position.set(0, -0.005, -0.2015);
  face.rotation.y = Math.PI;
  head.add(face);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 28), M.accent);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(s * 0.235, 0, 0.0);
    const cap = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), M.shell);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(s * 0.265, 0, 0);
    head.add(ear, cap);
  }
  const antennaBalls = [];
  const addAntenna = (x, h, tilt) => {
    const g = new THREE.Group();
    g.position.set(x, 0.18, 0.02);
    g.rotation.z = tilt;
    const rod = mesh(new THREE.CylinderGeometry(0.01, 0.012, h, 10), M.dark);
    rod.position.y = h / 2;
    const ball = sph(0.032, M.glow);
    ball.position.y = h + 0.02;
    g.add(rod, ball);
    head.add(g);
    antennaBalls.push(ball);
  };
  const kind = opts.antenna || 'ball';
  if (kind === 'ball') addAntenna(0, 0.11, 0);
  if (kind === 'twin') { addAntenna(-0.1, 0.09, 0.35); addAntenna(0.1, 0.09, -0.35); }
  if (kind === 'dish') {
    addAntenna(0.08, 0.07, -0.2);
    const dish = mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), M.shell);
    dish.material = std(0xf4f5f3, 0.38, { side: THREE.DoubleSide });
    dish.position.set(-0.08, 0.24, 0.02);
    dish.rotation.set(Math.PI, 0, 0.5);
    head.add(dish);
  }
  if (kind === 'visor') {
    const visor = rbox(0.4, 0.05, 0.12, 0.025, M.accent);
    visor.position.set(0, 0.17, -0.12);
    head.add(visor);
    addAntenna(0.14, 0.06, -0.2);
  }
  if (kind === 'ears') {
    for (const s of [-1, 1]) {
      const e = rbox(0.08, 0.1, 0.05, 0.025, M.accent);
      e.position.set(s * 0.13, 0.2, 0.02);
      e.rotation.z = -s * 0.3;
      head.add(e);
    }
  }

  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.215, 0.3, 0);
    spine.add(shoulder);
    shoulder.add(sph(0.068, M.joint));
    const upper = new THREE.Group();
    shoulder.add(upper);
    upper.add(limb(0.055, 0.05, L1, M.shell));
    const elbow = sph(0.052, M.joint);
    elbow.position.y = -L1;
    upper.add(elbow);
    const fore = new THREE.Group();
    fore.position.y = -L1;
    upper.add(fore);
    fore.add(limb(0.05, 0.046, L2, M.shell));
    const hand = new THREE.Group();
    hand.position.y = -L2;
    fore.add(hand);
    const palm = rbox(0.075, 0.07, 0.045, 0.022, M.accent);
    palm.position.y = -0.03;
    hand.add(palm);
    const fingers = [-0.02, 0.02].map((fx) => {
      const f = new THREE.Group();
      f.position.set(fx, -0.062, 0);
      const seg = mesh(new THREE.CapsuleGeometry(0.014, 0.025, 4, 10), M.accent);
      seg.position.y = -0.02;
      f.add(seg);
      hand.add(f);
      return f;
    });
    return { s, shoulder, upper, fore, hand, fingers };
  });

  const legs = [-1, 1].map((s) => {
    const thigh = new THREE.Group();
    thigh.position.set(s * 0.085, -0.04, 0);
    hips.add(thigh);
    thigh.add(limb(0.062, 0.056, 0.2, M.joint));
    const knee = sph(0.056, M.joint);
    knee.position.y = -0.2;
    thigh.add(knee);
    const shin = new THREE.Group();
    shin.position.y = -0.2;
    thigh.add(shin);
    shin.add(limb(0.055, 0.06, 0.18, M.shell));
    const foot = rbox(0.12, 0.07, 0.19, 0.035, M.accent);
    foot.position.set(0, -0.21, -0.03);
    shin.add(foot);
    return { thigh, shin, foot };
  });

  // sit: 1 seated, 0 standing. phase/amp drive the walk cycle while standing:
  // legs swing in opposition, the knee bends on the forward swing, hips dip
  // when the legs are apart and roll/twist over the stance leg.
  let sit = 1;
  function setGait(v, phase = 0, amp = 0) {
    sit = v;
    const a = amp * (1 - v);
    let dip = 0;
    legs.forEach((l, i) => {
      const p = phase + (i ? Math.PI : 0);
      const swing = Math.sin(p) * 0.42 * a;
      const knee = -Math.max(0, Math.cos(p)) * 0.8 * a;
      l.thigh.rotation.x = THREE.MathUtils.lerp(swing, 1.5, v);
      l.shin.rotation.x = THREE.MathUtils.lerp(knee, -1.45, v);
      dip = Math.max(dip, 0.4 * (1 - Math.cos(swing)));
    });
    hips.position.y = THREE.MathUtils.lerp(STAND_HIPS - dip - Math.abs(Math.sin(phase)) * 0.012 * a, SEAT_HIPS, v);
    hips.rotation.z = Math.sin(phase) * 0.05 * a;
    hips.rotation.y = Math.sin(phase) * 0.08 * a;
    spine.rotation.y = -Math.sin(phase) * 0.1 * a;
    return a ? Math.sin(phase) : 0; // swing signal for the arms
  }
  const setSit = (v) => setGait(v, 0, 0);
  setSit(1);

  const tmp = new THREE.Vector3();
  function reach(arm, worldTarget, wristBend = -0.1) {
    arm.shoulder.updateWorldMatrix(true, false);
    tmp.copy(worldTarget);
    arm.shoulder.worldToLocal(tmp);
    const dy = tmp.y, dz = tmp.z;
    const L2r = L2 + HAND;
    const d = Math.min(Math.hypot(dy, dz), L1 + L2r - 0.003);
    const aT = Math.atan2(-dz, -dy);
    const alpha = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2r * L2r) / (2 * L1 * d), -1, 1));
    const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2r * L2r - d * d) / (2 * L1 * L2r), -1, 1));
    arm.upper.rotation.x = aT - alpha;
    arm.fore.rotation.x = Math.PI - beta;
    arm.hand.rotation.x = Math.PI / 2 - (arm.upper.rotation.x + arm.fore.rotation.x) + wristBend;
  }
  function setArm(arm, a1, a2, a3 = 0) {
    arm.upper.rotation.x = a1;
    arm.fore.rotation.x = a2;
    arm.hand.rotation.x = a3;
  }

  // ---- face ---------------------------------------------------------------------------
  const eyeColor = '#8af1ff';
  let blinkAt = 1 + Math.random() * 3;
  let lastMode = '', lastDraw = 0;
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
    c.fill();
  }
  function drawFace(mode, t) {
    if (mode === lastMode && t - lastDraw < 1 / 12) return;
    lastMode = mode; lastDraw = t;
    const c = faceCv.getContext('2d');
    c.clearRect(0, 0, 256, 176);
    c.fillStyle = '#0b141c';
    rr(c, 0, 0, 256, 176, 42);
    c.fillStyle = eyeColor;
    c.strokeStyle = eyeColor;
    c.lineCap = 'round';
    const blinking = t > blinkAt && t < blinkAt + 0.12;
    if (t > blinkAt + 0.12) blinkAt = t + 2 + Math.random() * 4;
    const ex = [86, 170];
    if (mode === 'done' || mode === 'coffee') {
      c.lineWidth = 12;
      ex.forEach((x) => { c.beginPath(); c.arc(x, 82, 20, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); });
      c.lineWidth = 9;
      c.beginPath(); c.arc(128, 104, 26, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      c.fillStyle = 'rgba(255,140,170,.55)';
      [58, 198].forEach((x) => { c.beginPath(); c.ellipse(x, 112, 16, 9, 0, 0, Math.PI * 2); c.fill(); });
    } else if (mode === 'wait') {
      c.lineWidth = 10;
      ex.forEach((x) => { c.beginPath(); c.moveTo(x - 20, 80); c.lineTo(x + 20, 80); c.stroke(); });
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - i * 0.8));
        c.beginPath(); c.arc(104 + i * 24, 128, 7, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    } else {
      const look = mode === 'work' ? 12 : 0;
      const h = blinking ? 6 : 44;
      ex.forEach((x) => rr(c, x - 17, 72 + look - h / 2, 34, h, 15));
      if (mode === 'talk') {
        const open = 6 + Math.abs(Math.sin(t * 11)) * 16;
        c.beginPath(); c.ellipse(128, 132, 18, open / 2, 0, 0, Math.PI * 2); c.fill();
      } else {
        c.lineWidth = 8;
        c.beginPath(); c.moveTo(114, 134); c.lineTo(142, 134); c.stroke();
      }
    }
    faceTex.needsUpdate = true;
  }
  drawFace('wait', 0);

  return {
    root, body, hips, spine, head, neckG, arms, legs, antennaBalls,
    torso, bodyMat: M.body, glowMat: M.glow,
    reach, setArm, setSit, setGait, drawFace, get sit() { return sit; },
  };
}
