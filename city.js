// The real neighbourhood, from OpenStreetMap (© OpenStreetMap contributors, ODbL),
// baked into plan metres by the build script. Trees and parked cars are placed, not mapped.
import * as THREE from 'three';

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
const srgb = hex => new THREE.Color(hex);
const BAY = 3.4, STOREY = 3.2;

export function facadeTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e2ddd4'; g.fillRect(0, 117, 128, 11);   // slab edge
  g.fillStyle = '#d6d0c6'; g.fillRect(28, 24, 72, 70);    // frame
  g.fillStyle = '#46515c'; g.fillRect(32, 28, 64, 62);    // glass
  g.fillStyle = '#6d7985'; g.fillRect(32, 28, 64, 16);    // sky in the glass
  g.fillStyle = '#d6d0c6'; g.fillRect(62, 28, 4, 62);     // mullion
  g.fillStyle = '#c9c2b6'; g.fillRect(24, 94, 80, 5);     // sill
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ribbon(out, pts, w, y) {
  const n = pts.length, half = w / 2, L = [], R = [];
  const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d1 = unit(p[0] - a[0], p[1] - a[1]), d2 = unit(b[0] - p[0], b[1] - p[1]);
    if (i === 0) d1 = d2;
    if (i === n - 1) d2 = d1;
    const t = unit(d1[0] + d2[0], d1[1] + d2[1]);
    const nx = -t[1], nz = t[0];
    const c = Math.max(0.35, nx * -d1[1] + nz * d1[0]);
    L.push([p[0] + nx * half / c, p[1] + nz * half / c]);
    R.push([p[0] - nx * half / c, p[1] - nz * half / c]);
  }
  for (let i = 0; i < n - 1; i++) {
    out.push(L[i][0], y, L[i][1], R[i][0], y, R[i][1], R[i + 1][0], y, R[i + 1][1]);
    out.push(L[i][0], y, L[i][1], R[i + 1][0], y, R[i + 1][1], L[i + 1][0], y, L[i + 1][1]);
  }
}
function flatMesh(pos, color, lift, group) {
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 1, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -lift, polygonOffsetUnits: -lift * 4,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function buildCity(data, group, ground) {
  /* buildings: walls with a window rhythm, flat roofs */
  const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTexture(), vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const pal = ['#f2ede3', '#ebe3d4', '#f5f2eb', '#e4dbcc', '#efe6d8', '#e9e3d9', '#f3e8d8', '#ddd6cb', '#efe1cf'].map(srgb);
  const roofPal = ['#cfccc5', '#c7c3bb', '#d6d2ca', '#bfbab1'].map(srgb);
  const wp = [], wu = [], wc = [], rp = [], rc = [], roofs = [];
  data.buildings.forEach((b, bi) => {
    const pts = pairs(b.p);
    if (signedArea(pts) < 0) pts.reverse();
    const col = pal[bi % pal.length], rcol = roofPal[bi % roofPal.length];
    const y0 = ground, y1 = ground + b.h, v1 = b.h / STOREY;
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1), u0 = u / BAY, u1 = (u + len) / BAY;
      wp.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y0, z1, x2, y1, z2, x1, y1, z1);
      wu.push(u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1);
      for (let k = 0; k < 6; k++) wc.push(col.r, col.g, col.b);
      u += len;
    }
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const t of tris) for (const k of t) { rp.push(pts[k][0], y1, pts[k][1]); rc.push(rcol.r, rcol.g, rcol.b); }
    roofs.push({ pts, y: y1, h: b.h, area: Math.abs(signedArea(pts)) });
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  wg.computeVertexNormals();
  const walls = new THREE.Mesh(wg, facadeMat);
  walls.receiveShadow = true;
  group.add(walls);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rg.computeVertexNormals();
  group.add(new THREE.Mesh(rg, roofMat));

  /* solar water heaters on the roofs, panels facing south */
  const south = [-data.north[0], -data.north[1]];
  const yaw = Math.atan2(south[0], south[1]);
  const inside = (x, z, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [x1, z1] = P[i], [x2, z2] = P[j];
      if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) c = !c;
    }
    return c;
  };
  const spots = [];
  for (const r of roofs) {
    if (r.area < 30) continue;
    const cx = r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length, cz = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
    const n = r.h > 9 ? 3 : r.area > 120 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 1.5;
      const x = cx + Math.cos(yaw) * off, z = cz - Math.sin(yaw) * off;
      if (inside(x, z, r.pts)) spots.push([x, r.y, z]);
    }
  }
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.05, 2.0), new THREE.MeshStandardMaterial({ color: '#25344a', roughness: 0.3, metalness: 0.4 }), spots.length);
  const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 1.15, 10), new THREE.MeshStandardMaterial({ color: '#e7e6e1', roughness: 0.5 }), spots.length);
  const o = new THREE.Object3D();
  spots.forEach(([x, y, z], i) => {
    o.position.set(x, y + 0.75, z); o.rotation.set(0.6, yaw, 0, 'YXZ'); o.scale.set(1, 1, 1); o.updateMatrix();
    panels.setMatrixAt(i, o.matrix);
    o.position.set(x - Math.sin(yaw) * 0.95, y + 1.45, z - Math.cos(yaw) * 0.95); o.rotation.set(0, yaw, Math.PI / 2, 'YXZ'); o.updateMatrix();
    tanks.setMatrixAt(i, o.matrix);
  });
  group.add(panels, tanks);

  /* ground cover: parks, pitches, car parks, empty plots */
  const areaCol = { green: '#86935f', pitch: '#5f8c4c', parking: '#8e8d88', dirt: '#c4b493', scrub: '#a29f72' };
  const areaPos = {};
  for (const a of data.areas) {
    const pts = pairs(a.p);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const arr = (areaPos[a.k] ||= []);
    for (const t of tris) for (const k of t) arr.push(pts[k][0], ground + 0.02, pts[k][1]);
  }
  for (const k in areaPos) flatMesh(areaPos[k], areaCol[k], 1, group);

  /* streets: pavement, asphalt, centre lines */
  const side = [], road = [], foot = [], track = [], mark = [];
  for (const r of data.roads) {
    const pts = pairs(r.p);
    if (r.k === 'car') {
      ribbon(side, pts, r.w + 3.4, ground + 0.04);
      ribbon(road, pts, r.w, ground + 0.07);
      if (r.major) {
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const len = Math.hypot(bx - ax, bz - az);
          for (let s = 1; s + 3 < len; s += 7) {
            const t0 = s / len, t1 = (s + 3) / len;
            ribbon(mark, [[ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1]], 0.14, ground + 0.1);
          }
        }
      }
    } else ribbon(r.k === 'track' ? track : foot, pts, r.w, ground + 0.05);
  }
  flatMesh(side, '#cdc7bb', 2, group);
  flatMesh(foot, '#d8d1c3', 2, group);
  flatMesh(track, '#bba98a', 2, group);
  flatMesh(road, '#58595b', 3, group);
  flatMesh(mark, '#ebe8de', 4, group);

  /* trees: broadleaf and cypress */
  const broad = [], cyp = [];
  data.trees.forEach((t, i) => ((i * 7919) % 100 < 17 ? cyp : broad).push(t));
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b5a48', roughness: 1 }), broad.length + cyp.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), broad.length);
  const coneGeo = new THREE.ConeGeometry(1, 1, 8); coneGeo.translate(0, 0.5, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), cyp.length);
  const c = new THREE.Color();
  let ti = 0;
  broad.forEach(([x, z, s], i) => {
    o.rotation.set(0, i * 1.7, 0); o.position.set(x, ground, z); o.scale.set(s, 2.3 * s, s); o.updateMatrix(); trunks.setMatrixAt(ti++, o.matrix);
    o.position.set(x, ground + 3.4 * s, z); o.scale.set(2.0 * s, 1.55 * s, 2.0 * s); o.updateMatrix(); crowns.setMatrixAt(i, o.matrix);
    crowns.setColorAt(i, c.setHSL(0.2 + ((i * 37) % 9) / 100, 0.28 + ((i * 13) % 10) / 100, 0.24 + ((i * 7) % 8) / 100, THREE.SRGBColorSpace));
  });
  cyp.forEach(([x, z, s], i) => {
    o.rotation.set(0, 0, 0); o.position.set(x, ground, z); o.scale.set(0.8 * s, 0.9 * s, 0.8 * s); o.updateMatrix(); trunks.setMatrixAt(ti++, o.matrix);
    o.position.set(x, ground + 0.6 * s, z); o.scale.set(0.85 * s, 7.5 * s, 0.85 * s); o.updateMatrix(); cones.setMatrixAt(i, o.matrix);
    cones.setColorAt(i, c.setHSL(0.3, 0.3, 0.16 + ((i * 7) % 6) / 100, THREE.SRGBColorSpace));
  });
  group.add(trunks, crowns, cones);

  /* parked cars */
  const carCols = ['#e8e8e5', '#b8bbbf', '#2a2c30', '#8b2224', '#2e4a6a', '#6c6f73'].map(srgb);
  const n = data.cars.length;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.76, 0.62, 4.25), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), n);
  const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.56, 0.55, 2.25), new THREE.MeshStandardMaterial({ color: '#2b3138', roughness: 0.15, metalness: 0.3 }), n);
  const under = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.42, 3.4), new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 }), n);
  data.cars.forEach(([x, z, rot, ci], i) => {
    o.rotation.set(0, rot, 0); o.scale.set(1, 1, 1);
    o.position.set(x, ground + 0.72, z); o.updateMatrix(); body.setMatrixAt(i, o.matrix); body.setColorAt(i, carCols[ci % carCols.length]);
    o.position.set(x - Math.sin(rot) * 0.2, ground + 1.3, z - Math.cos(rot) * 0.2); o.updateMatrix(); cabin.setMatrixAt(i, o.matrix);
    o.position.set(x, ground + 0.24, z); o.updateMatrix(); under.setMatrixAt(i, o.matrix);
  });
  group.add(body, cabin, under);

  /* the mountain range on the northern horizon (an approximate silhouette, not survey data) */
  const N = data.north, R = 395, pos = [], col = [];
  const hz = srgb('#e6e2d8'), rid = srgb('#9aa7b3');
  const rot = (deg) => { const a = deg * Math.PI / 180; return [N[0] * Math.cos(a) - N[1] * Math.sin(a), N[0] * Math.sin(a) + N[1] * Math.cos(a)]; };
  const elev = b => {
    const e = 0.85 + 1.0 * Math.exp(-(((b - 8) / 26) ** 2)) + 0.9 * Math.exp(-(((b + 44) / 18) ** 2))
      + 0.18 * Math.sin(b * 0.23) + 0.12 * Math.sin(b * 0.61 + 1.3) + 0.06 * Math.sin(b * 1.9);
    return e * Math.min(1, (78 - Math.abs(b)) / 18);
  };
  let prev = null;
  for (let b = -78; b <= 78; b += 1.5) {
    const d = rot(b), top = 1.6 + R * Math.tan(Math.max(0, elev(b)) * Math.PI / 180);
    const cur = [d[0] * R + 4.7, ground - 25, d[1] * R + 7.7, d[0] * R + 4.7, top, d[1] * R + 7.7];
    if (prev) {
      pos.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...cur.slice(3), ...prev.slice(0, 3), ...cur.slice(3), ...prev.slice(3));
      col.push(hz.r, hz.g, hz.b, hz.r, hz.g, hz.b, rid.r, rid.g, rid.b, hz.r, hz.g, hz.b, rid.r, rid.g, rid.b, rid.r, rid.g, rid.b);
    }
    prev = cur;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const ridge = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  ridge.frustumCulled = false;
  ridge.renderOrder = -0.5;
  group.add(ridge);
}
