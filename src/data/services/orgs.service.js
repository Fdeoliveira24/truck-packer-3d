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
