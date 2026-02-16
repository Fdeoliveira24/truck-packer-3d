/**
 * @file cog-service.js
 * @description Center of Gravity calculation service for pack contents.
 * @module services/cog-service
 * @created 02/07/2026
 * @author Truck Packer 3D Team
 */

/**
 * Computes the center of gravity for a pack.
 * @param {object} pack - Pack object with truck and cases
 * @param {object[]} caseLibrary - Array of case definitions
 * @returns {object|null} CoG data or null if no valid weight
 */
export function computeCoG(pack, caseLibrary) {
    if (!pack || !pack.cases || !pack.truck) return null;

    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let weightedZ = 0;

    const caseMap = new Map(caseLibrary.map(c => [c.id, c]));

    pack.cases.forEach(inst => {
        if (inst.hidden) return;
        const caseData = caseMap.get(inst.caseId);
        if (!caseData) return;
        const w = Number(caseData.weight) || 0;
        if (w <= 0) return;

        const pos = inst.transform?.position || { x: 0, y: 0, z: 0 };
        totalWeight += w;
        weightedX += pos.x * w;
        weightedY += pos.y * w;
        weightedZ += pos.z * w;
    });

    if (totalWeight <= 0) return null;

    const cogX = weightedX / totalWeight;
    const cogY = weightedY / totalWeight;
    const cogZ = weightedZ / totalWeight;

    // Container center (cargo positioned from 0 to length along X, centered on Z)
    const centerX = pack.truck.length / 2;
    const _centerZ = 0; // eslint: Z center always 0 for symmetric trailers

    // Deviation as percentage of container dimension
    const deviationX = ((cogX - centerX) / pack.truck.length) * 100;
    const deviationZ = pack.truck.width > 0 ? (cogZ / (pack.truck.width / 2)) * 100 : 0;

    const absDevX = Math.abs(deviationX);
    const absDevZ = Math.abs(deviationZ);
    const withinTolerance = absDevX <= 10 && absDevZ <= 10;

    let status = 'ok';
    if (!withinTolerance) {
        status = absDevX <= 15 && absDevZ <= 15 ? 'warning' : 'critical';
    }

    return {
        position: { x: cogX, y: cogY, z: cogZ },
        deviationPercent: { x: deviationX, z: deviationZ },
        totalWeight,
        withinTolerance,
        status,
    };
}

/**
 * Gets CoG status color for visualization.
 * @param {string} status - 'ok', 'warning', or 'critical'
 * @returns {number} THREE.js color hex value
 */
export function getCoGStatusColor(status) {
    switch (status) {
        case 'ok':
            return 0x00ff00; // green
        case 'warning':
            return 0xffaa00; // yellow/orange
        case 'critical':
            return 0xff0000; // red
        default:
            return 0x888888; // gray
    }
}
