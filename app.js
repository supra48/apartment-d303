import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import CTX from './context.js';
import { buildCity, facadeTexture } from './city.js';

/* ------------------------------------------------------------------ *
 *  Apartment Δ303 — the floor plan is the model.
 *  Every coordinate below is read off the architect's sheet in pixels
 *  (85.2 px = 1 m, checked against the 9.33 / 8.67 / 6.28 / 5.54 dims)
 *  and converted to metres by X() / Z().
 * ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

const S = 85.2, OX = 40, OY = 640;
const X = p => (p - OX) / S;
const Z = p => (p - OY) / S;

const H = 2.75;          // clear ceiling height
const EYE = 1.6;
const CUT = 1.2;         // a plan is the building cut at 1.2 m
const W_OUT = X(835);    // 9.33 outer width
const Z_SOUTH = Z(1690); // outer face of the south wall
const Z_VER = Z_SOUTH + 2.99;
const PY_VER = OY + Z_VER * S;
const C = new THREE.Vector3(W_OUT / 2, 0, Z_VER / 2);
const coarse = matchMedia('(pointer: coarse)').matches;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('nogl').hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;

const PAPER = new THREE.Color('#f3f0e8');
const INK = new THREE.Color('#1c1c1a');
const PLASTER = new THREE.Color('#eeeae3');
const HORIZON = new THREE.Color('#e6e2d8');
renderer.setClearColor(PAPER);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 60, 320);
const camera = new THREE.PerspectiveCamera(2, innerWidth / innerHeight, 1, 3000);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

scene.add(new THREE.HemisphereLight('#f1f4f7', '#ddd3c4', 1.45));
const sun = new THREE.DirectionalLight('#ffe6c7', 2.7);
{
  const el = 32 * Math.PI / 180;
  sun.position.copy(C).add(new THREE.Vector3(CTX.sun[0] * Math.cos(el), Math.sin(el), CTX.sun[1] * Math.cos(el)).multiplyScalar(24));
}
sun.target.position.copy(C);
sun.castShadow = true;
sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);

/* the section plane: everything above it is cut away */
const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT);
const CLIP = [cut];

