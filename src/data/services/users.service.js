/**
 * @file users.service.js
 * @description User service helpers for the current session user.
 * @module data/services/users.service
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { getSession } from '../../auth/session.js';

export const UsersService = {
  getCurrentUser() {
    const session = getSession();
    return session.user;
  },
};
