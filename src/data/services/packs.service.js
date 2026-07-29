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

import { getSession } from '../../auth/session.js';
import { LocalRepository } from '../repositories/local.repository.js';
import { normalizePack } from '../models/pack.model.js';
import {
  assertBusinessIdentityValue,
  assertLoadPlanNumberAvailable,
} from '../../core/business-identity.js';

const repo = new LocalRepository('packs');

function orgId() {
  const session = getSession();
  return (session.user && session.user.currentOrgId) || 'personal';
}

export const PacksService = {
  async getPacks() {
    return repo.findAll({ orgId: orgId() });
  },
  async getPack(id) {
    return repo.find(id, { orgId: orgId() });
  },
  async createPack(data) {
    const scope = { orgId: orgId() };
    const existingPacks = await repo.findAll(scope);
    const p = normalizePack(data, existingPacks);
    return repo.create(p, scope);
  },
  async updatePack(id, patch) {
    const scope = { orgId: orgId() };
    const nextPatch = { ...(patch && typeof patch === 'object' ? patch : {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'loadPlanNumber')) {
      const existingPacks = await repo.findAll(scope);
      nextPatch.loadPlanNumber = assertLoadPlanNumberAvailable(nextPatch.loadPlanNumber, existingPacks, {
        excludeId: id,
      });
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'customerReference')) {
      nextPatch.customerReference = assertBusinessIdentityValue(nextPatch.customerReference, {
        field: 'customerReference',
        required: false,
      });
    }
    return repo.update(id, nextPatch, scope);
  },
  async deletePack(id) {
    return repo.delete(id, { orgId: orgId() });
  },
};
