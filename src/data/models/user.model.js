/**
 * @file user.model.js
 * @description User data model normalization.
 * @module data/models/user.model
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function normalizeUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  return {
    id: String(u.id || '').trim() || 'user',
    name: String(u.name || '').trim() || 'User',
    email: String(u.email || '').trim() || '',
    currentOrgId: String(u.currentOrgId || '').trim() || 'personal',
  };
}
