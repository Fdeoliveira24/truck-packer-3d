/**
 * @file packs.service.js
 * @description Organization-scoped packs service backed by a repository.
 * @module data/services/packs.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================


import { LocalRepository } from '../repositories/local.repository.js';
import { normalizePack } from '../models/pack.model.js';

const repo = new LocalRepository('packs');

function orgId() {
  if (typeof window !== 'undefined' && window.OrgContext && typeof window.OrgContext.getActiveOrgId === 'function') {
    return window.OrgContext.getActiveOrgId() || 'personal';
  }
  return 'personal';
}

export const PacksService = {
  async getPacks() {
    return repo.findAll({ orgId: orgId() });
  },
  async getPack(id) {
    return repo.find(id, { orgId: orgId() });
  },
  async createPack(data) {
    const p = normalizePack(data);
    return repo.create(p, { orgId: orgId() });
  },
  async updatePack(id, patch) {
    return repo.update(id, patch, { orgId: orgId() });
  },
  async deletePack(id) {
    return repo.delete(id, { orgId: orgId() });
  },
};
