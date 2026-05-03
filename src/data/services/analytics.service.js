/**
 * @file analytics.service.js
 * @description Analytics tracking service (feature-gated; provider integration to be added later).
 * @module data/services/analytics.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// This analytics service is dormant and not imported by the current runtime. Do
// not use it for access gating. If analytics is implemented later, paid access
// checks must use the entitlement billing path.

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
