// Stylised human figures: seated typists and a standing manager.
// Built from smooth primitives on a small bone hierarchy so arms can be
// placed with two-bone IK (hands on the keyboard) and fingers can tap.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const std = (color, roughness = 0.65, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const sph = (r, mat, sx = 1, sy = 1, sz = 1) => {
  const m = mesh(new THREE.SphereGeometry(r, 28, 20), mat);
  m.scale.set(sx, sy, sz);
  return m;
};
const rbox = (w, h, d, r, mat) => mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);

// A limb segment hanging along -y from its group origin.
function limb(r1, r2, len, mat) {
  const g = new THREE.CylinderGeometry(r2, r1, len, 22, 1);
  g.translate(0, -len / 2, 0);
  return mesh(g, mat);
}

function torsoGeometry() {
  const pts = [
    [0.0, 0], [0.15, 0], [0.163, 0.06], [0.168, 0.18], [0.18, 0.3],
    [0.19, 0.38], [0.186, 0.44], [0.165, 0.485], [0.115, 0.515], [0.06, 0.53], [0.0, 0.535],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 40);
  g.scale(1.22, 1, 0.78);
  g.computeVertexNormals();
  return g;
}
const TORSO = torsoGeometry();

function printTexture(letter, accent) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = accent;
  x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#ffffff';
  x.font = '700 64px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildHair(style, mat, head) {
  const cap = mesh(new THREE.SphereGeometry(0.153, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), mat);
  cap.rotation.x = 0.52;
  cap.scale.set(0.96, 1.06, 1.02);
  head.add(cap);
  if (style === 'long') {
    const back = sph(0.15, mat, 1.0, 1.55, 0.55);
    back.position.set(0, -0.11, 0.075);
    head.add(back);
  } else if (style === 'bun') {
    const bun = sph(0.066, mat);
    bun.position.set(0, 0.13, 0.085);
    head.add(bun);
  } else if (style === 'ponytail') {
    const tie = new THREE.Group();
    tie.position.set(0, 0.05, 0.14);
    tie.rotation.x = 0.5;
    const tail = mesh(new THREE.CapsuleGeometry(0.04, 0.14, 8, 16), mat);
    tail.position.y = -0.1;
    tie.add(tail);
    head.add(tie);
  } else if (style === 'curly') {
    let s = 7;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 22; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = 0.15 + rnd() * 1.05;
      const b = sph(0.045 + rnd() * 0.012, mat);
      b.position.set(Math.sin(ph) * Math.cos(th) * 0.15, Math.cos(ph) * 0.15 + 0.01, Math.sin(ph) * Math.sin(th) * 0.15 + 0.02);
      if (b.position.z < -0.09 && b.position.y < 0.08) continue; // keep the forehead clear
      head.add(b);
    }
  } else if (style === 'side') {
    const fringe = sph(0.09, mat, 1.4, 0.55, 0.8);
    fringe.position.set(0.04, 0.1, -0.08);
    fringe.rotation.z = -0.3;
    head.add(fringe);
  }
}

/**
 * opts: { pose: 'sit'|'stand', skin, hair, hairStyle, top, pants, shoes, accent, letter, headphones, blazer }
 */
