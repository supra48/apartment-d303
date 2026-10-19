// The real neighbourhood: building footprints, streets and land use from OpenStreetMap
// (© OpenStreetMap contributors, ODbL), baked into plan metres by the build script.
// Heights, facades, trees, walls and parked cars follow street-level photos of the area;
// they are a likeness, not a survey.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const pairs = flat => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
const signedArea = pts => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
};
function rng(seed) {
  let s = (Math.abs(seed | 0) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
function tex(url, srgb = true) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const img = url => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

/* geometry accumulator: flat-shaded quads with uv and colour, one draw call per material */
class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  tri(a, b, c, ua, ub, uc, col) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc]]) {
      this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); this.u.push(uv[0], uv[1]);
      this.c.push(col.r, col.g, col.b);
    }
  }
  // a b c d counter-clockwise when seen from the side the face should show
  quad(a, b, c, d, uv, col) {
    this.tri(a, b, c, uv[0], uv[1], uv[2], col);
    this.tri(a, c, d, uv[0], uv[2], uv[3], col);
  }
  // box from a start point along a horizontal direction; uvs in metres / tile
  box(x, z, dirx, dirz, len, depth, y0, y1, col, tile = 1, uvCell = null) {
    const nx = dirz, nz = -dirx;  // normal to the length; a negative depth grows the other way
    if (depth < 0) { x += nx * depth; z += nz * depth; depth = -depth; }
    const P = (s, t, y) => V(x + dirx * s + nx * t, y, z + dirz * s + nz * t);
    const c = [[0, 0], [len, 0], [len, depth], [0, depth]];
    const faceUv = (w, h) => uvCell ? uvCell : [[0, 0], [w / tile, 0], [w / tile, h / tile], [0, h / tile]];
    const h = y1 - y0;
    for (let i = 0; i < 4; i++) {
      const [s1, t1] = c[i], [s2, t2] = c[(i + 1) % 4];
      const w = Math.hypot(s2 - s1, t2 - t1);
      this.quad(P(s1, t1, y0), P(s2, t2, y0), P(s2, t2, y1), P(s1, t1, y1), faceUv(w, h), col);
    }
    this.quad(P(0, 0, y1), P(len, 0, y1), P(len, depth, y1), P(0, depth, y1), faceUv(len, depth), col);
    this.quad(P(0, 0, y0), P(0, depth, y0), P(len, depth, y0), P(len, 0, y0), faceUv(len, depth), col);
  }
  mesh(mat, { shadow = false } = {}) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = shadow;
    return m;
  }
}

