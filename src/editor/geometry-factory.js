/**
 * @file geometry-factory.js
 * @description Factory for creating THREE.js geometries based on case shape type.
 * @module editor/geometry-factory
 * @created 02/07/2026
 * @author Truck Packer 3D Team
 */

/**
 * Creates a THREE.js geometry based on case shape.
 * @param {object} caseData - Case data with shape and dimensions
 * @param {function} toWorld - Function to convert inches to world units
 * @returns {any} The geometry for the case
 */
export function createCaseGeometry(caseData, toWorld) {
    const dims = caseData.dimensions || { length: 1, width: 1, height: 1 };
    const lW = toWorld(dims.length);
    const wW = toWorld(dims.width);
    const hW = toWorld(dims.height);
    const shape = (caseData.shape || 'box').toLowerCase();

    if (shape === 'cylinder' || shape === 'drum') {
        // For cylinders: width and height define the circular cross-section
        const radius = Math.min(wW, hW) / 2;
        const geo = new THREE.CylinderGeometry(radius, radius, lW, 24);
        // Rotate to lay on side (length along X axis, matching box orientation)
        geo.rotateZ(Math.PI / 2);
        return geo;
    }

    // Default: box geometry
    return new THREE.BoxGeometry(lW, hW, wW);
}

/**
 * Calculate volume in cubic inches, accounting for shape.
 * @param {object} dims - Dimensions {length, width, height} in inches
 * @param {string} shape - Shape type ('box', 'cylinder', 'drum')
 * @returns {number} Volume in cubic inches
 */
export function volumeForShape(dims, shape = 'box') {
    const { length, width, height } = dims;
    const l = Number(length) || 0;
    const w = Number(width) || 0;
    const h = Number(height) || 0;

    if (shape === 'cylinder' || shape === 'drum') {
        // Cylinder: circular cross-section uses smaller of width/height as diameter
        const radius = Math.min(w, h) / 2;
        return Math.PI * radius * radius * l;
    }

    return Math.max(0, l * w * h);
}
