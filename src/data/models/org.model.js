export function normalizeOrg(org) {
  const o = org && typeof org === 'object' ? org : {};
  const id = String(o.id || '').trim() || 'org';
  const type = o.type === 'personal' ? 'personal' : 'organization';
  const name = String(o.name || '').trim() || (type === 'personal' ? 'Personal Account' : 'Organization');
  const role = String(o.role || 'Viewer');
  const plan = String(o.plan || 'Guest');
  const trialEndsAt = Number(o.trialEndsAt || 0);
  return { id, type, name, role, plan, trialEndsAt };
}