export function makePerson(opts) {
  const M = {
    skin: std(opts.skin, 0.55),
    skinDark: std(new THREE.Color(opts.skin).multiplyScalar(0.88), 0.55),
    hair: std(opts.hair, 0.8),
    top: std(opts.top, 0.85),
    topDark: std(new THREE.Color(opts.top).multiplyScalar(0.78), 0.85),
    pants: std(opts.pants, 0.8),
    shoe: std(opts.shoes || 0x24272e, 0.55),
    sole: std(0xf2f2ef, 0.6),
    eye: std(0x1d2026, 0.3),
    lip: std(0xa4575a, 0.6),
    dark: std(0x2a2e36, 0.45),
  };
  const sitting = opts.pose === 'sit';
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = sitting ? 0.1 : 0.985;
  root.add(hips);

  const pelvis = sph(0.17, M.pants, 1.14, 0.62, 0.86);
  hips.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  const torso = mesh(TORSO, opts.blazer ? std(opts.blazer, 0.7) : M.top);
  spine.add(torso);
  const hem = mesh(new THREE.TorusGeometry(0.157, 0.02, 10, 40), M.topDark);
  hem.rotation.x = Math.PI / 2;
  hem.scale.set(1.22, 0.78, 1);
  hem.position.y = 0.02;
  spine.add(hem);
  const collar = mesh(new THREE.TorusGeometry(0.068, 0.022, 10, 28), opts.blazer ? std(0xf4f4f0, 0.6) : M.topDark);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.515;
  spine.add(collar);
  if (opts.letter) {
    const print = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshStandardMaterial({ map: printTexture(opts.letter, opts.accent), transparent: true, roughness: 0.8 }));
    print.position.set(0, 0.31, 0.149);
    spine.add(print);
  }
  if (opts.blazer) {
    // shirt placket and lapels on the front
    const shirt = rbox(0.09, 0.3, 0.02, 0.008, std(0xf4f4f0, 0.6));
    shirt.position.set(0, 0.36, -0.142);
    shirt.rotation.x = 0.12;
    spine.add(shirt);
    const tie = rbox(0.035, 0.22, 0.012, 0.005, std(opts.accent, 0.5));
    tie.position.set(0, 0.36, -0.153);
    tie.rotation.x = 0.12;
    spine.add(tie);
  }

  const neckG = new THREE.Group();
  neckG.position.y = 0.5;
  spine.add(neckG);
  const neck = limb(0.05, 0.052, 0.11, M.skin);
  neck.position.y = 0.1;
  neckG.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.18;
  neckG.add(head);
  head.add(sph(0.14, M.skin, 0.92, 1.06, 0.98));
  const jaw = sph(0.1, M.skin, 1.0, 0.8, 1.0);
  jaw.position.set(0, -0.07, -0.03);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const ear = sph(0.032, M.skinDark, 0.55, 1, 0.8);
    ear.position.set(s * 0.13, -0.005, 0.0);
    head.add(ear);
  }
  // face (front is -z)
  const eyes = [-1, 1].map((s) => {
    const e = sph(0.017, M.eye, 1, 1.15, 0.6);
    e.position.set(s * 0.047, 0.012, -0.13);
    e.castShadow = false;
    head.add(e);
    const brow = rbox(0.046, 0.011, 0.012, 0.005, M.hair);
    brow.position.set(s * 0.048, 0.05, -0.128);
    brow.rotation.z = s * -0.08;
    head.add(brow);
    return e;
  });
  const nose = sph(0.021, M.skinDark, 0.9, 1.1, 1);
  nose.position.set(0, -0.022, -0.14);
  head.add(nose);
  const mouth = rbox(0.048, 0.01, 0.01, 0.004, M.lip);
  mouth.position.set(0, -0.072, -0.122);
  head.add(mouth);
  buildHair(opts.hairStyle, M.hair, head);
  if (opts.headphones) {
    const hp = std(0x22262d, 0.4);
    const band = mesh(new THREE.TorusGeometry(0.165, 0.013, 10, 32, Math.PI), hp);
    band.position.y = 0.01;
    head.add(band);
    for (const s of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 26), hp);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * 0.158, 0.0, 0.0);
      head.add(cup);
      const ring = mesh(new THREE.TorusGeometry(0.04, 0.008, 8, 24), std(opts.accent, 0.4));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(s * 0.18, 0, 0);
      head.add(ring);
    }
  }

  // arms: shoulder (yaw) > upper (pitch) > fore (pitch) > hand (pitch) > fingers
  const L1 = 0.27, L2 = 0.24;
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.205, 0.43, 0);
    spine.add(shoulder);
    shoulder.add(sph(0.074, opts.blazer ? torso.material : M.top));
    const upper = new THREE.Group();
    shoulder.add(upper);
    const sleeveMat = opts.blazer ? torso.material : M.top;
    upper.add(limb(0.063, 0.054, L1, sleeveMat));
    const elbow = sph(0.055, sleeveMat);
    elbow.position.y = -L1;
    upper.add(elbow);
    const fore = new THREE.Group();
    fore.position.y = -L1;
    upper.add(fore);
    fore.add(limb(0.053, 0.044, L2 - 0.02, sleeveMat));
    const cuff = mesh(new THREE.TorusGeometry(0.044, 0.012, 8, 22), opts.blazer ? std(0xf4f4f0, 0.6) : M.topDark);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -(L2 - 0.03);
    fore.add(cuff);
    const hand = new THREE.Group();
    hand.position.y = -L2;
    fore.add(hand);
    const palm = rbox(0.072, 0.082, 0.03, 0.012, M.skin);
    palm.position.y = -0.042;
    hand.add(palm);
    const fingers = [-0.026, -0.009, 0.009, 0.026].map((fx, i) => {
      const f = new THREE.Group();
      f.position.set(fx, -0.082, 0);
      const len = [0.034, 0.042, 0.04, 0.032][i];
      const seg = mesh(new THREE.CapsuleGeometry(0.0095, len, 4, 10), M.skin);
      seg.position.y = -len / 2;
      f.add(seg);
      hand.add(f);
      return f;
    });
    const thumb = new THREE.Group();
    thumb.position.set(-s * 0.036, -0.035, -0.006);
    thumb.rotation.z = -s * 0.7;
    const th = mesh(new THREE.CapsuleGeometry(0.011, 0.034, 4, 10), M.skin);
    th.position.y = -0.024;
    thumb.add(th);
    hand.add(thumb);
    return { s, shoulder, upper, fore, hand, fingers };
  });

  // legs: thigh > shin > foot
  const legs = [-1, 1].map((s) => {
    const thigh = new THREE.Group();
    thigh.position.set(s * 0.095, -0.02, 0);
    hips.add(thigh);
    thigh.add(limb(0.089, 0.07, 0.44, M.pants));
    const knee = sph(0.071, M.pants);
    knee.position.y = -0.44;
    thigh.add(knee);
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    thigh.add(shin);
    shin.add(limb(0.066, 0.052, 0.45, M.pants));
    const foot = new THREE.Group();
    foot.position.y = -0.47;
    shin.add(foot);
    const shoe = rbox(0.105, 0.085, 0.25, 0.04, M.shoe);
    shoe.position.set(0, 0.0, -0.065);
    const sole = rbox(0.112, 0.03, 0.262, 0.012, M.sole);
    sole.position.set(0, -0.045, -0.065);
    foot.add(shoe, sole);
    if (sitting) { thigh.rotation.x = 1.5; shin.rotation.x = -1.42; }
    return { thigh, shin, foot };
  });

  // ---- animation helpers -------------------------------------------------------
  const tmp = new THREE.Vector3();
  function reach(arm, worldTarget, wristBend = -0.12) {
    arm.shoulder.updateWorldMatrix(true, false);
    tmp.copy(worldTarget);
    arm.shoulder.worldToLocal(tmp);
    const dy = tmp.y, dz = tmp.z;
    let d = Math.hypot(dy, dz);
    const L2r = L2 + 0.045;
    d = Math.min(d, L1 + L2r - 0.005);
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

  let blinkAt = 1 + Math.random() * 3;
  function blink(t) {
    const open = t < blinkAt || t > blinkAt + 0.12;
    eyes.forEach((e) => (e.scale.y = open ? 1.15 : 0.15));
    if (t > blinkAt + 0.12) blinkAt = t + 2 + Math.random() * 4;
  }

  return { root, hips, spine, head, neckG, arms, legs, reach, setArm, blink, materials: M, torso };
}
