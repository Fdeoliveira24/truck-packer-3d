/**
 * @file orgs.service.js
 * @description Organization/session helper service for multi-tenant context switching.
 * @module data/services/orgs.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { createOrganization, getSession, setCurrentOrgId } from '../../auth/session.js';

export const OrgsService = {
  getOrgs() {
    const session = getSession();
    return Array.isArray(session.orgs) ? session.orgs : [];
  },
  getCurrentOrg() {
    const session = getSession();
    return session.currentOrg;
  },
  switchOrg(orgId) {
    return setCurrentOrgId(orgId);
  },
  createOrg({ name }) {
    return createOrganization({ name });
  },
};
