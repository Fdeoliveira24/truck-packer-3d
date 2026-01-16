import { getSession } from '../../auth/session.js';

export const BillingService = {
  getCurrentPlan() {
    const session = getSession();
    return (session.currentOrg && session.currentOrg.plan) || 'Guest';
  },
  getDaysLeftInTrial() {
    const session = getSession();
    const end = session.currentOrg && session.currentOrg.trialEndsAt ? Number(session.currentOrg.trialEndsAt) : 0;
    if (!Number.isFinite(end) || end <= 0) return 0;
    return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  },
  async upgradeToPro() {
    return { ok: false, message: 'Upgrade flow not implemented (Phase 2). Contact sales.' };
  },
};
