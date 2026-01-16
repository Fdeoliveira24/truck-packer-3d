import { hasRoleAtLeast } from '../config/roles.js';
import { isPlanAtLeast } from '../config/plans.js';

export function getCurrentOrg(session) {
  if (!session) return null;
  if (session.currentOrg) return session.currentOrg;
  const orgId = session.user && session.user.currentOrgId ? session.user.currentOrgId : null;
  const orgs = Array.isArray(session.orgs) ? session.orgs : [];
  return orgs.find(o => o.id === orgId) || orgs[0] || null;
}

export function hasRole(session, requiredRole) {
  const org = getCurrentOrg(session);
  const role = org && org.role ? org.role : 'Viewer';
  return hasRoleAtLeast(role, requiredRole);
}

export function isPlanAtLeastForSession(session, minPlan) {
  const org = getCurrentOrg(session);
  const plan = org && org.plan ? org.plan : 'Guest';
  return isPlanAtLeast(plan, minPlan);
}
