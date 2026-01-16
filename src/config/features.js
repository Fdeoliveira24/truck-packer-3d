import { isPlanAtLeast } from './plans.js';

export const FEATURES = {
  PDF_EXPORT: { minPlan: 'Pro', roles: ['Owner', 'Manager'] },
  CSV_IMPORT: { minPlan: 'Trial', roles: ['Owner', 'Manager', 'Member'] },
  AUTOPACK: { minPlan: 'Pro', roles: ['Owner', 'Manager'] },
  COLLABORATION: { minPlan: 'Enterprise', roles: ['Owner', 'Manager'] },
  ANALYTICS: { minPlan: 'Pro', roles: ['Owner'] },
  MODEL_IMPORT: { minPlan: 'Pro', roles: ['Owner', 'Manager'] },
};

export function canUseFeature(featureKey, session) {
  const feature = FEATURES[featureKey];
  if (!feature) return true;

  const currentOrg = session && session.currentOrg ? session.currentOrg : null;
  const role = currentOrg && currentOrg.role ? currentOrg.role : 'Viewer';
  const plan = currentOrg && currentOrg.plan ? currentOrg.plan : 'Guest';

  const okRole = Array.isArray(feature.roles) ? feature.roles.includes(role) : true;
  const okPlan = isPlanAtLeast(plan, feature.minPlan);
  return okRole && okPlan;
}
