/** Column-major mat4, the layout WebGL wants. */

export function perspective(fovyDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovyDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / Math.max(aspect, 1e-4);
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(eye: readonly number[], target: readonly number[], up: readonly number[]): Float32Array {
  const z0 = (eye[0] ?? 0) - (target[0] ?? 0);
  const z1 = (eye[1] ?? 0) - (target[1] ?? 0);
  const z2 = (eye[2] ?? 0) - (target[2] ?? 0);
  let zl = Math.hypot(z0, z1, z2) || 1;
  const zx = z0 / zl;
  const zy = z1 / zl;
  const zz = z2 / zl;
  const ux = up[0] ?? 0;
  const uy = up[1] ?? 1;
  const uz = up[2] ?? 0;
  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) {
    xx = 1;
    xy = 0;
    xz = 0;
    xl = 1;
  }
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const out = new Float32Array(16);
  // The camera axes are the rows of the rotation; column-major puts each row across columns.
  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * (eye[0] ?? 0) + xy * (eye[1] ?? 0) + xz * (eye[2] ?? 0));
  out[13] = -(yx * (eye[0] ?? 0) + yy * (eye[1] ?? 0) + yz * (eye[2] ?? 0));
  out[14] = -(zx * (eye[0] ?? 0) + zy * (eye[1] ?? 0) + zz * (eye[2] ?? 0));
  out[15] = 1;
  return out;
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        (a[row] ?? 0) * (b[col * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[col * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

export function camera(
  tx: number,
  ty: number,
  tz: number,
  fov: number,
  aspect: number,
  target: readonly number[] = [0, 0, 0],
): { view: Float32Array; viewProj: Float32Array } {
  // An eye on its own target has no direction; look down -z instead of dividing by zero.
  const same = Math.hypot(tx - (target[0] ?? 0), ty - (target[1] ?? 0), tz - (target[2] ?? 0)) < 1e-6;
  const view = lookAt([tx, ty, tz], same ? [tx, ty, tz - 1] : target, [0, 1, 0]);
  const proj = perspective(fov, aspect, 0.05, 100);
  return { view, viewProj: multiply(proj, view) };
}

export function orbitCamera(yaw: number, pitch: number, dist: number, fov: number, aspect: number): { view: Float32Array; viewProj: Float32Array } {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const d = Math.max(0.2, dist);
  return camera(sy * cp * d, sp * d, cy * cp * d, fov, aspect);
}
