const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_ID_RE = /^(cus|sub)_([A-Za-z0-9]{6,})$/;
const EMAIL_RE = /^([^@\s]+)@([^@\s]+)$/;

export function maskProjectRef(value) {
  if (typeof value !== 'string' || !PROJECT_REF_RE.test(value)) return '[invalid-project-ref]';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function maskUuid(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return '[invalid-uuid]';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export const maskUserId = maskUuid;

export function maskStripeId(value) {
  if (typeof value !== 'string') return '[invalid-stripe-id]';
  const match = value.match(STRIPE_ID_RE);
  if (!match) return '[invalid-stripe-id]';
  return `${match[1]}_${match[2].slice(0, 4)}…${match[2].slice(-4)}`;
}

export function maskEmail(value) {
  if (typeof value !== 'string') return '[invalid-email]';
  const match = value.match(EMAIL_RE);
  if (!match) return '[invalid-email]';
  const [domainName, ...domainSuffixParts] = match[2].split('.');
  if (!domainName || domainSuffixParts.length === 0 || domainSuffixParts.some(part => !part)) {
    return '[invalid-email]';
  }
  return `${match[1].slice(0, 1)}***@${domainName.slice(0, 1)}***.${domainSuffixParts.at(-1)}`;
}

export function redactSecret() {
  return '[redacted]';
}
