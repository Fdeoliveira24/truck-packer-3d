export function normalizeUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  return {
    id: String(u.id || '').trim() || 'user',
    name: String(u.name || '').trim() || 'User',
    email: String(u.email || '').trim() || '',
    currentOrgId: String(u.currentOrgId || '').trim() || 'personal',
  };
}
