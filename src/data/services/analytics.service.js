import { canUseFeature } from '../../config/features.js';
import { getSession } from '../../auth/session.js';

export const AnalyticsService = {
  track(event, properties = {}) {
    const session = getSession();
    if (!canUseFeature('ANALYTICS', session)) return;
    console.log('[Analytics]', String(event || 'event'), properties);
  },
};
