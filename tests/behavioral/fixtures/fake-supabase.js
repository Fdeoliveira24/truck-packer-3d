(function installFakeSupabaseTransport() {
  'use strict';

  const scenario = window.__TP3D_FAKE_SUPABASE_SCENARIO__ || {};
  const clone = value => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const queryLog = [];
  const orgQueryFailures = [];
  const orgFailureWaiters = new Set();
  const authEventLog = [];
  const authSubscribers = new Set();
  const sharedProfilePrefix = 'tp3d:test:fake-profile:';

  let currentSession = clone(scenario.initialSession || null);
  let orgQueriesUnavailable = Boolean(scenario.orgQueriesUnavailable);
  let client = null;

  function recordOrgQueryFailure(operation) {
    const failure = { operation: String(operation), userId: currentUserId() || null };
    orgQueryFailures.push(failure);
    for (const waiter of Array.from(orgFailureWaiters)) {
      if (orgQueryFailures.length <= waiter.afterCount) continue;
      orgFailureWaiters.delete(waiter);
      waiter.resolve(clone(failure));
    }
  }

  function currentUserId() {
    return currentSession && currentSession.user && currentSession.user.id
      ? String(currentSession.user.id)
      : '';
  }

  function profileFor(userId) {
    const id = String(userId || currentUserId() || '');
    if (!id) return null;
    try {
      const shared = window.localStorage.getItem(sharedProfilePrefix + id);
      if (shared) return JSON.parse(shared);
    } catch {
      // Fall through to the scenario data.
    }
    const source = scenario.profiles && scenario.profiles[id];
    return clone(source || {
      id,
      email: currentSession && currentSession.user ? currentSession.user.email || null : null,
      current_organization_id: null,
      deletion_status: null,
      deleted_at: null,
      purge_after: null,
    });
  }

  function storeProfile(userId, profile) {
    const id = String(userId || currentUserId() || '');
    if (!id) return;
    if (!scenario.profiles) scenario.profiles = {};
    scenario.profiles[id] = clone(profile);
    try {
      window.localStorage.setItem(sharedProfilePrefix + id, JSON.stringify(profile));
    } catch {
      // The in-memory copy remains authoritative for this fake transport.
    }
  }

  function organizationsFor(userId) {
    const id = String(userId || currentUserId() || '');
    const source = scenario.organizations && scenario.organizations[id];
    return clone(Array.isArray(source) ? source : []);
  }

  function membershipFor(userId) {
    const id = String(userId || currentUserId() || '');
    const explicit = scenario.memberships && scenario.memberships[id];
    if (explicit) return clone(explicit);
    const profile = profileFor(id);
    const orgs = organizationsFor(id);
    const activeId = profile && profile.current_organization_id
      ? String(profile.current_organization_id)
      : orgs[0] && orgs[0].id
        ? String(orgs[0].id)
        : '';
    const org = orgs.find(row => row && String(row.id) === activeId) || orgs[0] || null;
    return org
      ? {
          id: `membership-${id}-${org.id}`,
          organization_id: String(org.id),
          role: org.role || 'member',
          joined_at: org.joined_at || null,
          invited_by: null,
        }
      : null;
  }

  function result(data, error = null) {
    return Promise.resolve({ data: clone(data), error: error ? clone(error) : null });
  }

  function createQuery(table) {
    const state = {
      table: String(table || ''),
      action: 'select',
      columns: '*',
      filters: [],
      update: null,
      limit: null,
    };

    const builder = {
      select(columns = '*') {
        state.columns = String(columns || '*');
        return builder;
      },
      eq(column, value) {
        state.filters.push({ column: String(column), value: clone(value) });
        return builder;
      },
      in(column, values) {
        state.filters.push({ column: String(column), values: clone(values) });
        return builder;
      },
      is(column, value) {
        state.filters.push({ column: String(column), value: clone(value) });
        return builder;
      },
      order() {
        return builder;
      },
      limit(value) {
        state.limit = Number(value);
        return builder;
      },
      update(values) {
        state.action = 'update';
        state.update = clone(values || {});
        return builder;
      },
      insert() {
        state.action = 'insert';
        return builder;
      },
      delete() {
        state.action = 'delete';
        return builder;
      },
      maybeSingle() {
        return execute('maybeSingle');
      },
      single() {
        return execute('single');
      },
      then(resolve, reject) {
        return execute('array').then(resolve, reject);
      },
    };

    function filterValue(column) {
      const entry = state.filters.find(item => item.column === column);
      return entry ? entry.value : undefined;
    }

    async function execute(terminal) {
      queryLog.push({ ...clone(state), terminal, userId: currentUserId() || null });
      const userId = state.table === 'profiles'
        ? String(filterValue('id') || currentUserId() || '')
        : String(filterValue('user_id') || currentUserId() || '');

      if (state.table === 'profiles') {
        const profile = profileFor(userId);
        if (state.action === 'update') {
          const updated = { ...(profile || { id: userId }), ...(state.update || {}) };
          storeProfile(userId, updated);
          return { data: terminal === 'array' ? [clone(updated)] : clone(updated), error: null };
        }
        if (terminal === 'array') return { data: profile ? [clone(profile)] : [], error: null };
        return { data: clone(profile), error: null };
      }

      if (state.table === 'organization_members') {
        if (orgQueriesUnavailable) {
          recordOrgQueryFailure('organization_members');
          return { data: terminal === 'array' ? [] : null, error: { message: 'org query unavailable', status: 503 } };
        }
        const membership = membershipFor(userId);
        if (state.columns.includes('organizations')) {
          const rows = organizationsFor(userId).map(org => ({
            id: `membership-${userId}-${org.id}`,
            organization_id: org.id,
            role: org.role || 'member',
            joined_at: org.joined_at || null,
            invited_by: null,
            organizations: clone(org),
          }));
          return { data: rows, error: null };
        }
        if (terminal === 'array') return { data: membership ? [clone(membership)] : [], error: null };
        return { data: clone(membership), error: null };
      }

      if (state.table === 'organizations') {
        const orgId = String(filterValue('id') || '');
        const org = organizationsFor(userId).find(row => row && String(row.id) === orgId) || null;
        if (terminal === 'array') return { data: org ? [clone(org)] : [], error: null };
        return { data: clone(org), error: null };
      }

      return { data: terminal === 'array' ? [] : null, error: null };
    }

    return builder;
  }

  async function emitAuth(event, nextSession) {
    const normalizedEvent = String(event || 'SIGNED_IN');
    if (normalizedEvent === 'SIGNED_OUT') currentSession = null;
    else if (nextSession !== undefined) currentSession = clone(nextSession);
    authEventLog.push({ event: normalizedEvent, userId: currentUserId() || null });
    const callbacks = Array.from(authSubscribers);
    await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(() => callback(normalizedEvent, clone(currentSession)))));
    return control.snapshot();
  }

  const auth = {
    storageKey: 'tp3d-test-auth-token',
    async getSession() {
      return { data: { session: clone(currentSession) }, error: null };
    },
    async getUser() {
      return {
        data: { user: currentSession && currentSession.user ? clone(currentSession.user) : null },
        error: null,
      };
    },
    onAuthStateChange(callback) {
      authSubscribers.add(callback);
      queueMicrotask(() => callback('INITIAL_SESSION', clone(currentSession)));
      return {
        data: {
          subscription: {
            unsubscribe() {
              authSubscribers.delete(callback);
            },
          },
        },
      };
    },
    async refreshSession() {
      await emitAuth('TOKEN_REFRESHED', currentSession);
      return { data: { session: clone(currentSession) }, error: null };
    },
    async signOut() {
      await emitAuth('SIGNED_OUT', null);
      return { error: null };
    },
    async signInWithPassword() {
      await emitAuth('SIGNED_IN', currentSession);
      return { data: { session: clone(currentSession), user: currentSession && currentSession.user }, error: null };
    },
    async signUp() {
      return { data: { session: clone(currentSession), user: currentSession && currentSession.user }, error: null };
    },
    async resetPasswordForEmail() {
      return { data: {}, error: null };
    },
    async updateUser() {
      return { data: { user: currentSession && currentSession.user }, error: null };
    },
    async signInWithOAuth() {
      return { data: { url: null }, error: null };
    },
  };

  const control = {
    async emitAuth(event, session) {
      return emitAuth(event, session);
    },
    setSession(session) {
      currentSession = clone(session || null);
      return control.snapshot();
    },
    setOrgQueriesUnavailable(value) {
      orgQueriesUnavailable = Boolean(value);
      return orgQueriesUnavailable;
    },
    waitForOrgQueryFailure(afterCount = 0) {
      const normalizedCount = Math.max(0, Number(afterCount) || 0);
      if (orgQueryFailures.length > normalizedCount) {
        return Promise.resolve(clone(orgQueryFailures[orgQueryFailures.length - 1]));
      }
      return new Promise(resolve => {
        orgFailureWaiters.add({ afterCount: normalizedCount, resolve });
      });
    },
    setOrganizations(userId, organizations) {
      if (!scenario.organizations) scenario.organizations = {};
      scenario.organizations[String(userId)] = clone(organizations || []);
    },
    setProfile(userId, profile) {
      storeProfile(userId, clone(profile || null));
    },
    snapshot() {
      return {
        session: clone(currentSession),
        userId: currentUserId() || null,
        orgQueriesUnavailable,
        authSubscriberCount: authSubscribers.size,
        authEvents: clone(authEventLog),
        orgQueryFailures: clone(orgQueryFailures),
        queries: clone(queryLog),
      };
    },
  };

  window.__TP3D_FAKE_SUPABASE_CONTROL__ = control;
  window.supabase = {
    createClient(url, key, options) {
      if (client) return client;
      client = {
        supabaseUrl: String(url || ''),
        supabaseKey: String(key || ''),
        auth,
        from: createQuery,
        async rpc(name) {
          queryLog.push({ rpc: String(name || ''), userId: currentUserId() || null });
          if (name === 'get_user_organizations' || name === 'get_user_archived_organizations') {
            if (orgQueriesUnavailable) {
              recordOrgQueryFailure(name);
              return result(null, { message: 'org query unavailable', status: 503 });
            }
            const orgs = organizationsFor(currentUserId());
            return result(
              name === 'get_user_archived_organizations'
                ? orgs.filter(org => org && org.archived_at)
                : orgs.filter(org => org && !org.archived_at)
            );
          }
          return result(null, { code: '42883', message: 'function does not exist' });
        },
        functions: {
          async invoke() {
            return { data: null, error: { message: 'function not mocked' } };
          },
        },
        storage: {
          from() {
            return {
              async createSignedUrl() {
                return { data: null, error: null };
              },
              async upload() {
                return { data: null, error: null };
              },
              async remove() {
                return { data: [], error: null };
              },
            };
          },
        },
        realtime: {},
        options: clone(options || {}),
      };
      return client;
    },
  };
})();
