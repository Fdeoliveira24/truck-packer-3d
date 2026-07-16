import { createHash } from 'node:crypto';

const ORIGIN = 'http://localhost:5500';
const REST_PAGE_SIZE = 1000;

export class DevelopmentFixtureRequestError extends Error {
  constructor(message, { status = 0, code = 'request_failed', body = null } = {}) {
    super(message);
    this.name = 'DevelopmentFixtureRequestError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: 'non_json_response' };
  }
}

export function createDevelopmentApi(config, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const baseUrl = config.supabaseUrl.replace(/\/$/, '');
  const functionsUrl = `https://${config.projectRef}.functions.supabase.co`;
  const serviceHeaders = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };

  async function request(url, options = {}) {
    const response = await fetchImpl(url, options);
    const body = safeJson(await response.text());
    return { status: response.status, ok: response.ok, body, headers: response.headers };
  }

  async function requestOk(url, options, context) {
    const result = await request(url, options);
    if (!result.ok) {
      throw new DevelopmentFixtureRequestError(`${context} failed with HTTP ${result.status}.`, {
        status: result.status,
        code: String(result.body?.code || result.body?.error || 'request_failed'),
        body: result.body,
      });
    }
    return result.body;
  }

  async function adminCreateUser({ email, password }) {
    return requestOk(`${baseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    }, 'Auth user creation');
  }

  async function adminUpdateUser(userId, patch) {
    return requestOk(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }, 'Auth user update');
  }

  async function adminDeleteUser(userId) {
    return request(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
  }

  async function signInWithPassword(email, password) {
    const body = await requestOk(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.serviceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, 'Fixture sign-in');
    const accessToken = String(body?.access_token || '');
    if (!accessToken) throw new DevelopmentFixtureRequestError('Fixture sign-in returned no access token.');
    return accessToken;
  }

  async function getUserJwt(userId, email, password) {
    await adminUpdateUser(userId, { password });
    return signInWithPassword(email, password);
  }

  async function adminListUsers() {
    const ids = [];
    for (let page = 1; page <= 100; page += 1) {
      const body = await requestOk(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
        headers: serviceHeaders,
      }, 'Auth user listing');
      const users = Array.isArray(body?.users) ? body.users : Array.isArray(body) ? body : [];
      ids.push(...users.map(user => String(user?.id || '')).filter(Boolean));
      if (users.length < 1000) break;
    }
    return ids;
  }

  async function rest(method, resource, { query = '', body, jwt, prefer } = {}) {
    const authorization = jwt ? `Bearer ${jwt}` : serviceHeaders.Authorization;
    const headers = {
      apikey: config.serviceRoleKey,
      Authorization: authorization,
      'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    return request(`${baseUrl}/rest/v1/${resource}${query ? `?${query}` : ''}`, {
      method,
      headers,
      ...(typeof body === 'undefined' ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function restOk(method, resource, options, context) {
    const result = await rest(method, resource, options);
    if (!result.ok) {
      throw new DevelopmentFixtureRequestError(`${context} failed with HTTP ${result.status}.`, {
        status: result.status,
        code: String(result.body?.code || result.body?.error || 'request_failed'),
        body: result.body,
      });
    }
    return result.body;
  }

  async function invoke(functionName, { jwt, body = {}, method = 'POST', query = '' } = {}) {
    const headers = {
      apikey: config.serviceRoleKey,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    };
    if (jwt) {
      headers.Authorization = `Bearer ${jwt}`;
      headers['x-user-jwt'] = jwt;
    }
    return request(`${functionsUrl}/${functionName}${query ? `?${query}` : ''}`, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function listTableIds(table) {
    const ids = [];
    for (let offset = 0; offset < 100000; offset += REST_PAGE_SIZE) {
      const query = `select=id&order=id.asc&offset=${offset}&limit=${REST_PAGE_SIZE}`;
      const result = await rest('GET', table, { query });
      if (!result.ok) {
        throw new DevelopmentFixtureRequestError(`Fingerprint read for ${table} failed.`, {
          status: result.status,
          code: String(result.body?.code || 'fingerprint_failed'),
        });
      }
      const rows = Array.isArray(result.body) ? result.body : [];
      ids.push(...rows.map(row => String(row?.id || '')).filter(Boolean));
      if (rows.length < REST_PAGE_SIZE) break;
    }
    return ids;
  }

  return {
    adminCreateUser,
    adminDeleteUser,
    adminListUsers,
    adminUpdateUser,
    getUserJwt,
    invoke,
    request,
    rest,
    restOk,
    signInWithPassword,
    listTableIds,
  };
}

function fingerprintIds(ids) {
  const normalized = [...ids].map(String).sort();
  return {
    count: normalized.length,
    sha256: createHash('sha256').update(normalized.join('\n')).digest('hex'),
  };
}

export async function captureDevelopmentFingerprints(api) {
  const tableNames = [
    'profiles',
    'organizations',
    'organization_members',
    'organization_invites',
    'billing_customers',
    'subscriptions',
    'webhook_events',
  ];
  const fingerprints = { auth_users: fingerprintIds(await api.adminListUsers()) };
  for (const table of tableNames) {
    fingerprints[table] = fingerprintIds(await api.listTableIds(table));
  }
  fingerprints.migration_ledger = { status: 'not_available_via_hosted_data_api' };
  fingerprints.protected_schema = { status: 'not_available_via_hosted_data_api' };
  return fingerprints;
}

export function compareDevelopmentFingerprints(before, after) {
  const differences = [];
  for (const key of Object.keys(before || {})) {
    const left = before[key];
    const right = after?.[key];
    if (left?.status || right?.status) continue;
    if (!right || left.count !== right.count || left.sha256 !== right.sha256) differences.push(key);
  }
  return differences;
}
