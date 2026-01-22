/**
 * @file cases.service.js
 * @description Organization-scoped cases service backed by a repository.
 * @module data/services/cases.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { getSession } from '../../auth/session.js';
import { LocalRepository } from '../repositories/local.repository.js';
import { normalizeCase } from '../models/case.model.js';

const repo = new LocalRepository('cases');

function orgId() {
  const session = getSession();
  return (session.user && session.user.currentOrgId) || 'personal';
}

export const CasesService = {
  async getCases() {
    return repo.findAll({ orgId: orgId() });
  },
  async getCase(id) {
    return repo.find(id, { orgId: orgId() });
  },
  async createCase(data) {
    const c = normalizeCase(data);
    return repo.create(c, { orgId: orgId() });
  },
  async updateCase(id, patch) {
    return repo.update(id, patch, { orgId: orgId() });
  },
  async deleteCase(id) {
    return repo.delete(id, { orgId: orgId() });
  },
};