/* ---------------- facade atlas: 5 x 2 cells, one cell = one bay (3.4 m) x one storey (3.2 m) ---------------- */
const COLS = 5, CELL = 256, BAY = 3.4, STOREY = 3.2;
const CELLS = { win: [0, 0], door: [1, 0], breeze: [2, 0], small: [3, 0], plain: [4, 0], garage: [0, 1], pilotis: [1, 1], entry: [2, 1], houseWin: [3, 1], stone: [4, 1] };
function cellUv(name, u0 = 0, u1 = 1) {
  const [c, r] = CELLS[name], pad = 3 / (COLS * CELL);
  const a = c / COLS + pad, b = (c + 1) / COLS - pad;
  const v0 = r === 0 ? 0.5 + 0.004 : 0.004, v1 = r === 0 ? 1 - 0.004 : 0.5 - 0.004;
  const ua = a + (b - a) * u0, ub = a + (b - a) * u1;
  return [[ua, v0], [ub, v0], [ub, v1], [ua, v1]];
}
function buildAtlas(plaster, stone) {
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = 2 * CELL;
  const g = cv.getContext('2d');
  const PX = CELL / BAY, PY = CELL / STOREY;
  const cells = Object.entries(CELLS);
  for (const [name, [c, r]] of cells) {
    const ox = c * CELL, oy = r * CELL;
    const X = m => ox + m * PX, Y = m => oy + CELL - m * PY;  // m above the floor
    g.save();
    g.beginPath(); g.rect(ox, oy, CELL, CELL); g.clip();
    if (plaster) g.drawImage(plaster, ox, oy, CELL, CELL); else { g.fillStyle = '#efebe4'; g.fillRect(ox, oy, CELL, CELL); }
    g.fillStyle = 'rgba(255,253,249,0.62)'; g.fillRect(ox, oy, CELL, CELL);
    const slab = () => {
      g.fillStyle = 'rgba(70,60,50,0.10)'; g.fillRect(ox, Y(0.24), CELL, 0.24 * PY);
      g.fillStyle = 'rgba(40,35,30,0.18)'; g.fillRect(ox, Y(0.24), CELL, 2);
    };
    const shutterBox = (x0, x1, y) => { g.fillStyle = '#e4dfd5'; g.fillRect(X(x0) - 4, Y(y + 0.2), X(x1) - X(x0) + 8, 0.2 * PY); };
    const glass = (x0, x1, y0, y1) => {
      const gr = g.createLinearGradient(0, Y(y1), 0, Y(y0));
      gr.addColorStop(0, '#7f93a5'); gr.addColorStop(0.35, '#4b5966'); gr.addColorStop(1, '#2c343c');
      g.fillStyle = gr; g.fillRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1));
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); g.moveTo(X(x0), Y(y1)); g.lineTo(X(x0) + (X(x1) - X(x0)) * 0.45, Y(y1)); g.lineTo(X(x0), Y(y0) + (Y(y1) - Y(y0)) * 0.1); g.fill();
    };
    const shutter = (x0, x1, top, bottom, col = '#d8ccb3') => {
      g.fillStyle = col; g.fillRect(X(x0), Y(top), X(x1) - X(x0), Y(bottom) - Y(top));
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = Y(top) + 3; y < Y(bottom); y += 4) g.fillRect(X(x0), y, X(x1) - X(x0), 1);
    };
    const frame = (x0, x1, y0, y1, col = '#ece9e2') => { g.fillStyle = col; g.fillRect(X(x0) - 3, Y(y1) - 3, X(x1) - X(x0) + 6, Y(y0) - Y(y1) + 6); };
    const sill = (x0, x1, y) => {
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(X(x0) - 6, Y(y) + 3, X(x1) - X(x0) + 12, 3);
      g.fillStyle = '#f2efe8'; g.fillRect(X(x0) - 6, Y(y), X(x1) - X(x0) + 12, 4);
    };
    const window = (x0, x1, y0, y1, shut) => {
      shutterBox(x0, x1, y1); frame(x0, x1, y0, y1); glass(x0, x1, y0, y1);
      g.fillStyle = '#ece9e2'; g.fillRect((X(x0) + X(x1)) / 2 - 2, Y(y1), 4, Y(y0) - Y(y1));
      if (shut > 0) shutter(x0, x1, y1, y1 - (y1 - y0) * shut);
      sill(x0, x1, y0);
    };
    if (name === 'win') { window(0.95, 2.45, 0.9, 2.2, 0.4); slab(); }
    if (name === 'houseWin') {
      if (stone) g.drawImage(stone, ox, Y(0.7), CELL, 0.7 * PY); else { g.fillStyle = '#c9b89c'; g.fillRect(ox, Y(0.7), CELL, 0.7 * PY); }
      window(0.95, 2.45, 0.95, 2.2, 0.55);
    }
    if (name === 'door') {
      shutterBox(0.75, 2.65, 2.35); frame(0.75, 2.65, 0.05, 2.35); glass(0.75, 2.65, 0.05, 2.35);
      g.fillStyle = '#ece9e2'; g.fillRect(X(1.7) - 2, Y(2.35), 4, Y(0.05) - Y(2.35)); g.fillRect(X(0.75), Y(1.0), X(2.65) - X(0.75), 3);
      shutter(0.75, 2.65, 2.35, 1.9);
      slab();
    }
    if (name === 'small') { window(1.4, 2.0, 1.6, 2.2, 0); slab(); }
    if (name === 'plain') slab();
    if (name === 'breeze') {
      g.fillStyle = '#ece6da'; g.fillRect(X(0.3), Y(3.0), X(3.1) - X(0.3), Y(0.25) - Y(3.0));
      for (let yy = 0.3; yy < 2.95; yy += 0.2) for (let xx = 0.35; xx < 3.05; xx += 0.2) {
        g.fillStyle = '#3d3a35'; g.fillRect(X(xx + 0.05), Y(yy + 0.15), 0.1 * PX, 0.1 * PY);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(X(xx + 0.05), Y(yy + 0.15), 0.1 * PX, 2);
      }
      slab();
    }
    if (name === 'garage') { shutter(0.25, 3.15, 2.5, 0.0, '#8a8d90'); g.fillStyle = '#d9d4ca'; g.fillRect(X(0.15), Y(2.7), X(3.25) - X(0.15), 0.2 * PY); }
    if (name === 'pilotis') {
      const gr = g.createLinearGradient(0, Y(3.2), 0, Y(0));
      gr.addColorStop(0, '#2f2e2b'); gr.addColorStop(1, '#4a4843');
      g.fillStyle = gr; g.fillRect(ox, Y(2.95), CELL, Y(0) - Y(2.95));
      g.fillStyle = '#d7d1c6'; g.fillRect(X(0), Y(2.95), 0.35 * PX, Y(0) - Y(2.95));
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(X(1.6), Y(2.0), 1.4 * PX, 0.6 * PY);
    }
    if (name === 'entry') {
      g.fillStyle = '#e6e1d7'; g.fillRect(X(0.7), Y(2.75), X(2.7) - X(0.7), 0.15 * PY);
      frame(1.0, 2.4, 0.0, 2.45, '#9da3a8'); glass(1.0, 2.4, 0.0, 2.45);
      g.fillStyle = '#9da3a8'; g.fillRect(X(1.7) - 2, Y(2.45), 4, Y(0) - Y(2.45));
    }
    if (name === 'stone') { if (stone) g.drawImage(stone, ox, Y(0.9), CELL, 0.9 * PY); slab(); }
    g.restore();
  }
  return cv;
}

