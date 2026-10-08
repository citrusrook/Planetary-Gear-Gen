// Binary STL writer. items: [{body:{pos,idx}, x, y, rot}] (rot about z, then translate)
export function writeSTL(items, header = "PlanetaryBearing") {
  let nt = 0;
  for (const it of items) nt += it.body.idx.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf);
  const h = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(h);
  dv.setUint32(80, nt, true);
  let o = 84;
  const v = new Float64Array(9);
  for (const it of items) {
    const { pos: P, idx: I } = it.body;
    const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0), tx = it.x || 0, ty = it.y || 0;
    for (let k = 0; k < I.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        const q = I[k + j] * 3, x = P[q], y = P[q + 1];
        v[j * 3] = c * x - s * y + tx; v[j * 3 + 1] = s * x + c * y + ty; v[j * 3 + 2] = P[q + 2];
      }
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
      const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true);
      o += 12;
      for (let j = 0; j < 9; j++) { dv.setFloat32(o, v[j], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}