/* ---------------- textures (CC0, Poly Haven) ---------------- */
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function tex(name, kind) {
  const t = loader.load(`tex/${name}/${kind}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const LINEN = tex('rough_linen', 'nor');
function tileTexture(base, grout, n = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = grout; g.fillRect(0, 0, 256, 256);
  const s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = 0.94 + Math.random() * 0.06;
    const c = new THREE.Color(base).multiplyScalar(k);
    g.fillStyle = '#' + c.getHexString();
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

/* ---------------- materials ---------------- */
const paperMats = [];
function mat(p, { paper = true, clipped = true } = {}) {
  const m = new THREE.MeshStandardMaterial(p);
  if (clipped) { m.clippingPlanes = CLIP; m.clipShadows = true; }
  if (paper) { m.emissive = PAPER.clone(); m.emissiveIntensity = 1; m.userData.base = m.color.clone(); paperMats.push(m); }
  return m;
}
const solid = { side: THREE.DoubleSide, shadowSide: THREE.BackSide };
const M = {
  wall: mat({ color: INK.clone(), roughness: 0.95, ...solid }, { paper: false }),
  sill: mat({ color: '#e4dfd6', roughness: 0.45, ...solid }),
  frame: mat({ color: '#3b3d40', roughness: 0.4, metalness: 0.6, ...solid }),
  glass: mat({ color: '#d4e6ec', roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }, { paper: false }),
  door: mat({ color: '#f2f0eb', roughness: 0.55, ...solid }),
  metal: mat({ color: '#a4a7ab', roughness: 0.3, metalness: 0.9, ...solid }),
  black: mat({ color: '#141414', roughness: 0.35, ...solid }),
  oak: mat({ map: tex('oak_wood_planks', 'diff'), normalMap: tex('oak_wood_planks', 'nor'), color: new THREE.Color(1.12, 1.05, 0.96), roughness: 0.72 }),
  walnut: mat({ map: tex('natural_walnut_veneer', 'diff'), normalMap: tex('natural_walnut_veneer', 'nor'), roughness: 0.55, ...solid }),
  marble: mat({ map: tex('marble_01', 'diff'), normalMap: tex('marble_01', 'nor'), roughness: 0.22, ...solid }),
  tiles: mat({ map: tileTexture('#f1f0ec', '#d4d1ca', 2), roughness: 0.2, ...solid }),
  bathFloor: mat({ map: tileTexture('#cfcac2', '#b2aca3', 1), roughness: 0.35 }),
  linen: mat({ normalMap: LINEN, color: '#f4f1ea', roughness: 0.95, ...solid }),
  sofa: mat({ normalMap: LINEN, color: '#9c968c', roughness: 1, ...solid }),
  headboard: mat({ normalMap: LINEN, color: '#b9a88f', roughness: 1, ...solid }),
  duvetA: mat({ normalMap: LINEN, color: '#a3ae98', roughness: 1, ...solid }),
  duvetB: mat({ normalMap: LINEN, color: '#cfa985', roughness: 1, ...solid }),
  duvetC: mat({ normalMap: LINEN, color: '#e6e0d5', roughness: 1, ...solid }),
  curtain: mat({ normalMap: LINEN, color: '#f1ede4', roughness: 1, ...solid }),
  lacquer: mat({ color: '#f1efea', roughness: 0.42, ...solid }),
  cabinet: mat({ color: '#e5dfd3', roughness: 0.5, ...solid }),
  ceramic: mat({ color: '#fbfbf9', roughness: 0.12, ...solid }),
  rug: mat({ normalMap: LINEN, color: '#cdbfa8', roughness: 1 }),
  rug2: mat({ normalMap: LINEN, color: '#b7ad9c', roughness: 1 }),
  leaf: mat({ color: '#56704a', roughness: 0.85, flatShading: true, ...solid }),
  pot: mat({ color: '#b9a68f', roughness: 0.9, ...solid }),
  screen: mat({ color: '#0d0f12', roughness: 0.12, metalness: 0.3, ...solid }),
  mirror: mat({ color: '#dfe6ea', roughness: 0.02, metalness: 1, ...solid }, { paper: false }),
  art1: mat({ color: '#c46a45', roughness: 0.9, ...solid }),
  art2: mat({ color: '#2f4858', roughness: 0.9, ...solid }),
  art3: mat({ color: '#d9c7a3', roughness: 0.9, ...solid }),
  vtile: mat({ map: tileTexture('#d8d1c4', '#b9b1a3'), roughness: 0.8 }),
  ceil: mat({ color: '#f8f6f2', roughness: 1 }, { paper: false }),
  glow: new THREE.MeshBasicMaterial({ color: '#fff4dc', clippingPlanes: CLIP, toneMapped: false }),
  site: mat({ color: '#e7e3dc', roughness: 0.95 }),
  facade: mat({ map: facadeTexture(), color: '#f1ece3', roughness: 0.92 }),
  city: new THREE.MeshStandardMaterial({ roughness: 1 }),
  tree: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
  ground: new THREE.MeshStandardMaterial({ color: '#c9bea6', roughness: 1, transparent: true, opacity: 0 }),
};
M.screen.emissive = new THREE.Color('#0a1420'); // not paper: a TV reads dark even on the drawing
const inkMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, clippingPlanes: CLIP });
const inkFaint = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.35 });

/* ---------------- groups ---------------- */
const G = {
  building: new THREE.Group(), furniture: new THREE.Group(), ink: new THREE.Group(),
  labels: new THREE.Group(), site: new THREE.Group(),
};
Object.values(G).forEach(g => scene.add(g));

const obstacles = [];  // xz boxes the walker cannot enter
const mapRects = [];   // for the mini map
const inkLines = [];
const floors = [];
const labelMats = [];
const capRects = [];

/* ---------------- geometry helpers ---------------- */
function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile);
    }
  }
  return g;
}
function block(x1, z1, x2, z2) {
  obstacles.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2) });
}
function box(parent, x1, z1, x2, z2, y1, y2, m, o = {}) {
  const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1), h = y2 - y1;
  const g = boxGeo(w, h, d, o.tile);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  mesh.castShadow = o.cast !== false;
  mesh.receiveShadow = true;
  if (o.edges) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), inkMat);
    mesh.add(e); inkLines.push(e);
  }
  if (o.block) block(x1, z1, x2, z2);
  parent.add(mesh);
  return mesh;
}
const F = (px1, py1, px2, py2, y1, y2, m, o = {}) =>
  box(G.furniture, X(px1), Z(py1), X(px2), Z(py2), y1, y2, m, { edges: true, ...o });

function cyl(parent, x, z, r, y1, y2, m, o = {}) {
  const g = new THREE.CylinderGeometry(o.r2 ?? r, r, y2 - y1, o.seg || 28);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, (y1 + y2) / 2, z);
  mesh.castShadow = o.cast !== false;
  mesh.receiveShadow = true;
  if (o.edges !== false) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), inkMat);
    mesh.add(e); inkLines.push(e);
  }
  if (o.block) block(x - r, z - r, x + r, z + r);
  parent.add(mesh);
  return mesh;
}
const Fc = (px, py, r, y1, y2, m, o) => cyl(G.furniture, X(px), Z(py), r, y1, y2, m, o);

function plane(px1, py1, px2, py2, y, m, { tile = 0, down = false, parent = G.building, isFloor = true } = {}) {
  const w = (px2 - px1) / S, d = (py2 - py1) / S;
  const g = new THREE.PlaneGeometry(w, d);
  if (tile) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  }
  const p = new THREE.Mesh(g, m);
  p.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
  p.position.set(X((px1 + px2) / 2), y, Z((py1 + py2) / 2));
  p.receiveShadow = !down;
  p.castShadow = down;
  parent.add(p);
  if (!down && isFloor) floors.push(p);
  return p;
}

/* ---------------- walls ---------------- */
const win = (a, b, sill = 0.9, head = 2.2) => ({ a, b, kind: 'win', sill, head });
const door = (a, b, head = 2.1) => ({ a, b, kind: 'door', head });
const passage = (a, b) => ({ a, b, kind: 'open', head: H });
const slide = (a, b) => ({ a, b, kind: 'slide', head: 2.45 });

const WALLS = [
  // orientation, centre line, from, to, thickness (all px), openings
  ['h', 654, 40, 835, 28, [win(128.6, 264.9), win(472.8, 523.9, 1.5), win(608.3, 744.6)]],   // north: 1.04 | 1.60 | 2.44 | .60 | .99 | 1.60 | 1.07
  ['h', 1676, 40, 835, 28, [slide(148, 428), slide(530, 785)]],                              // south: glass to the veranda
  ['v', 54, 668, 1662, 28, [win(985, 1120), win(1245, 1335, 1.0), win(1560, 1640)]],         // west
  ['v', 821, 668, 1662, 28, [win(770, 960), win(1040, 1095, 1.5), door(1238, 1323, 2.15)]],  // east + front door
  ['h', 1190, 68, 807, 10, [passage(385, 482)]],   // bedrooms | living
  ['h', 928, 68, 383, 10, []],                     // bedroom 2 | bedroom 3
  ['v', 388, 668, 1190, 10, [door(840, 913), door(943, 1015)]],
  ['h', 850, 383, 553, 10, [door(398, 472)]],      // shower room
  ['v', 548, 668, 925, 10, []],
  ['h', 920, 477, 553, 10, []],                    // laundry niche
  ['v', 482, 915, 1190, 10, [door(925, 1003)]],    // master bedroom door
  ['v', 680, 1007, 1190, 10, []],                  // en-suite
  ['h', 1012, 675, 807, 10, [door(692, 770)]],
  ['v', 821, 1690, PY_VER, 28, []],                // veranda side wall
];

function buildWalls() {
  for (const [o, at, from, to, t, ops] of WALLS) {
    let cur = from;
    const pieces = [];
    for (const op of [...ops].sort((p, q) => p.a - q.a)) {
      if (op.a > cur) pieces.push({ a: cur, b: op.a, kind: 'solid' });
      pieces.push(op);
      cur = op.b;
    }
    if (cur < to) pieces.push({ a: cur, b: to, kind: 'solid' });
    for (const p of pieces) wallPiece(o, at, t, p);
  }
}

function wallPiece(o, at, t, s) {
  const along = o === 'h' ? X : Z, across = o === 'h' ? Z : X;
  const A = along(s.a), B = along(s.b), P = across(at), T = t / S;
  const sb = (a, b, dep, y1, y2, m, opt, off = 0) => o === 'h'
    ? box(G.building, a, P + off - dep / 2, b, P + off + dep / 2, y1, y2, m, opt)
    : box(G.building, P + off - dep / 2, a, P + off + dep / 2, b, y1, y2, m, opt);
  const rect = (a, b) => (o === 'h' ? [a, P - T / 2, b, P + T / 2] : [P - T / 2, a, P + T / 2, b]);

  if (s.kind === 'solid') {
    sb(A, B, T, 0, H, M.wall);
    capRects.push(rect(A, B));
    block(...rect(A, B));
    mapRects.push({ r: rect(A, B), k: 'wall' });
    return;
  }
  if (s.head < H) sb(A, B, T, s.head, H, M.wall);
  if (s.kind === 'win') {
    sb(A, B, T, 0, s.sill - 0.04, M.wall);
    sb(A, B, T + 0.05, s.sill - 0.04, s.sill, M.sill, { edges: true });
    const f = 0.05, d = 0.07, op = { cast: false, edges: true };
    sb(A, A + f, d, s.sill, s.head, M.frame, op);
    sb(B - f, B, d, s.sill, s.head, M.frame, op);
    sb(A + f, B - f, d, s.head - f, s.head, M.frame, op);
    if (B - A > 1.1) sb((A + B) / 2 - 0.025, (A + B) / 2 + 0.025, d, s.sill, s.head - f, M.frame, op);
    sb(A + f, B - f, 0.012, s.sill, s.head - f, M.glass, { cast: false });
    block(...rect(A, B));
    mapRects.push({ r: rect(A, B), k: 'win' });
  } else if (s.kind === 'slide') {
    const mid = (A + B) / 2, op = { cast: false, edges: true }, hd = s.head;
    sb(A, B, 0.1, 0, 0.02, M.frame, op);
    sb(A, A + 0.04, 0.12, 0, hd, M.frame, op);
    sb(B - 0.04, B, 0.12, 0, hd, M.frame, op);
    sb(A, B, 0.12, hd - 0.05, hd, M.frame, op);
    const leaf = (a, b, off) => {
      const f = 0.06;
      sb(a, a + f, 0.045, 0.02, hd - 0.05, M.frame, op, off);
      sb(b - f, b, 0.045, 0.02, hd - 0.05, M.frame, op, off);
      sb(a + f, b - f, 0.045, 0.02, 0.1, M.frame, op, off);
      sb(a + f, b - f, 0.045, hd - 0.11, hd - 0.05, M.frame, op, off);
      sb(a + f, b - f, 0.012, 0.1, hd - 0.11, M.glass, { cast: false }, off);
    };
    leaf(A + 0.04, mid + 0.03, -0.028);
    leaf(A + 0.1, mid + 0.09, 0.028);       // sliding leaf, pushed open over the fixed one
    block(...rect(A, mid + 0.1));
    mapRects.push({ r: rect(A, B), k: 'win' });
  } else {
    mapRects.push({ r: rect(A, B), k: 'door' });
  }
}

/* door leaves drawn open, with the swing arc the architect drew */
const DOORS = [
  // hinge x, hinge y, width (px), closed angle, open angle (0 = east, 90 = south)
  [388, 913, 73, 270, 180],   // bedroom 2
  [388, 943, 72, 90, 180],    // bedroom 3
  [398, 850, 74, 0, 270],     // shower room
  [482, 1003, 78, 270, 360],  // master bedroom
  [692, 1012, 78, 0, 90],     // en-suite
  [807, 1323, 85, 270, 180],  // front door
];
function buildDoors() {
  for (const [hx, hy, r, a0, a1] of DOORS) {
    const dx = Math.round(Math.cos(a1 * D2R)), dy = Math.round(Math.sin(a1 * D2R));
    const ex = hx + dx * (r - 2), ey = hy + dy * (r - 2), t = 2;
    const x1 = Math.min(hx, ex) - (dx === 0 ? t : 0), x2 = Math.max(hx, ex) + (dx === 0 ? t : 0);
    const y1 = Math.min(hy, ey) - (dy === 0 ? t : 0), y2 = Math.max(hy, ey) + (dy === 0 ? t : 0);
    box(G.building, X(x1), Z(y1), X(x2), Z(y2), 0.01, 2.05, M.door, { edges: true, block: true });
    const knobX = hx + dx * (r - 9), knobY = hy + dy * (r - 9);
    box(G.building, X(knobX) - (dx ? 0.06 : 0.035), Z(knobY) - (dy ? 0.06 : 0.035), X(knobX) + (dx ? 0.06 : 0.035), Z(knobY) + (dy ? 0.06 : 0.035), 0.98, 1.0, M.metal, { cast: false });
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const a = lerp(a0, a1, i / 28) * D2R;
      pts.push(new THREE.Vector3(X(hx + Math.cos(a) * r), 0.012, Z(hy + Math.sin(a) * r)));
    }
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkFaint);
    G.ink.add(arc);
  }
}

/* ---------------- floors, ceilings, the building around ---------------- */
function buildShell() {
  plane(40, 640, 835, 1690, 0, M.oak, { tile: 1.8 });
  plane(393, 668, 543, 845, 0.003, M.bathFloor, { tile: 0.6 });
  plane(685, 1017, 807, 1185, 0.003, M.bathFloor, { tile: 0.6 });
  plane(40, 1690, 835, PY_VER, 0, M.vtile, { tile: 0.6 });

  ceiling = plane(68, 668, 807, 1662, H, M.ceil, { down: true });
  plane(40, 1690, 835, PY_VER, H, M.ceil, { down: true });
  // veranda roof edge (the balcony slab of the floor above)
  box(G.building, 0, Z_VER - 0.22, W_OUT, Z_VER, H, H + 0.32, M.wall, { cast: true });
  box(G.building, 0, Z_SOUTH, 0.22, Z_VER - 0.22, H, H + 0.32, M.wall, { cast: true });

  // veranda railing: glass with a slim top rail
  const rail = (x1, z1, x2, z2) => {
    box(G.building, x1, z1, x2, z2, 0.02, 0.98, M.glass, { cast: false });
    box(G.building, x1, z1, x2, z2, 0, 0.04, M.frame, { cast: false, edges: true });
    const ex = x2 - x1 > z2 - z1;
    box(G.building, x1 - (ex ? 0 : 0.015), z1 - (ex ? 0.015 : 0), x2 + (ex ? 0 : 0.015), z2 + (ex ? 0.015 : 0), 0.98, 1.02, M.frame, { cast: false, edges: true });
    block(x1 - 0.02, z1 - 0.02, x2 + 0.02, z2 + 0.02);
  };
  rail(0.08, Z_VER - 0.1, W_OUT - 0.33, Z_VER - 0.08);
  rail(0.08, Z_SOUTH, 0.1, Z_VER - 0.1);
  mapRects.push({ r: [0.06, Z_VER - 0.12, W_OUT - 0.33, Z_VER - 0.06], k: 'win' });
  mapRects.push({ r: [0.06, Z_SOUTH, 0.12, Z_VER - 0.1], k: 'win' });

  // stop the walker at the front door (the landing is not part of the flat)
  block(W_OUT + 0.05, Z(1225), W_OUT + 1, Z(1335));

  // the building this flat sits in (its real 23.08 x 15.47 m footprint): slab, floors below,
  // and on this floor the stair core beside the front door and the neighbour's flat beyond it
  const BL = CTX.building.len, CORE = W_OUT + 4.4;
  box(G.site, 0, 0, BL, Z_VER, -0.3, -0.01, M.site, { cast: false });
  box(G.site, 0.05, 0.05, BL - 0.05, Z_SOUTH - 0.05, -10.65, -0.3, M.facade, { cast: false, tile: 3.3 });
  for (const y of [-3.55, -7.1]) {
    box(G.site, 0, Z_SOUTH, BL, Z_VER, y - 0.3, y, M.site, { cast: false });
    box(G.site, 0.05, Z_VER - 0.1, BL - 0.05, Z_VER - 0.08, y, y + 1, M.glass, { cast: false });
  }
  box(G.site, W_OUT, 0, CORE, Z(1205), 0, H + 0.6, M.site, { cast: true });
  box(G.site, W_OUT, Z(1325), BL, Z_SOUTH, 0, H + 0.35, M.facade, { cast: true, tile: 3.3 });
  box(G.site, CORE, 0, BL, Z(1325), 0, H + 0.35, M.facade, { cast: true, tile: 3.3 });
  box(G.site, W_OUT, Z_VER - 0.1, BL - 0.05, Z_VER - 0.08, 0, 1, M.glass, { cast: false });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(C.x, -10.65, C.z);
  ground.receiveShadow = true;
  G.site.add(ground);
  groundMesh = ground;

  // recessed ceiling lights
  for (const [px, py] of [[205, 800], [225, 1060], [690, 850], [468, 760], [745, 1100], [435, 960], [435, 1120],
    [580, 1100], [130, 1290], [250, 1290], [560, 1290], [700, 1290], [690, 1450], [690, 1600], [200, 1820], [440, 1820], [680, 1820]]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.065, 20), M.glow);
    d.rotation.x = Math.PI / 2;
    d.position.set(X(px), H - 0.004, Z(py));
    G.building.add(d);
  }
}
let ceiling, groundMesh;

/* ---------------- furniture ---------------- */
function plant(px, py, s = 1) {
  Fc(px, py, 0.17 * s, 0, 0.42 * s, M.pot, { r2: 0.2 * s, block: true });
  const blobs = [[0, 0.75, 0, 0.32], [0.12, 0.98, 0.05, 0.24], [-0.1, 1.05, -0.06, 0.22], [0.02, 1.25, 0.08, 0.18]];
  for (const [ox, oy, oz, r] of blobs) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), M.leaf);
    b.position.set(X(px) + ox * s, oy * s, Z(py) + oz * s);
    b.castShadow = true;
    G.furniture.add(b);
  }
}
function chair(px, py, face) {
  const cx = X(px), cz = Z(py), s = 0.22;
  box(G.furniture, cx - s, cz - s, cx + s, cz + s, 0.43, 0.47, M.walnut, { edges: true });
  for (const [ix, iz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    box(G.furniture, cx + ix * (s - 0.03) - 0.016, cz + iz * (s - 0.03) - 0.016, cx + ix * (s - 0.03) + 0.016, cz + iz * (s - 0.03) + 0.016, 0, 0.43, M.black, { cast: false });
  }
  const b = { n: [cx - s, cz + s - 0.03, cx + s, cz + s], s: [cx - s, cz - s, cx + s, cz - s + 0.03], e: [cx - s, cz - s, cx - s + 0.03, cz + s], w: [cx + s - 0.03, cz - s, cx + s, cz + s] }[face];
  box(G.furniture, ...b, 0.47, 0.86, M.walnut, { edges: true });
  block(cx - s, cz - s, cx + s, cz + s);
}
function stool(px, py) {
  Fc(px, py, 0.18, 0, 0.02, M.black, { cast: false });
  Fc(px, py, 0.025, 0.02, 0.63, M.metal, { edges: false });
  Fc(px, py, 0.19, 0.63, 0.68, M.walnut, { block: true });
}
function bed({ x1, y1, x2, y2, head, duvet, pillows }) {
  F(x1, y1, x2, y2, 0, 0.3, M.walnut, { block: true, tile: 1 });
  F(x1 + 2, y1 + 2, x2 - 2, y2 - 2, 0.3, 0.52, M.linen, { tile: 0.8 });
  F(duvet[0], duvet[1], duvet[2], duvet[3], 0.5, 0.58, duvet.mat, { tile: 0.8 });
  for (const p of pillows) F(...p, 0.52, 0.65, M.linen, { tile: 0.5 });
  F(...head, 0, 1.08, M.headboard, { tile: 0.8 });
}
function wardrobe(x1, y1, x2, y2, m, face) {
  // face: the side the doors open to (w = west, e = east)
  F(x1, y1, x2, y2, 0, 2.4, m, { block: true, tile: 1.2 });
  const n = Math.max(2, Math.round((y2 - y1) / S / 0.5));
  const fx = face === 'w' ? X(x1) - 0.004 : X(x2) + 0.004;
  for (let i = 1; i < n; i++) {
    const zz = lerp(Z(y1), Z(y2), i / n);
    box(G.furniture, fx - 0.004, zz - 0.003, fx + 0.004, zz + 0.003, 0.05, 2.37, M.black, { cast: false });
  }
}
function wc(cx, cy, tankSide) {
  // tankSide: where the cistern sits relative to the bowl (n, e)
  const x = X(cx), z = Z(cy);
  cyl(G.furniture, x, z, 0.17, 0, 0.4, M.ceramic, { r2: 0.2, block: true });
  cyl(G.furniture, x, z, 0.2, 0.4, 0.43, M.ceramic, {});
  if (tankSide === 'n') box(G.furniture, x - 0.2, z - 0.36, x + 0.2, z - 0.18, 0.4, 0.82, M.ceramic, { edges: true, block: true });
  else box(G.furniture, x + 0.18, z - 0.2, x + 0.36, z + 0.2, 0.4, 0.82, M.ceramic, { edges: true, block: true });
}
function vanity(x1, y1, x2, y2, basin) {
  F(x1, y1, x2, y2, 0.15, 0.8, M.walnut, { block: true, tile: 0.8 });
  F(x1 - 1, y1 - 1, x2 + 1, y2 + 1, 0.8, 0.84, M.ceramic);
  F(...basin, 0.84, 0.97, M.ceramic);
}
function tileWall(x1, y1, x2, y2, h = 2.2) { F(x1, y1, x2, y2, 0, h, M.tiles, { edges: false, tile: 0.6, cast: false }); }
function glassPanel(x1, y1, x2, y2) {
  box(G.furniture, X(x1), Z(y1), X(x2), Z(y2), 0.04, 2.0, M.glass, { cast: false });
  box(G.furniture, X(x1), Z(y1), X(x2), Z(y2), 1.98, 2.0, M.metal, { cast: false, edges: true });
  block(X(x1), Z(y1), X(x2), Z(y2));
}
function curtains(x1, y1, x2, y2) { F(x1, y1, x2, y2, 0.05, 2.6, M.curtain, { tile: 0.8, cast: false }); }

function buildFurniture() {
  /* bedroom 2 — bed head on the west wall */
  bed({ x1: 82, y1: 755, x2: 248, y2: 870, duvet: Object.assign([124, 753, 250, 872], { mat: M.duvetA }),
    pillows: [[88, 764, 120, 808], [88, 817, 120, 861]], head: [70, 748, 82, 877] });
  F(72, 700, 113, 745, 0, 0.5, M.walnut, { block: true });
  Fc(92, 722, 0.06, 0.5, 0.82, M.ceramic, {});
  Fc(92, 722, 0.12, 0.82, 1.0, M.curtain, { r2: 0.09 });
  wardrobe(330, 672, 383, 838, M.walnut, 'w');
  F(120, 742, 300, 900, 0, 0.012, M.rug, { cast: false, edges: false });
  curtains(112, 669, 126, 675); curtains(267, 669, 281, 675);
  F(150, 916, 262, 922, 1.25, 1.9, M.art3, {});

  /* bedroom 3 — bed head on the south wall */
  bed({ x1: 135, y1: 1015, x2: 248, y2: 1180, duvet: Object.assign([133, 1013, 250, 1135], { mat: M.duvetB }),
    pillows: [[142, 1140, 188, 1173], [195, 1140, 241, 1173]], head: [130, 1180, 253, 1186] });
  F(80, 1138, 125, 1183, 0, 0.5, M.walnut, { block: true });
  Fc(102, 1160, 0.06, 0.5, 0.82, M.ceramic, {});
  Fc(102, 1160, 0.12, 0.82, 1.0, M.curtain, { r2: 0.09 });
  wardrobe(330, 1017, 383, 1185, M.walnut, 'w');
  curtains(69, 970, 75, 985); curtains(69, 1120, 75, 1135);

  /* master bedroom */
  bed({ x1: 648, y1: 755, x2: 770, y2: 915, duvet: Object.assign([646, 800, 772, 917], { mat: M.duvetC }),
    pillows: [[656, 761, 706, 796], [712, 761, 762, 796]], head: [640, 745, 778, 755] });
  F(604, 755, 641, 792, 0, 0.5, M.walnut, { block: true });
  F(777, 755, 806, 792, 0, 0.5, M.walnut, { block: true });
  Fc(622, 773, 0.06, 0.5, 0.82, M.ceramic, {});
  Fc(622, 773, 0.12, 0.82, 1.0, M.curtain, { r2: 0.09 });
  Fc(791, 773, 0.06, 0.5, 0.82, M.ceramic, {});
  Fc(791, 773, 0.12, 0.82, 1.0, M.curtain, { r2: 0.09 });
  F(615, 880, 800, 980, 0, 0.012, M.rug, { cast: false, edges: false });
  curtains(594, 669, 607, 675); curtains(746, 669, 759, 675);
  curtains(801, 755, 806, 769); curtains(801, 961, 806, 975);
  // walk-in wardrobe: two runs with a 0.97 m aisle
  wardrobe(487, 1012, 540, 1170, M.lacquer, 'e');
  wardrobe(622, 1012, 675, 1170, M.lacquer, 'w');
  // laundry niche off the hallway
  F(490, 858, 543, 914, 0, 0.85, M.lacquer, { block: true });
  F(490, 858, 543, 914, 0.87, 1.72, M.lacquer, {});
  for (const y of [0.43, 1.3]) {
    const d = cyl(G.furniture, X(489), Z(886), 0.17, y - 0.01, y + 0.01, M.black, { edges: false });
    d.rotation.z = Math.PI / 2;
    d.position.set(X(489), y, Z(886));
  }

  /* shower room */
  tileWall(393, 668, 472, 671); tileWall(472, 668, 524, 671, 1.47); tileWall(524, 668, 543, 671);
  tileWall(540, 671, 543, 845); tileWall(393, 671, 396, 845); tileWall(472, 842, 540, 845); tileWall(396, 842, 398, 845);
  F(396, 671, 455, 735, 0, 0.04, M.ceramic, { cast: false });
  glassPanel(454, 671, 456, 735); glassPanel(396, 734, 428, 736);
  Fc(425, 680, 0.1, 2.05, 2.07, M.metal, {});
  wc(512, 705, 'n');
  vanity(506, 780, 540, 828, [512, 788, 534, 820]);
  F(536, 782, 538, 826, 1.1, 1.9, M.mirror, {});
  Fc(536, 804, 0.012, 0.84, 1.07, M.metal, { edges: false });

  /* en-suite */
  tileWall(685, 1017, 692, 1020); tileWall(770, 1017, 804, 1020);
  tileWall(804, 1017, 807, 1040); tileWall(804, 1040, 807, 1095, 1.47); tileWall(804, 1095, 807, 1182);
  tileWall(685, 1182, 807, 1185); tileWall(685, 1020, 688, 1182);
  F(740, 1100, 804, 1182, 0, 0.04, M.ceramic, { cast: false });
  glassPanel(760, 1099, 804, 1101); glassPanel(739, 1101, 741, 1140);
  Fc(790, 1170, 0.1, 2.05, 2.07, M.metal, {});
  wc(780, 1055, 'e');
  vanity(690, 1148, 738, 1182, [698, 1154, 730, 1176]);
  F(692, 1178, 736, 1180, 1.1, 1.9, M.mirror, {});

  /* kitchen */
  F(68, 1195, 310, 1251, 0, 0.86, M.cabinet, { block: true });
  F(68, 1194, 312, 1253, 0.86, 0.9, M.marble, { tile: 0.9 });
  F(68, 1195, 310, 1198, 0.9, 1.5, M.marble, { tile: 0.9, edges: false });
  F(68, 1198, 310, 1233, 1.5, 2.3, M.cabinet, {});
  F(226, 1204, 279, 1240, 0.885, 0.905, M.metal, { cast: false });
  Fc(252, 1201, 0.015, 0.9, 1.22, M.metal, { edges: false });
  F(315, 1195, 380, 1252, 0, 2.3, M.cabinet, { block: true });
  for (let i = 1; i < 5; i++) {
    const x = X(lerp(68, 310, i / 5));
    box(G.furniture, x - 0.003, Z(1251) - 0.002, x + 0.003, Z(1251) + 0.006, 0.05, 0.84, M.black, { cast: false });
  }
  // island with hob and a hood above it
  F(68, 1340, 310, 1415, 0, 0.86, M.walnut, { block: true, tile: 1 });
  F(68, 1338, 314, 1417, 0.86, 0.9, M.marble, { tile: 0.9 });
  F(218, 1348, 258, 1390, 0.9, 0.906, M.black, { cast: false });
  F(208, 1344, 268, 1394, 1.95, 2.2, M.metal, {});
  F(232, 1362, 244, 1376, 2.2, H, M.metal, { edges: false });
  stool(105, 1325); stool(168, 1325); stool(168, 1437);

  /* dining */
  F(190, 1515, 340, 1595, 0.72, 0.76, M.walnut, { block: true, tile: 1.2 });
  for (const [px, py] of [[197, 1522], [333, 1522], [197, 1588], [333, 1588]]) F(px - 3, py - 3, px + 3, py + 3, 0, 0.72, M.black, { cast: false });
  for (const x of [217, 265, 312]) { chair(x, 1497, 's'); chair(x, 1612, 'n'); }
  chair(171, 1555, 'e'); chair(358, 1555, 'w');
  F(215, 1549, 315, 1561, 1.85, 1.9, M.black, {});
  F(217, 1550, 313, 1560, 1.845, 1.85, M.glow, { edges: false, cast: false });
  for (const x of [222, 308]) Fc(x, 1555, 0.004, 1.9, H, M.black, { edges: false, cast: false });
  plant(92, 1645, 1.1);

  /* living room */
  F(510, 1345, 570, 1590, 0, 0.42, M.sofa, { block: true, tile: 0.7 });
  F(510, 1345, 526, 1590, 0.42, 0.82, M.sofa, { tile: 0.7 });
  F(526, 1578, 570, 1590, 0.42, 0.62, M.sofa, { tile: 0.7 });
  F(570, 1345, 630, 1405, 0, 0.42, M.sofa, { block: true, tile: 0.7 });
  F(526, 1345, 630, 1361, 0.42, 0.82, M.sofa, { tile: 0.7 });
  F(618, 1361, 630, 1405, 0.42, 0.62, M.sofa, { tile: 0.7 });
  for (const [a, b] of [[1361, 1440], [1440, 1515], [1515, 1578]]) F(527, a + 1, 568, b - 1, 0.42, 0.5, M.sofa, { tile: 0.7 });
  F(570, 1362, 616, 1404, 0.42, 0.5, M.sofa, { tile: 0.7 });
  F(528, 1368, 542, 1398, 0.5, 0.74, M.duvetB, {});
  F(528, 1530, 542, 1562, 0.5, 0.74, M.art2, {});
  F(612, 1465, 650, 1500, 0, 0.38, M.walnut, { block: true });
  F(650, 1450, 690, 1490, 0, 0.32, M.marble, { block: true });
  F(565, 1395, 765, 1615, 0, 0.012, M.rug2, { cast: false, edges: false });
  F(768, 1410, 805, 1580, 0, 0.42, M.walnut, { block: true, tile: 1 });
  F(800, 1440, 805, 1555, 0.95, 1.66, M.screen, {});
  Fc(785, 1625, 0.15, 0, 0.02, M.black, { block: true });
  Fc(785, 1625, 0.012, 0.02, 1.48, M.black, { edges: false });
  Fc(785, 1625, 0.2, 1.48, 1.72, M.curtain, { r2: 0.16 });
  F(570, 1196, 660, 1199, 1.25, 1.85, M.art1, {});
  F(675, 1196, 755, 1199, 1.3, 1.8, M.art2, {});
  plant(772, 1365, 0.9);
  plant(462, 1640, 0.8);

  /* covered veranda */
  for (const [px, py] of [[95, 1905], [792, 1912]]) plant(px, py, 0.9);
  Fc(640, 1840, 0.32, 0.7, 0.73, M.walnut, { block: true });
  Fc(640, 1840, 0.03, 0, 0.7, M.black, { edges: false });
  chair(590, 1840, 'e'); chair(690, 1840, 'w');
  F(150, 1800, 330, 1870, 0, 0.36, M.walnut, { block: true });
  F(150, 1800, 330, 1870, 0.36, 0.44, M.duvetC, {});
  F(150, 1800, 330, 1812, 0.44, 0.75, M.duvetC, {});
}

/* ---------------- plan annotations ---------------- */
function label(name, sub, px, py, scale = 1) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 300;
  const g = cv.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1c1c1a';
  g.font = '600 88px "Helvetica Neue", Arial, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '8px';
  g.fillText(name, 512, sub ? 112 : 150);
  if (sub) {
    g.font = '400 62px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = '#57534b';
    if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillText(sub, 512, 212);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  const w = 2.6 * scale;
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 300 / 1024), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(X(px), 0.05, Z(py));
  mesh.renderOrder = 10;
  G.labels.add(mesh);
  labelMats.push(m);
}
function northArrow(px, py) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.strokeStyle = g.fillStyle = '#1c1c1a';
  g.lineWidth = 6;
  g.beginPath(); g.arc(128, 140, 70, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(128, 60); g.lineTo(156, 190); g.lineTo(128, 168); g.lineTo(100, 190); g.closePath(); g.fill();
  g.font = '700 54px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('N', 128, 30);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 10;
  const holder = new THREE.Group();
  holder.position.set(X(px), 0.05, Z(py));
  holder.rotation.y = Math.atan2(-CTX.north[0], -CTX.north[1]);
  holder.add(mesh);
  G.labels.add(holder);
  labelMats.push(m);
}
function inkLine(points, m = inkMat) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.012, z))), m);
  G.ink.add(l);
}
function buildAnnotations() {
  label('BEDROOM 2', '3.00 × 3.00', 215, 893, 0.85);
  label('BEDROOM 3', '3.60 × 3.00', 240, 975, 0.85);
  label('BEDROOM 1', '3.07 × 4.00', 690, 955, 0.85);
  label('SHOWER', '1.80 × 2.10', 452, 800, 0.52);
  label('EN-SUITE', '1.50 × 2.00', 722, 1120, 0.48);
  label('HALL', '', 435, 1100, 0.45);
  label('WARDROBE', '', 581, 1095, 0.48);
  label('KITCHEN', '', 190, 1296, 0.85);
  label('DINING', '', 265, 1462, 0.85);
  label('LIVING ROOM', '8.67 × 5.54', 705, 1585, 0.95);
  label('COVERED VERANDA', '9.25 × 2.99', 440, 1915, 0.95);
  label('Δ303', '+10.65', 665, 1262, 0.7);
  label('9.33', '', 437, 585, 0.55);
  northArrow(480, 1785);
  // overall dimension line, like the sheet
  const zd = Z(610);
  inkLine([[0, zd], [W_OUT, zd]]);
  for (const x of [0, W_OUT]) inkLine([[x - 0.08, zd + 0.08], [x + 0.08, zd - 0.08]]);
  for (const x of [0, W_OUT]) inkLine([[x, zd - 0.12], [x, zd + 0.25]], inkFaint);
  // veranda tile grid
  for (let x = 0.6; x < W_OUT - 0.35; x += 0.6) inkLine([[x, Z_SOUTH + 0.02], [x, Z_VER - 0.1]], inkFaint);
  for (let z = Z_SOUTH + 0.6; z < Z_VER - 0.1; z += 0.6) inkLine([[0.1, z], [W_OUT - 0.33, z]], inkFaint);
}

/* ---------------- build ---------------- */
buildWalls();
buildDoors();
buildShell();
buildFurniture();
buildAnnotations();

/* section caps: the solid poché you see where the plane cuts the walls */
const capMat = new THREE.MeshBasicMaterial({ color: INK.clone(), side: THREE.DoubleSide, fog: false });
const caps = (() => {
  const pos = [];
  for (const [x1, z1, x2, z2] of capRects) pos.push(x1, 0, z1, x2, 0, z1, x2, 0, z2, x1, 0, z1, x2, 0, z2, x1, 0, z2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, capMat);
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();

/* the real street outside (OpenStreetMap), see city.js */
const G_CTX = new THREE.Group();
scene.add(G_CTX);
buildCity(CTX, G_CTX, -10.65);

/* sky dome that follows the camera */
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    top: { value: new THREE.Color('#9db8d3') }, horizon: { value: HORIZON.clone() },
    below: { value: new THREE.Color('#cdc8bc') }, opacity: { value: 0 }, paper: { value: PAPER.clone() },
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 paper; uniform float opacity; varying vec3 vDir;
    void main(){ float h = normalize(vDir).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, below, clamp(-h * 5.0, 0.0, 1.0));
    gl_FragColor = vec4(mix(paper, c, opacity), 1.0);
    #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

/* ---------------- section + material state ---------------- */
// b = 0: the printed plan (cut at 1.2 m, paper and ink); b = 1: the finished flat
function setBuild(b) {
  const r = ease(seg(b, 0, 0.75));
  cut.constant = lerp(CUT, H + 0.7, r);
  const m = ease(seg(b, 0.2, 1));
  M.wall.color.copy(INK).lerp(PLASTER, m);
  for (const p of paperMats) {
    p.emissiveIntensity = 1 - m;
    p.color.copy(p.userData.base).multiplyScalar(m);
    p.envMapIntensity = m;
  }
  caps.visible = cut.constant < H - 0.002;
  caps.position.y = Math.min(cut.constant, H) - 0.004;
  capMat.color.copy(INK).lerp(PLASTER, Math.max(m, seg(cut.constant, H - 0.6, H)));
  inkMat.opacity = 1 - m;
  inkFaint.opacity = 0.35 * (1 - m);
  const showInk = m < 0.995;
  G.ink.visible = showInk;
  for (const l of inkLines) l.visible = showInk;
  const lo = 1 - ease(seg(b, 0, 0.35));
  for (const lm of labelMats) lm.opacity = lo;
  G.labels.visible = lo > 0.005;
  skyMat.uniforms.opacity.value = m;
  M.ground.opacity = m;
  groundMesh.visible = m > 0.005;
  G.site.visible = b > 0.04;
  G_CTX.visible = m > 0.3;
  ceiling.castShadow = cut.constant > H;
}

/* ---------------- camera ---------------- */
const cam = { pos: new THREE.Vector3(), yaw: 0, pitch: -Math.PI / 2, fov: 2 };
const fwd = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
function lookAngles(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
function applyCam() {
  camera.position.copy(cam.pos);
  camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
  camera.fov = cam.fov;
  const d = cam.pos.distanceTo(C);
  camera.near = clamp(d - 45, 0.06, 1e4);
  camera.far = d + 420;
  camera.updateProjectionMatrix();
  scene.fog.near = Math.max(50, d + 25);
  scene.fog.far = scene.fog.near + 280;
  sky.position.copy(cam.pos);
  sky.scale.setScalar(camera.far * 0.85);
}
function frameDist(fovDeg) {
  const t = Math.tan(fovDeg * D2R / 2), a = camera.aspect;
  const h = Z_VER + 2.0 + (mode === 'plan' || mode === 'anim' ? 2.6 : 0), w = W_OUT + 1.4;
  return Math.max(h / 2 / t, w / 2 / (t * a));
}
function walkFov() {
  return clamp(2 * Math.atan(Math.tan(38 * D2R) / camera.aspect) / D2R, 60, 86);
}

/* intro: plan → walls rise → down to the front door */
const ZOOM_END = 0.42, FOV_END = 40, PITCH_END = -56 * D2R;
const ENTRY = new THREE.Vector3(X(745), EYE, Z(1281));
const ENTRY_LOOK = new THREE.Vector3(X(150), 1.35, Z(1560));
let introCurve;
function k1Pos() { return C.clone().addScaledVector(fwd(0, PITCH_END), -frameDist(FOV_END) * 0.92); }
function buildIntroCurve() {
  introCurve = new THREE.CatmullRomCurve3([
    k1Pos(),
    new THREE.Vector3(W_OUT + 2.2, 10, Z(1281)),
    new THREE.Vector3(W_OUT + 2.2, 3.2, Z(1281)),
    new THREE.Vector3(W_OUT + 0.7, EYE, Z(1281)),
    ENTRY.clone(),
  ], false, 'centripetal');
}
function zoomState(z) {
  const zt = ease(z);
  cam.fov = Math.exp(lerp(Math.log(2), Math.log(FOV_END), zt));
  cam.pitch = lerp(-Math.PI / 2, PITCH_END, ease(seg(z, 0.25, 1)));
  cam.yaw = 0;
  const d = frameDist(cam.fov) * lerp(1, 0.92, zt);
  cam.pos.copy(C).addScaledVector(fwd(0, cam.pitch), -d);
  cam.pos.z += (camera.aspect > 0.75 ? 1.1 : 0.25) * (1 - zt);
}
function introState(t) {
  if (t <= ZOOM_END) zoomState(t / ZOOM_END);
  else {
    const ft = ease(seg(t, ZOOM_END, 1));
    cam.pos.copy(introCurve.getPoint(ft));
    const tgt = C.clone().lerp(ENTRY_LOOK, ease(seg(t, ZOOM_END, 0.92)));
    const a = lookAngles(cam.pos, tgt);
    cam.yaw = a.yaw; cam.pitch = a.pitch;
    cam.fov = lerp(FOV_END, walkFov(), ft);
  }
  setBuild(seg(t, 0.2, 0.66));
}

/* ---------------- animation runner ---------------- */
let anim = null;
function play(ms, update) {
  return new Promise(res => { anim = { ms, start: performance.now(), update, res }; update(0); });
}
function poseNow() { return { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch, fov: cam.fov }; }
function flyPose(to, ms = 1200, lift = 0) {
  const from = poseNow();
  const dy = wrap(to.yaw - from.yaw);
  const mid = from.pos.clone().lerp(to.pos, 0.5);
  mid.y += lift;
  return play(ms, k => {
    const e = ease(k);
    const a = from.pos.clone().lerp(mid, e), b = mid.clone().lerp(to.pos, e);
    cam.pos.copy(a.lerp(b, e));
    cam.yaw = from.yaw + dy * e;
    cam.pitch = lerp(from.pitch, to.pitch, e);
    cam.fov = lerp(from.fov, to.fov, e);
  });
}
const fadeEl = document.getElementById('fade');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function jumpPose(to) {
  fadeEl.classList.add('on');
  await wait(230);
  Object.assign(cam, { yaw: to.yaw, pitch: to.pitch, fov: to.fov });
  cam.pos.copy(to.pos);
  await wait(60);
  fadeEl.classList.remove('on');
  await wait(200);
}
// fly if the way is clear, otherwise a quick fade (no flying through walls)
async function goPose(to, ms = 1100) {
  if (pathClear(cam.pos.x, cam.pos.z, to.pos.x, to.pos.z) && Math.abs(cam.pos.y - to.pos.y) < 0.3) await flyPose(to, ms);
  else await jumpPose(to);
}

/* ---------------- rooms / viewpoints ---------------- */
const VIEWS = [
  { name: 'Entrance', p: [745, 1281], t: [150, 1560] },
  { name: 'Living room', p: [455, 1470], t: [805, 1495] },
  { name: 'Dining', p: [740, 1630], t: [230, 1470] },
  { name: 'Kitchen', p: [405, 1300], t: [150, 1228] },
  { name: 'Covered veranda', p: [745, 1745], t: [120, 1905] },
  { name: 'Hallway', p: [435, 1172], t: [435, 870] },
  { name: 'Shower room', p: [435, 874], t: [482, 705] },
  { name: 'Bedroom 2', p: [358, 878], t: [95, 770] },
  { name: 'Bedroom 3', p: [358, 982], t: [115, 1115] },
  { name: 'Master bedroom', p: [785, 985], t: [600, 760] },
  { name: 'Walk-in wardrobe', p: [585, 968], t: [581, 1190] },
  { name: 'En-suite', p: [735, 1040], t: [745, 1185] },
];
function viewPose(v) {
  const pos = new THREE.Vector3(X(v.p[0]), EYE, Z(v.p[1]));
  const a = lookAngles(pos, new THREE.Vector3(X(v.t[0]), 1.3, Z(v.t[1])));
  return { pos, yaw: a.yaw, pitch: a.pitch, fov: walkFov() };
}
const ROOMS = [
  ['Shower room', 393, 668, 543, 845], ['En-suite', 685, 1017, 807, 1185], ['Walk-in wardrobe', 487, 1012, 675, 1190],
  ['Hallway', 393, 845, 543, 920], ['Hallway', 393, 920, 477, 1196], ['Master bedroom', 487, 668, 807, 1012],
  ['Bedroom 2', 68, 668, 383, 928], ['Bedroom 3', 68, 928, 383, 1190], ['Kitchen', 68, 1190, 420, 1440],
  ['Dining', 68, 1440, 440, 1662], ['Living room', 420, 1190, 807, 1662], ['Covered veranda', 40, 1662, 835, PY_VER],
];
function roomAt(x, z) {
  const px = x * S + OX, py = z * S + OY;
  for (const [n, a, b, c, d] of ROOMS) if (px >= a && px <= c && py >= b && py <= d) return n;
  return '';
}

/* ---------------- collision ---------------- */
const R = 0.2;
function free(x, z, r = R) {
  for (const o of obstacles) if (x > o.x1 - r && x < o.x2 + r && z > o.z1 - r && z < o.z2 + r) return false;
  return true;
}
function pathClear(x1, z1, x2, z2) {
  const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.08);
  for (let i = 1; i <= n; i++) if (!free(lerp(x1, x2, i / n), lerp(z1, z2, i / n), R * 0.8)) return false;
  return true;
}
function move(vx, vz) {
  const p = cam.pos;
  if (free(p.x + vx, p.z)) p.x += vx;
  if (free(p.x, p.z + vz)) p.z += vz;
}

/* ---------------- UI ---------------- */
const $ = id => document.getElementById(id);
const ui = { plan: $('plan-ui'), walk: $('walk-ui'), room: $('room'), help: $('help'), joy: $('joy'), sheet: $('sheet'), map: $('minimap') };
let mode = 'plan';
let orbit = { yaw: 0.6, pitch: -0.95, dist: 18 };
let lastWalk = null;

function setMode(m) {
  mode = m;
  const walking = m === 'walk' || m === 'tour' || m === 'overview';
  ui.walk.hidden = !walking;
  document.body.classList.toggle('walking', m !== 'plan');
  ui.plan.classList.toggle('gone', m !== 'plan');
  for (const b of document.querySelectorAll('#bar button')) {
    const act = b.dataset.act;
    if (act === 'overview') b.textContent = m === 'overview' ? 'Walk' : '3D view';
    b.classList.toggle('on', (act === 'tour' && m === 'tour') || (act === 'overview' && m === 'overview'));
  }
  if (cut.constant > H) ceiling.castShadow = m !== 'overview';
}
function showRoom(name, big = false) {
  if (ui.room.textContent !== name) ui.room.textContent = name;
  ui.room.classList.toggle('big', big);
}

let helpShown = false;
function showHelp() {
  if (helpShown) return;
  helpShown = true;
  ui.help.innerHTML = coarse
    ? 'Left thumb: walk · Right thumb: look around<br>Tap the floor to walk there · Tap the map to jump'
    : 'W A S D or arrow keys: walk · Drag: look around<br>Click the floor to walk there · Shift: faster';
  setTimeout(() => ui.help.classList.add('gone'), 9000);
}

async function enter() {
  if (mode !== 'plan') return;
  buildIntroCurve();
  setMode('anim');
  await play(7600, introState);
  introState(1);
  setMode('walk');
  showHelp();
}
async function toPlan() {
  if (mode === 'plan' || mode === 'anim') return;
  tourToken++;
  ui.sheet.hidden = true;
  setMode('anim');
  const from = poseNow(), p1 = k1Pos();
  const mid = from.pos.clone().lerp(p1, 0.5); mid.y = Math.max(mid.y, from.pos.y) + 4;
  const dy = wrap(0 - from.yaw);
  await play(2300, k => {
    const e = ease(k);
    const a = from.pos.clone().lerp(mid, e), b = mid.clone().lerp(p1, e);
    cam.pos.copy(a.lerp(b, e));
    cam.yaw = from.yaw + dy * e;
    cam.pitch = lerp(from.pitch, PITCH_END, e);
    cam.fov = lerp(from.fov, FOV_END, e);
    setBuild(1 - ease(seg(k, 0.15, 1)));
  });
  await play(2000, k => zoomState(1 - k));
  zoomState(0);
  setMode('plan');
}
function overviewPose() {
  const pos = C.clone().addScaledVector(fwd(orbit.yaw, orbit.pitch), -orbit.dist);
  return { pos, yaw: orbit.yaw, pitch: orbit.pitch, fov: 45 };
}
async function toOverview() {
  tourToken++;
  lastWalk = poseNow();
  orbit = { yaw: wrap(cam.yaw), pitch: -0.95, dist: frameDist(45) * 0.95 };
  setMode('anim');
  await flyPose(overviewPose(), 1500, 3);
  setMode('overview');
}
async function toWalk(pose) {
  setMode('anim');
  await flyPose(pose, 1500, 2);
  setMode('walk');
}
let tourToken = 0;
async function startTour() {
  const tok = ++tourToken;
  ui.sheet.hidden = true;
  if (mode === 'overview') { await toWalk(lastWalk || viewPose(VIEWS[0])); if (tok !== tourToken) return; }
  setMode('tour');
  for (const v of VIEWS) {
    if (tok !== tourToken) return;
    showRoom(v.name, true);
    await goPose(viewPose(v), 1700);
    if (tok !== tourToken) return;
    const y0 = cam.yaw;
    await play(2600, k => { cam.yaw = y0 - 0.22 * ease(k); });
  }
  if (tok === tourToken) { setMode('walk'); showRoom(roomAt(cam.pos.x, cam.pos.z)); }
}
function stopTour() {
  if (mode !== 'tour') return;
  tourToken++;
  anim = null;
  fadeEl.classList.remove('on');
  setMode('walk');
}

$('enter').addEventListener('click', enter);
for (const b of document.querySelectorAll('#bar button')) {
  b.addEventListener('click', async e => {
    e.stopPropagation();
    const act = b.dataset.act;
    if (mode === 'anim') return;
    if (act === 'rooms') { stopTour(); ui.sheet.hidden = false; }
    if (act === 'tour') { if (mode === 'tour') stopTour(); else startTour(); }
    if (act === 'overview') {
      if (mode === 'overview') await toWalk(lastWalk || viewPose(VIEWS[0]));
      else { stopTour(); await toOverview(); }
    }
    if (act === 'plan') toPlan();
  });
}
const list = $('room-list');
for (const v of VIEWS) {
  const b = document.createElement('button');
  b.textContent = v.name;
  b.addEventListener('click', async () => {
    ui.sheet.hidden = true;
    if (mode === 'overview') { await toWalk(viewPose(v)); return; }
    setMode('anim');
    await goPose(viewPose(v));
    setMode('walk');
  });
  list.appendChild(b);
}
ui.sheet.addEventListener('click', e => { if (e.target === ui.sheet) ui.sheet.hidden = true; });

/* ---------------- input ---------------- */
const keys = {};
addEventListener('keydown', e => {
  if (e.target.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return;
  if (mode === 'plan' && (e.code === 'Enter' || e.code === 'Space')) { enter(); return; }
  if (mode === 'tour') stopTour();
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const joy = { x: 0, y: 0, id: null };
const pointers = new Map();
let glide = null;
const ray = new THREE.Raycaster();

canvas.addEventListener('pointerdown', e => {
  if (mode === 'tour') stopTour();
  if (mode !== 'walk' && mode !== 'overview') return;
  canvas.setPointerCapture(e.pointerId);
  const role = mode === 'walk' && e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && joy.id === null ? 'joy' : 'look';
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), role });
  if (role === 'joy') {
    joy.id = e.pointerId;
    ui.joy.style.left = e.clientX + 'px'; ui.joy.style.top = e.clientY + 'px';
    ui.joy.classList.add('on');
  }
  glide = null;
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (p.role === 'joy') {
    let jx = e.clientX - p.sx, jy = e.clientY - p.sy;
    const l = Math.hypot(jx, jy), max = 50;
    if (l > max) { jx *= max / l; jy *= max / l; }
    joy.x = jx / max; joy.y = -jy / max;
    ui.joy.firstElementChild.style.transform = `translate(${jx}px, ${jy}px)`;
    return;
  }
  const looks = [...pointers.values()].filter(q => q.role === 'look');
  if (mode === 'overview' && looks.length === 2) {
    const [a, b] = looks;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (p.pinch) orbit.dist = clamp(orbit.dist * p.pinch / d, 6, 60);
    for (const q of looks) q.pinch = d;
    return;
  }
  const k = e.pointerType === 'touch' ? 0.0055 : 0.0042;
  if (mode === 'walk') {
    cam.yaw += dx * k;
    cam.pitch = clamp(cam.pitch + dy * k, -1.35, 1.35);
  } else if (mode === 'overview') {
    orbit.yaw -= dx * k;
    orbit.pitch = clamp(orbit.pitch - dy * k, -1.5, -0.2);
  }
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  for (const q of pointers.values()) q.pinch = null;
  if (p.role === 'joy') {
    joy.id = null; joy.x = joy.y = 0;
    ui.joy.classList.remove('on');
    ui.joy.firstElementChild.style.transform = '';
    return;
  }
  const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
  if (e.type === 'pointerup' && moved < 8 && performance.now() - p.t < 350) tapAt(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  if (mode !== 'overview') return;
  e.preventDefault();
  orbit.dist = clamp(orbit.dist * (1 + e.deltaY * 0.001), 6, 60);
}, { passive: false });

/* tap marker */
const marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
scene.add(marker);
let markerT = 0;

function tapAt(cx, cy) {
  ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const hits = ray.intersectObjects([G.building, G.furniture], true)
    .filter(h => h.object.isMesh && h.object.material !== M.glass && h.object.material !== M.ceil && h.object.material !== M.glow);
  // the first floor point in line of sight; furniture in the way is looked past, walls are not
  let h = null;
  for (const c of hits) {
    if (c.point.y < 0.05) { h = c; break; }
    if (c.object.material === M.wall || c.object.material === M.door) break;
  }
  if (!h) return;
  const x = h.point.x, z = h.point.z;
  if (mode === 'overview' && !free(x, z)) return;
  marker.position.set(x, 0.02, z);
  markerT = 1;
  if (mode === 'overview') {
    const pos = new THREE.Vector3(x, EYE, z);
    toWalk({ pos, yaw: orbit.yaw, pitch: -0.08, fov: walkFov() });
    return;
  }
  glide = { x, z };
}

/* ---------------- mini map ---------------- */
const map = ui.map, mctx = map.getContext('2d');
const MAP_W = coarse ? 104 : 128, MPAD = 7;
const MK = (MAP_W - MPAD * 2) / W_OUT;
const MAP_H = Math.round(Z_VER * MK + MPAD * 2);
const mdpr = Math.min(2, devicePixelRatio);
map.width = MAP_W * mdpr; map.height = MAP_H * mdpr;
map.style.width = MAP_W + 'px'; map.style.height = MAP_H + 'px';
const mapBase = document.createElement('canvas');
mapBase.width = map.width; mapBase.height = map.height;
{
  const g = mapBase.getContext('2d');
  g.scale(mdpr, mdpr);
  const r = ([x1, z1, x2, z2]) => [MPAD + x1 * MK, MPAD + z1 * MK, (x2 - x1) * MK, (z2 - z1) * MK];
  g.fillStyle = '#fbfaf6'; g.fillRect(...r([0, 0, W_OUT, Z_SOUTH]));
  g.fillStyle = '#ebe6dc'; g.fillRect(...r([0, Z_SOUTH, W_OUT, Z_VER]));
  g.fillStyle = 'rgba(28,28,26,.13)';
  for (const o of obstacles) g.fillRect(...r([o.x1, o.z1, o.x2, o.z2]));
  for (const m of mapRects) {
    g.fillStyle = m.k === 'wall' ? '#1c1c1a' : m.k === 'win' ? '#8fb1bf' : 'rgba(0,0,0,0)';
    g.fillRect(...r(m.r));
  }
}
function drawMap() {
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, map.width, map.height);
  mctx.drawImage(mapBase, 0, 0);
  mctx.scale(mdpr, mdpr);
  const px = MPAD + cam.pos.x * MK, py = MPAD + cam.pos.z * MK;
  const dir = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));
  mctx.fillStyle = 'rgba(214, 90, 49, .28)';
  mctx.beginPath(); mctx.moveTo(px, py); mctx.arc(px, py, 22, dir - 0.62, dir + 0.62); mctx.closePath(); mctx.fill();
  mctx.fillStyle = '#d65a31';
  mctx.beginPath(); mctx.arc(px, py, 3.6, 0, Math.PI * 2); mctx.fill();
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.2; mctx.stroke();
}
map.addEventListener('pointerdown', async e => {
  e.stopPropagation();
  if (mode !== 'walk' && mode !== 'overview' && mode !== 'tour') return;
  const b = map.getBoundingClientRect();
  const x = (e.clientX - b.left - MPAD) / MK, z = (e.clientY - b.top - MPAD) / MK;
  if (!free(x, z)) return;
  stopTour();
  const pose = { pos: new THREE.Vector3(x, EYE, z), yaw: mode === 'overview' ? orbit.yaw : cam.yaw, pitch: 0, fov: walkFov() };
  if (mode === 'overview') { toWalk(pose); return; }
  setMode('anim');
  await goPose(pose, 900);
  setMode('walk');
});

/* ---------------- loop ---------------- */
let last = performance.now();
let lastRoom = '';
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (anim) {
    const k = clamp((now - anim.start) / anim.ms, 0, 1);
    anim.update(k);
    if (k >= 1) { const r = anim.res; anim = null; r(); }
  }

  if (mode === 'plan') zoomState(0);
  if (mode === 'overview') Object.assign(cam, overviewPose());
  if (mode === 'walk') {
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD) s += 1;
    if (keys.KeyA) s -= 1;
    if (keys.ArrowLeft || keys.KeyQ) cam.yaw += 1.7 * dt;
    if (keys.ArrowRight || keys.KeyE) cam.yaw -= 1.7 * dt;
    f += joy.y; s += joy.x;
    const l = Math.hypot(f, s);
    if (l > 1) { f /= l; s /= l; }
    if (l > 0.05) glide = null;
    const sp = keys.ShiftLeft || keys.ShiftRight ? 3.2 : 1.6;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    move((fx * f + rx * s) * sp * dt, (fz * f + rz * s) * sp * dt);
    if (glide) {
      const gx = glide.x - cam.pos.x, gz = glide.z - cam.pos.z, d = Math.hypot(gx, gz);
      if (d < 0.05) glide = null;
      else {
        const step = Math.min(d, 1.9 * dt);
        const bx = cam.pos.x, bz = cam.pos.z;
        move(gx / d * step, gz / d * step);
        if (Math.hypot(cam.pos.x - bx, cam.pos.z - bz) < step * 0.3) glide = null;
      }
    }
    cam.pos.y = EYE;
    cam.fov = walkFov();
  }
  if (mode === 'walk' || mode === 'tour' || mode === 'overview') {
    const room = mode === 'overview' ? 'Apartment Δ303' : roomAt(cam.pos.x, cam.pos.z);
    if (room !== lastRoom && mode !== 'tour') { showRoom(room); lastRoom = room; }
    drawMap();
  }
  if (markerT > 0) {
    markerT = Math.max(0, markerT - dt * 1.4);
    marker.material.opacity = markerT * 0.9;
    marker.scale.setScalar(1 + (1 - markerT) * 0.6);
  }

  applyCam();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  if (mode === 'walk') cam.fov = walkFov();
});

/* ---------------- start ---------------- */
const bar = document.querySelector('#loader .ld-bar i');
manager.onProgress = (_, done, total) => { bar.style.width = (done / total * 100) + '%'; };
let started = false;
function start() {
  if (started) return;
  started = true;
  document.getElementById('loader').classList.add('done');
}
manager.onLoad = start;
manager.onError = () => {};
setTimeout(start, 12000);

setBuild(0);
zoomState(0);
applyCam();
requestAnimationFrame(frame);

// small hook for automated checks
window.__fp = {
  get mode() { return mode; },
  enter, toPlan, toOverview, startTour,
  go: i => { setMode('walk'); const p = viewPose(VIEWS[i]); Object.assign(cam, { yaw: p.yaw, pitch: p.pitch, fov: p.fov }); cam.pos.copy(p.pos); },
  intro: t => { buildIntroCurve(); setMode('anim'); introState(t); },
  views: VIEWS.map(v => v.name),
  freeAt: (px, py) => free(X(px), Z(py)),
  walkSim: (yawDeg, secs) => {
    cam.yaw = yawDeg * D2R;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    for (let i = 0; i < secs * 60; i++) move(fx * 3.2 / 60, fz * 3.2 / 60);
  },
  probe: (cx, cy) => {
    ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
    return ray.intersectObjects([G.building, G.furniture], true).filter(h => h.object.isMesh).slice(0, 3).map(h => [+h.point.x.toFixed(2), +h.point.y.toFixed(2), +h.point.z.toFixed(2)]);
  },
  pos: () => ({ x: +cam.pos.x.toFixed(2), z: +cam.pos.z.toFixed(2), yaw: +cam.yaw.toFixed(3), room: roomAt(cam.pos.x, cam.pos.z) }),
};