/* ---------------- canvas foliage and railings ---------------- */
function foliage(kind, opaque = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  if (opaque) { g.fillStyle = '#1f2d1c'; g.fillRect(0, 0, 256, 256); }
  const r = rng(kind.length * 97 + 13);
  const pine = kind === 'pine';
  if (pine) {
    g.strokeStyle = '#4a3a2a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(4, 128); g.lineTo(252, 128); g.stroke();
    for (let i = 0; i < 2600; i++) {
      const x = 8 + r() * 240, side = r() < 0.5 ? -1 : 1, len = 14 + r() * 40 * (1 - x / 320);
      g.strokeStyle = `hsl(${105 + r() * 25}, ${35 + r() * 20}%, ${18 + r() * 16}%)`;
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(x, 128); g.lineTo(x + len * 0.35, 128 + side * len); g.stroke();
    }
  } else {
    const blobs = opaque ? 14 : kind === 'cypress' ? 7 : 6;
    for (let b = 0; b < blobs; b++) {
      const cx = opaque ? r() * 256 : 60 + r() * 136, cy = opaque ? r() * 256 : 60 + r() * 136, rad = 46 + r() * 34;
      const n = kind === 'cypress' ? 700 : 520;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const shade = (y - cy) / rad;   // darker underneath
        const hue = kind === 'cypress' ? 115 + r() * 20 : 78 + r() * 34;
        const sat = kind === 'cypress' ? 28 + r() * 15 : 30 + r() * 25;
        const lit = (kind === 'cypress' ? 16 : 22) + r() * 18 - shade * 8;
        g.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`;
        g.beginPath();
        if (kind === 'cypress') g.ellipse(x, y, 2 + r() * 2, 3 + r() * 3, r() * 3, 0, Math.PI * 2);
        else g.ellipse(x, y, 4 + r() * 5, 2.2 + r() * 2.6, r() * 3.14, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (kind === 'orange') {
      for (let i = 0; i < 28; i++) {
        g.fillStyle = `hsl(${28 + r() * 10}, 90%, ${48 + r() * 8}%)`;
        g.beginPath(); g.arc(50 + r() * 156, 50 + r() * 156, 3.5 + r() * 2, 0, Math.PI * 2); g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function railingTexture(color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 6); g.fillRect(0, 56, 256, 5);
  for (let x = 4; x < 256; x += 16) g.fillRect(x, 0, 3, 64);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* a tree crown made of leaf cards scattered through an ellipsoid */
function cardCluster(n, rx, ry, rz, seed) {
  const r = rng(seed), pos = [], nor = [], uv = [];
  const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    let cx, cy, cz;
    do { cx = r() * 2 - 1; cy = r() * 2 - 1; cz = r() * 2 - 1; } while (cx * cx + cy * cy + cz * cz > 1);
    const c = V(cx * rx * 0.72, cy * ry * 0.72, cz * rz * 0.72);
    const s = (0.75 + r() * 0.5) * Math.max(rx, rz) * 0.95;
    e.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
    m.compose(c, q.setFromEuler(e), V(s, s * (ry > rx * 1.5 ? 1.6 : 1), 1));
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    corners.forEach(([a, b], k) => {
      const v = V(a, b, 0).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      const nn = V(v.x / rx, v.y / ry * 0.7 + 0.3, v.z / rz).normalize();
      nor.push(nn.x, nn.y, nn.z);
      uv.push(...uvs[k]);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
/* Norfolk Island pine: whorls of flat branches up a tall trunk (unit height) */
function pineGeometry() {
  const pos = [], nor = [], uv = [];
  const tiers = 13;
  for (let k = 0; k < tiers; k++) {
    const y = 0.22 + k * 0.058, L = 0.2 * (1 - k / (tiers + 1)) + 0.025, w = 0.075;
    for (let j = 0; j < 7; j++) {
      const a = k * 0.7 + j * Math.PI * 2 / 7, dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz * w / 2, pz = dx * w / 2;
      const tip = y - L * 0.25;
      const quad = [[px, y, pz, 0, 0.5 - 0.5], [dx * L + px, tip, dz * L + pz, 1, 0], [dx * L - px, tip, dz * L - pz, 1, 1], [-px, y, -pz, 0, 1]];
      const quadV = [[0, y - w / 2, 0, 0, 0], [dx * L, tip - w / 2, dz * L, 1, 0], [dx * L, tip + w / 2, dz * L, 1, 1], [0, y + w / 2, 0, 0, 1]];
      for (const qd of [quad, quadV]) {
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const [x, yy, z, u, v] = qd[idx];
          pos.push(x, yy, z); nor.push(dx * 0.5, 0.85, dz * 0.5); uv.push(u, v);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
/* a small hatchback, length along +z */
function carGeometries() {
  const body = new THREE.Shape([[-2.08, 0.32], [-2.1, 0.86], [-1.98, 0.98], [-1.72, 1.36], [-1.4, 1.43], [0.32, 1.43], [1.0, 1.0], [1.88, 0.9], [2.08, 0.72], [2.1, 0.34]].map(p => new THREE.Vector2(...p)));
  const bg = new THREE.ExtrudeGeometry(body, { depth: 1.64, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 });
  bg.translate(0, 0, -0.82); bg.rotateY(-Math.PI / 2);
  const gl = new THREE.Shape([[-2.0, 0.99], [-1.75, 1.38], [-1.38, 1.4], [0.36, 1.41], [1.05, 0.99]].map(p => new THREE.Vector2(...p)));
  const gg = new THREE.ExtrudeGeometry(gl, { depth: 1.8, bevelEnabled: false });
  gg.translate(0, 0, -0.9); gg.rotateY(-Math.PI / 2);
  const wg = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 10); wg.rotateZ(Math.PI / 2);
  return { bg, gg, wg };
}

export function groundTexture() {
  const t = tex('tex/city/dry_ground_01.jpg');
  t.repeat.set(700 / 7, 700 / 7);
  return t;
}

export function buildCity(data, group, ground, extras = []) {
  const C = { x: 4.67, z: 7.66 };
  const atlasCanvas = buildAtlas(null, null);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;
  Promise.all([img('tex/city/white_plaster_02.jpg'), img('tex/city/stone_wall.jpg')]).then(([p, s]) => {
    const cv = buildAtlas(p, s);
    atlasCanvas.getContext('2d').drawImage(cv, 0, 0);
    atlas.needsUpdate = true;
  });
  const facadeMat = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ map: tex('tex/city/rough_concrete.jpg'), color: '#c9c9c6', vertexColors: true, roughness: 1 });
  const slabMat = new THREE.MeshStandardMaterial({ map: tex('tex/city/white_plaster_02.jpg'), vertexColors: true, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ map: railingTexture('#f1f1ee'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 });
  const ironMat = new THREE.MeshStandardMaterial({ map: railingTexture('#2a2d2b'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: tex('tex/city/stone_wall.jpg'), roughness: 0.95 });

  const facade = new Acc(), roof = new Acc(), slabs = new Acc(), rails = new Acc(), stoneA = new Acc(), iron = new Acc();
  const pal = ['#fbf9f5', '#f6f0e4', '#fdfcf9', '#f1e8d8', '#f7f1e6', '#f3efe8', '#faf3e8', '#ece6dc', '#f5ead9', '#ffffff', '#ffffff', '#f9f7f2'].map(h => new THREE.Color(h));
  const white = new THREE.Color('#f4f2ee');
  const heaters = [];
  const south = [-data.north[0], -data.north[1]];

  const all = data.buildings.map((b, i) => ({ pts: pairs(b.p), y0: ground, h: b.h, seed: i + 1 })).concat(extras);
  for (const b of all) {
    const pts = b.pts.slice();
    if (signedArea(pts) < 0) pts.reverse();
    const r = rng(b.seed * 7919);
    const floors = b.floors || Math.max(1, Math.round(b.h / STOREY)), st = b.h / floors;
    const blk = b.style ? b.style !== 'house' : floors >= 3;
    const col = b.color ? new THREE.Color(b.color) : pal[Math.floor(r() * pal.length)];
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const near = Math.hypot(cx - C.x, cz - C.z) < 190;
    const lens = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]));
    const order = lens.map((l, i) => i).sort((a, c) => lens[c] - lens[a]);
    const front = new Set(b.front ?? order.slice(0, 2));
    const stairBay = Math.floor(r() * 3);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], L = lens[i];
      if (L < 0.3) return;
      const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L, ox = dz, oz = -dx;   // outward normal
      const n = Math.max(1, Math.round(L / BAY)), bw = L / n;
      const isFront = front.has(i);
      for (let f = 0; f < floors; f++) {
        const y0 = b.y0 + f * st, y1 = y0 + st;
        for (let k = 0; k < n; k++) {
          let cell;
          if (b.style === 'core') cell = 'breeze';
          else if (f === 0 && !b.upperOnly) {
            if (blk) cell = isFront ? (k === Math.floor(n / 2) ? 'entry' : (k % 2 ? 'pilotis' : 'garage')) : (k % 3 === 0 ? 'garage' : 'pilotis');
            else cell = isFront && k === Math.floor(n / 2) ? 'entry' : (k % 2 ? 'houseWin' : 'stone');
          } else if (isFront) cell = blk ? (k % 3 === 1 ? 'win' : 'door') : (k % 2 ? 'win' : 'door');
          else cell = blk && !isFront && k === stairBay && n > 2 && i === order[2] ? 'breeze' : (k % 2 ? 'small' : 'win');
          const a = V(p[0] + dx * k * bw, y0, p[1] + dz * k * bw), c = V(p[0] + dx * (k + 1) * bw, y0, p[1] + dz * (k + 1) * bw);
          facade.quad(c, a, V(a.x, y1, a.z), V(c.x, y1, c.z), cellUv(cell), col);
        }
        // balconies along the front, from the first floor up
        if (isFront && f >= 1 && near && b.style !== 'core' && L > 4 && !b.noBalconies) {
          const s0 = 0.35, len = L - 0.7, dep = 1.25;
          slabs.box(p[0] + dx * s0, p[1] + dz * s0, dx, dz, len, dep, y0 - 0.16, y0 + 0.02, white, 1.5);
          const ex = p[0] + dx * s0 + ox * dep, ez = p[1] + dz * s0 + oz * dep;
          const railH = 1.0, rUv = [[0, 0], [len / 1.6, 0], [len / 1.6, 1], [0, 1]];
          rails.quad(V(ex, y0, ez), V(ex + dx * len, y0, ez + dz * len), V(ex + dx * len, y0 + railH, ez + dz * len), V(ex, y0 + railH, ez), rUv, white);
          for (const s of [0, len]) {
            const bx = p[0] + dx * (s0 + s), bz = p[1] + dz * (s0 + s);
            rails.quad(V(bx, y0, bz), V(bx + ox * dep, y0, bz + oz * dep), V(bx + ox * dep, y0 + railH, bz + oz * dep), V(bx, y0 + railH, bz), [[0, 0], [dep / 1.6, 0], [dep / 1.6, 1], [0, 1]], white);
          }
        }
      }
      // roof parapet
      if (!b.noRoof) {
        const top = b.y0 + b.h;
        facade.box(p[0], p[1], dx, dz, L, -0.2, top, top + 0.85, col, 1, cellUv('plain', 0, 0.3));
      }
    });
    if (!b.noRoof) {
      const top = b.y0 + b.h + 0.02;
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const t of tris) {
        const [a, c, d] = t.map(k => V(pts[k][0], top, pts[k][1]));
        const uvs = [a, c, d].map(v => [v.x / 4, v.z / 4]);
        const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, a));
        if (n.y >= 0) roof.tri(a, c, d, uvs[0], uvs[1], uvs[2], white); else roof.tri(a, d, c, uvs[0], uvs[2], uvs[1], white);
      }
      const area = Math.abs(signedArea(pts));
      if (area > 30) {
        const yaw = Math.atan2(south[0], south[1]);
        const nH = blk ? Math.min(6, Math.max(2, Math.round(area / 70))) : area > 120 ? 2 : 1;
        for (let i = 0; i < nH; i++) {
          const off = (i - (nH - 1) / 2) * 1.4;
          heaters.push([cx + Math.cos(yaw) * off, top, cz - Math.sin(yaw) * off, yaw]);
        }
      }
    }
  }
  for (const [acc, mat] of [[facade, facadeMat], [roof, roofMat], [slabs, slabMat], [rails, railMat]]) {
    const m = acc.mesh(mat);
    if (m) group.add(m);
  }

  /* solar water heaters: tilted collector + white tank, panels facing south */
  const o = new THREE.Object3D();
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.07, 2.0), new THREE.MeshStandardMaterial({ color: '#1e2a3b', roughness: 0.25, metalness: 0.5 }), heaters.length);
  const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.29, 0.29, 1.15, 12), new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.45 }), heaters.length);
  heaters.forEach(([x, y, z, yaw], i) => {
    o.position.set(x, y + 0.75, z); o.rotation.set(0.6, yaw, 0, 'YXZ'); o.scale.set(1, 1, 1); o.updateMatrix(); panels.setMatrixAt(i, o.matrix);
    o.position.set(x - Math.sin(yaw) * 0.95, y + 1.42, z - Math.cos(yaw) * 0.95); o.rotation.set(0, yaw, Math.PI / 2, 'YXZ'); o.updateMatrix(); tanks.setMatrixAt(i, o.matrix);
  });
  group.add(panels, tanks);

  /* ground cover */
  const grass = tex('tex/city/withered_grass.jpg'), asphalt = tex('tex/city/asphalt_02.jpg'), pavers = tex('tex/city/concrete_pavers.jpg');
  const flat = (acc, mat, lift) => {
    mat.polygonOffset = true; mat.polygonOffsetFactor = -lift; mat.polygonOffsetUnits = -lift * 4;
    const m = acc.mesh(mat);
    if (m) group.add(m);
  };
  const areaAcc = { green: new Acc(), parking: new Acc(), pitch: new Acc() };
  for (const a of data.areas) {
    const k = a.k === 'scrub' || a.k === 'dirt' ? 'green' : a.k;
    if (!areaAcc[k] || a.k === 'dirt') continue;
    const pts = pairs(a.p);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const t of tris) {
      const [p, q, s] = t.map(i => V(pts[i][0], ground + 0.02, pts[i][1]));
      const uv = v => [v.x / 6, v.z / 6];
      const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(s, p));
      if (n.y >= 0) areaAcc[k].tri(p, q, s, uv(p), uv(q), uv(s), white); else areaAcc[k].tri(p, s, q, uv(p), uv(s), uv(q), white);
    }
  }
  flat(areaAcc.green, new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1 }), 1);
  flat(areaAcc.parking, new THREE.MeshStandardMaterial({ map: asphalt, vertexColors: true, roughness: 0.95 }), 1);
  flat(areaAcc.pitch, new THREE.MeshStandardMaterial({ color: '#6f9653', vertexColors: true, roughness: 1 }), 1);

  /* streets: pavement, asphalt, dashed centre line */
  const side = new Acc(), road = new Acc(), foot = new Acc(), mark = new Acc();
  const ribbon = (acc, pts, w, y, tileL, tileW, col = white) => {
    const n = pts.length, half = w / 2, Lp = [], Rp = [];
    const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let d1 = unit(p[0] - a[0], p[1] - a[1]), d2 = unit(b[0] - p[0], b[1] - p[1]);
      if (i === 0) d1 = d2;
      if (i === n - 1) d2 = d1;
      const t = unit(d1[0] + d2[0], d1[1] + d2[1]);
      const nx = -t[1], nz = t[0], c = Math.max(0.35, nx * -d1[1] + nz * d1[0]);
      Lp.push([p[0] + nx * half / c, p[1] + nz * half / c]);
      Rp.push([p[0] - nx * half / c, p[1] - nz * half / c]);
    }
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const u0 = s / tileL, u1 = (s + len) / tileL, vw = w / tileW;
      const A = V(Lp[i][0], y, Lp[i][1]), B = V(Rp[i][0], y, Rp[i][1]), Cc = V(Rp[i + 1][0], y, Rp[i + 1][1]), D = V(Lp[i + 1][0], y, Lp[i + 1][1]);
      const uv = [[u0, vw], [u0, 0], [u1, 0], [u1, vw]];
      const nn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Cc, A));
      if (nn.y >= 0) acc.quad(A, B, Cc, D, uv, col); else acc.quad(A, D, Cc, B, [uv[0], uv[3], uv[2], uv[1]], col);
      s += len;
    }
  };
  for (const r of data.roads) {
    const pts = pairs(r.p);
    if (r.k === 'car') {
      ribbon(side, pts, r.w + 3.7, ground + 0.04, 2.5, 2.5);
      ribbon(road, pts, r.w, ground + 0.07, 7, 7);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
        for (let s = 1; s + 2.5 < len; s += 6.5) {
          const t0 = s / len, t1 = (s + 2.5) / len;
          ribbon(mark, [[ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1]], 0.12, ground + 0.1, 3, 1);
        }
      }
    } else ribbon(foot, pts, r.w, ground + 0.05, 2.5, 2.5);
  }
  flat(side, new THREE.MeshStandardMaterial({ map: pavers, vertexColors: true, roughness: 0.95 }), 2);
  flat(foot, new THREE.MeshStandardMaterial({ map: pavers, vertexColors: true, roughness: 0.95 }), 2);
  flat(road, new THREE.MeshStandardMaterial({ map: asphalt, vertexColors: true, roughness: 0.9 }), 3);
  flat(mark, new THREE.MeshStandardMaterial({ color: '#e9e6dc', vertexColors: true, roughness: 0.7 }), 4);

  /* kerbs, and stone garden walls with iron railings and pillars */
  const kerb = new Acc(), kerbCol = new THREE.Color('#b3b0a9');
  for (const [x1, z1, x2, z2] of data.kerbs) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 0.2) continue;
    kerb.box(x1, z1, (x2 - x1) / L, (z2 - z1) / L, L, 0.16, ground + 0.02, ground + 0.17, kerbCol, 0.6);
  }
  const km = kerb.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  if (km) group.add(km);
  const pillarCol = new THREE.Color('#ffffff');
  for (const [x1, z1, x2, z2] of data.walls) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 0.5) continue;
    const dx = (x2 - x1) / L, dz = (z2 - z1) / L;
    stoneA.box(x1, z1, dx, dz, L, 0.24, ground + 0.04, ground + 0.72, pillarCol, 1.6);
    const ox = dz * 0.12, oz = -dx * 0.12;
    iron.quad(V(x1 + ox, ground + 0.72, z1 + oz), V(x2 + ox, ground + 0.72, z2 + oz), V(x2 + ox, ground + 1.55, z2 + oz), V(x1 + ox, ground + 1.55, z1 + oz), [[0, 0], [L / 1.2, 0], [L / 1.2, 1], [0, 1]], pillarCol);
    for (let s = 0; s <= L; s += Math.max(2.4, L / Math.ceil(L / 3.2))) {
      stoneA.box(x1 + dx * s - dx * 0.17, z1 + dz * s - dz * 0.17, dx, dz, 0.34, 0.34, ground + 0.04, ground + 1.65, pillarCol, 1.6);
    }
  }
  const sm = stoneA.mesh(stoneMat); if (sm) group.add(sm);
  const im = iron.mesh(ironMat); if (im) group.add(im);

  /* trees */
  const species = { b: [], o: [], c: [], p: [] };
  for (const t of data.trees) (species[t[3]] || species.b).push(t);
  const total = data.trees.length;
  const bark = new THREE.MeshStandardMaterial({ color: '#5e4c3c', roughness: 1 });
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.13, 1, 7); trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, bark, total);
  const leafMat = kind => new THREE.MeshStandardMaterial({ map: foliage(kind), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
  const crownB = new THREE.InstancedMesh(cardCluster(26, 1, 0.82, 1, 5), leafMat('broad'), species.b.length);
  const crownO = new THREE.InstancedMesh(cardCluster(22, 1, 0.9, 1, 9), leafMat('orange'), species.o.length);
  // cypress: a dense, slightly bulging column, pointed at the top
  const cypTex = foliage('cypress', true); cypTex.wrapS = cypTex.wrapT = THREE.RepeatWrapping; cypTex.repeat.set(3, 5);
  const cypGeo = new THREE.LatheGeometry([[0, -1], [0.3, -0.97], [0.44, -0.75], [0.46, -0.35], [0.42, 0.05], [0.33, 0.45], [0.2, 0.78], [0.07, 0.96], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
  const crownC = new THREE.InstancedMesh(cypGeo, new THREE.MeshStandardMaterial({ map: cypTex, roughness: 0.95 }), species.c.length);
  const crownP = new THREE.InstancedMesh(pineGeometry(), leafMat('pine'), species.p.length);
  const tint = new THREE.Color();
  let ti = 0;
  const place = (x, y, z, sx, sy, sz, rot = 0) => { o.position.set(x, y, z); o.rotation.set(0, rot, 0); o.scale.set(sx, sy, sz); o.updateMatrix(); return o.matrix; };
  species.b.forEach(([x, z, s], i) => {
    const R = 2.4 * s, Ht = 2.6 * s;
    trunks.setMatrixAt(ti++, place(x, ground, z, 1.4 * s, Ht + R * 0.5, 1.4 * s));
    crownB.setMatrixAt(i, place(x, ground + Ht + R * 0.75, z, R, R, R, i * 1.3));
    crownB.setColorAt(i, tint.setHSL(0.15 + (i % 7) * 0.012, 0.25, 0.9 + (i % 5) * 0.025, THREE.SRGBColorSpace));
  });
  species.o.forEach(([x, z, s], i) => {
    const R = 1.5 * s, Ht = 1.1 * s;
    trunks.setMatrixAt(ti++, place(x, ground, z, 1.0 * s, Ht + R * 0.4, 1.0 * s));
    crownO.setMatrixAt(i, place(x, ground + Ht + R * 0.8, z, R, R, R, i * 2.1));
  });
  species.c.forEach(([x, z, s], i) => {
    const Hc = (7 + (i % 5)) * s;
    trunks.setMatrixAt(ti++, place(x, ground, z, 1.2 * s, 1.2 * s, 1.2 * s));
    crownC.setMatrixAt(i, place(x, ground + 0.6 + Hc / 2, z, 1.9 * s, Hc / 2, 1.9 * s, i * 0.9));
  });
  species.p.forEach(([x, z, s], i) => {
    const Hp = (17 + (i % 4) * 2) * s;
    trunks.setMatrixAt(ti++, place(x, ground, z, 2.6 * s, Hp * 0.98, 2.6 * s));
    crownP.setMatrixAt(i, place(x, ground, z, Hp, Hp, Hp, i * 0.8));
  });
  for (const m of [trunks, crownB, crownO, crownC, crownP]) { m.frustumCulled = false; group.add(m); }

  /* parked cars */
  const { bg, gg, wg } = carGeometries();
  const n = data.cars.length;
  const carCols = ['#ecebe7', '#b9bcc0', '#d5d6d6', '#25272b', '#7d1c22', '#2c4566', '#5f6267', '#ecebe7'].map(h => new THREE.Color(h));
  const bodies = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.55 }), n);
  const glassM = new THREE.InstancedMesh(gg, new THREE.MeshStandardMaterial({ color: '#1c2228', roughness: 0.08, metalness: 0.4 }), n);
  const wheels = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.8 }), n * 4);
  const wq = new THREE.Matrix4(), cm = new THREE.Matrix4();
  data.cars.forEach(([x, z, rot, ci], i) => {
    cm.copy(place(x, ground + 0.02, z, 1, 1, 1, rot));
    bodies.setMatrixAt(i, cm); bodies.setColorAt(i, carCols[(ci + i) % carCols.length]);
    glassM.setMatrixAt(i, cm);
    let k = 0;
    for (const sx of [-0.8, 0.8]) for (const sz of [-1.3, 1.36]) {
      wq.makeTranslation(sx, 0.31, sz);
      wheels.setMatrixAt(i * 4 + k++, new THREE.Matrix4().multiplyMatrices(cm, wq));
    }
  });
  group.add(bodies, glassM, wheels);

  /* wooden utility poles with sagging wires */
  const polePts = [];
  for (const chain of data.poles) polePts.push(...pairs(chain));
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 7).translate(0, 4.5, 0), new THREE.MeshStandardMaterial({ color: '#6a5641', roughness: 1 }), polePts.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: '#5b4a39', roughness: 1 }), polePts.length);
  let pi = 0;
  const wire = [];
  for (const chain of data.poles) {
    const pts = pairs(chain);
    pts.forEach(([x, z], i) => {
      const nx = pts[Math.min(i + 1, pts.length - 1)], pv = pts[Math.max(i - 1, 0)];
      const ang = Math.atan2(nx[0] - pv[0], nx[1] - pv[1]);
      poles.setMatrixAt(pi, place(x, ground, z, 1, 1, 1));
      arms.setMatrixAt(pi++, place(x, ground + 8.5, z, 1, 1, 1, ang + Math.PI / 2));
      if (i < pts.length - 1) {
        const [x2, z2] = pts[i + 1];
        for (const off of [-0.6, 0, 0.6]) {
          const ax = Math.cos(ang) * off, az = -Math.sin(ang) * off;
          for (let s = 0; s < 10; s++) {
            const t0 = s / 10, t1 = (s + 1) / 10, sag = t => 0.55 * 4 * t * (1 - t);
            wire.push(x + (x2 - x) * t0 + ax, ground + 8.56 - sag(t0), z + (z2 - z) * t0 + az, x + (x2 - x) * t1 + ax, ground + 8.56 - sag(t1), z + (z2 - z) * t1 + az);
          }
        }
      }
    });
  }
  group.add(poles, arms);
  const wg2 = new THREE.BufferGeometry();
  wg2.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  group.add(new THREE.LineSegments(wg2, new THREE.LineBasicMaterial({ color: '#2b2b2b', transparent: true, opacity: 0.75 })));

  /* the mountain range on the northern horizon (an approximate silhouette, not survey data) */
  const N = data.north, R = 395, pos = [], colr = [];
  const hz = new THREE.Color('#e6e2d8'), rid = new THREE.Color('#97a4b1');
  const rot = deg => { const a = deg * Math.PI / 180; return [N[0] * Math.cos(a) - N[1] * Math.sin(a), N[0] * Math.sin(a) + N[1] * Math.cos(a)]; };
  const elev = b => {
    const e = 0.85 + 1.0 * Math.exp(-(((b - 8) / 26) ** 2)) + 0.9 * Math.exp(-(((b + 44) / 18) ** 2))
      + 0.18 * Math.sin(b * 0.23) + 0.12 * Math.sin(b * 0.61 + 1.3) + 0.06 * Math.sin(b * 1.9);
    return e * Math.min(1, (78 - Math.abs(b)) / 18);
  };
  let prev = null;
  for (let b = -78; b <= 78; b += 1.5) {
    const d = rot(b), top = 1.6 + R * Math.tan(Math.max(0, elev(b)) * Math.PI / 180);
    const cur = [d[0] * R + C.x, ground - 25, d[1] * R + C.z, d[0] * R + C.x, top, d[1] * R + C.z];
    if (prev) {
      pos.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...cur.slice(3), ...prev.slice(0, 3), ...cur.slice(3), ...prev.slice(3));
      colr.push(hz.r, hz.g, hz.b, hz.r, hz.g, hz.b, rid.r, rid.g, rid.b, hz.r, hz.g, hz.b, rid.r, rid.g, rid.b, rid.r, rid.g, rid.b);
    }
    prev = cur;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const ridge = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  ridge.frustumCulled = false;
  group.add(ridge);
}

/* a leafy potted-plant crown for the flat's own plants */
let plantMat = null;
export function plantCrown(radius, seed) {
  plantMat ||= new THREE.MeshStandardMaterial({ map: foliage('broad'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
  const m = new THREE.Mesh(cardCluster(18, radius, radius * 1.15, radius, seed), plantMat);
  m.castShadow = true;
  return m;
}
