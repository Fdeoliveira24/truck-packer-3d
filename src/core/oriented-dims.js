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

// Right-angle rotated components of a unit vector land within float error of
// 0 or ±1 (e.g. cos(π/2) ≈ 6.12e-17), never near this boundary by accident.
const VERTICAL_AXIS_EPSILON = 1e-6;

/**
 * Whether a Case's saved local height axis (+Y) is still parallel to world Y
 * after a right-angle rotation. Both +Y and -Y (an inverted, upside-down
 * pose) count as vertical. This unsigned geometry predicate remains used by
 * legacy runtime orientation policy until C3. New physical permission uses the
 * signed axes below so an inverted pose cannot pass the upright contract.
 * @param {{x?:number,y?:number,z?:number}} rotation radians
 * @returns {boolean}
 */
export function isHeightAxisVertical(rotation = {}) {
  const locked = normalizeRightAngleRotation(rotation);
  const axis = rotateVectorXYZ({ x: 0, y: 1, z: 0 }, locked);
  return Math.abs(axis.x) <= VERTICAL_AXIS_EPSILON && Math.abs(axis.z) <= VERTICAL_AXIS_EPSILON;
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

/**
 * Strict C1 orientation representation: authored axes mapped to world axes.
 * Accept only complete finite right-angle poses (within floating point noise).
 * Unlike the legacy normalizer, this never invents identity or rounds an
 * unsupported pose into a supported one. Equivalent XYZ Euler encodings yield
 * the same signed axes, including on equal-sided Cases.
 */
export function getPhysicalOrientationAxes(rotation) {
  if (!rotation || typeof rotation !== 'object' || Array.isArray(rotation) ||
      !['x', 'y', 'z'].every(axis => {
        const value = rotation[axis];
        return typeof value === 'number' && Number.isFinite(value) &&
          Math.abs(value - Math.round(value / RIGHT_ANGLE_RAD) * RIGHT_ANGLE_RAD) <= VERTICAL_AXIS_EPSILON;
      })) {
    return { value: undefined, valid: false };
  }
  const exactAxis = vector => {
    const axis = rotateVectorXYZ(vector, rotation);
    return { x: Math.round(axis.x) || 0, y: Math.round(axis.y) || 0, z: Math.round(axis.z) || 0 };
  };
  return {
    value: {
      x: exactAxis({ x: 1, y: 0, z: 0 }),
      y: exactAxis({ x: 0, y: 1, z: 0 }),
      z: exactAxis({ x: 0, y: 0, z: 1 }),
    },
    valid: true,
  };
}

/**
 * Physical dimensions use only Case dimensions and ACTUAL rotation. Planning
 * locks/profiles and persisted orientedDims have no authority here. No source
 * writes and no fallback geometry. The signed-axis permutation preserves the
 * source dimension precision without applying display rounding.
 */
export function getActualPoseDimensions(caseData, instance) {
  const dimensions = caseData?.dimensions;
  const axes = getPhysicalOrientationAxes(instance?.transform?.rotation);
  if (!dimensions || !['length', 'width', 'height'].every(key =>
    typeof dimensions[key] === 'number' && Number.isFinite(dimensions[key]) && dimensions[key] > 0
  ) || !axes.valid) return { value: undefined, valid: false };
  const extent = axis => Math.abs(axes.value.x[axis]) * dimensions.length +
    Math.abs(axes.value.y[axis]) * dimensions.height + Math.abs(axes.value.z[axis]) * dimensions.width;
  return {
    value: { length: extent('x'), width: extent('z'), height: extent('y') },
    valid: true,
  };
}
