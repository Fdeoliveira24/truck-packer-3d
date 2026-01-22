/**
 * @file analytics.service.js
 * @description Analytics tracking service (feature-gated; provider integration to be added later).
 * @module data/services/analytics.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { canUseFeature } from '../../config/features.js';
import { getSession } from '../../auth/session.js';

export const AnalyticsService = {
  track(event, properties = {}) {
    const session = getSession();
    if (!canUseFeature('ANALYTICS', session)) return;
    console.log('[Analytics]', String(event || 'event'), properties);
  },
};
