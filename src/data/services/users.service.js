import { getSession } from '../../auth/session.js';

export const UsersService = {
  getCurrentUser() {
    const session = getSession();
    return session.user;
  },
};
