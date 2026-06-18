/**
 * @file oriented-dims.js
 * @description Single source of truth for right-angle oriented (effective) cargo
 *   dimensions. The math here is intentionally identical to THREE.js Euler order
 *   'XYZ' so that stored/restored dimensions agree with the runtime 3D scene.
 *
 *   THREE.js Euler order 'XYZ' builds the rotation matrix R = Rx * Ry * Rz.
 *   Applied to a vector v this is R*v = Rx * (Ry * (Rz * v)), i.e. the effective
 *   vector-transform order is Z first, then Y, then X. Applying the right-angle
 *   axis swaps in X -> Y -> Z order (the historical bug) computes Rz * Ry * Rx
 *   instead, which only agrees for single-axis rotations and diverges for every
 *   compound rotation. All oriented-dimension math in the app must route through
 *   this module so manual placement, AutoPack, normalization, import, restore,
 *   Stats, collision and out-of-gauge checks stay consistent with each other and
 *   with THREE.
 *
 * @module core/oriented-dims
 * @author Truck Packer 3D Team
 */

export const RIGHT_ANGLE_RAD = Math.PI / 2;

/**
 * Quantize an arbitrary radian value to the nearest right angle in [0, 2π).
 * Handles negative angles and angles above 360°.
 * @param {number} value radians
 * @returns {number} one of 0, π/2, π, 3π/2
 */
export function normalizeRightAngle(value) {
  const raw = Number(value) || 0;
  let turns = Math.round(raw / RIGHT_ANGLE_RAD) % 4;
  if (turns < 0) turns += 4;
  return turns * RIGHT_ANGLE_RAD;
}

/**
 * Quantize a {x,y,z} radian rotation to right angles.
 * @param {{x?:number,y?:number,z?:number}} rotation
 * @returns {{x:number,y:number,z:number}}
 */
export function normalizeRightAngleRotation(rotation = {}) {
  return {
    x: normalizeRightAngle(rotation.x),
    y: normalizeRightAngle(rotation.y),
    z: normalizeRightAngle(rotation.z),
  };
}

/**
 * Rotate a vector exactly as THREE.js Euler order 'XYZ' would (R = Rx*Ry*Rz),
 * which means applying Rz first, then Ry, then Rx.
 * @param {{x:number,y:number,z:number}} vec
 * @param {{x?:number,y?:number,z?:number}} rotation radians
 * @returns {{x:number,y:number,z:number}}
 */
export function rotateVectorXYZ(vec, rotation) {
  let x = vec.x;
  let y = vec.y;
  let z = vec.z;
  const rx = normalizeRightAngle(rotation.x);
  const ry = normalizeRightAngle(rotation.y);
  const rz = normalizeRightAngle(rotation.z);

  // Apply Z first (THREE Euler 'XYZ' => matrix Rx*Ry*Rz => Rz acts on v first).
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const xz = x * cosZ - y * sinZ;
  const yz = x * sinZ + y * cosZ;
  x = xz;
  y = yz;

  // Apply Y second.
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const xy = x * cosY + z * sinY;
  const zy = -x * sinY + z * cosY;
  x = xy;
  z = zy;

  // Apply X last.
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const yx = y * cosX - z * sinX;
  const zx = y * sinX + z * cosX;
  return { x, y: yx, z: zx };
}

/**
 * Effective (oriented) bounding-box dimensions of an axis-aligned case after a
 * right-angle rotation, matching THREE.js Euler order 'XYZ'. The case's
 * length runs along world X, height along world Y, width along world Z.
 *
 * @param {{length?:number,width?:number,height?:number}} dimensions
 * @param {{x?:number,y?:number,z?:number}} rotation radians
 * @returns {{length:number,width:number,height:number}}
 */
export function getOrientedDimsForRotation(dimensions = {}, rotation = {}) {
  const length = Math.max(0, Number(dimensions.length) || 0);
  const width = Math.max(0, Number(dimensions.width) || 0);
  const height = Math.max(0, Number(dimensions.height) || 0);
  const locked = normalizeRightAngleRotation(rotation);
  const axes = [
    rotateVectorXYZ({ x: length, y: 0, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: height, z: 0 }, locked),
    rotateVectorXYZ({ x: 0, y: 0, z: width }, locked),
  ];
  const out = axes.reduce(
    (acc, axis) => ({
      length: acc.length + Math.abs(axis.x),
      height: acc.height + Math.abs(axis.y),
      width: acc.width + Math.abs(axis.z),
    }),
    { length: 0, width: 0, height: 0 }
  );
  return {
    length: Math.round(out.length * 1e6) / 1e6,
    width: Math.round(out.width * 1e6) / 1e6,
    height: Math.round(out.height * 1e6) / 1e6,
  };
}
