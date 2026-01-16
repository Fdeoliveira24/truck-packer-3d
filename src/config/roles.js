export const ROLE_HIERARCHY = {
  Viewer: 0,
  Member: 1,
  Manager: 2,
  Owner: 3,
};

export function hasRoleAtLeast(role, minRole) {
  const a = ROLE_HIERARCHY[String(role || 'Viewer')] ?? 0;
  const b = ROLE_HIERARCHY[String(minRole || 'Viewer')] ?? 0;
  return a >= b;
}
