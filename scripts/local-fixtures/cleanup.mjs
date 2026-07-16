import { maskUuid } from '../billing-fixtures/mask.mjs';

export class LocalFixtureCleanupError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LocalFixtureCleanupError';
  }
}

function values(set) {
  return Array.from(set || []);
}

async function countByIds(db, table, column, ids, cast) {
  if (!ids.length) return 0;
  const result = await db.query(
    `select count(*)::integer as count from ${table} where ${column} = any($1::${cast}[])`,
    [ids],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function cleanupLocalFixtureRun(run) {
  const users = values(run.ids.users);
  const organizations = values(run.ids.organizations);
  const memberships = values(run.ids.memberships);
  const billingCustomers = values(run.ids.billingCustomers);
  const subscriptions = values(run.ids.subscriptions);
  const webhookEvents = values(run.ids.webhookEvents);
  const db = run.db;

  let cleanupError = null;
  let temporaryResourcesRemoved = false;
  try {
    await db.query('begin');
    if (webhookEvents.length) {
      await db.query('delete from public.webhook_events where id = any($1::bigint[])', [webhookEvents]);
    }
    if (subscriptions.length) {
      await db.query('delete from public.subscriptions where id = any($1::bigint[])', [subscriptions]);
    }
    if (billingCustomers.length) {
      await db.query('delete from public.billing_customers where id = any($1::bigint[])', [billingCustomers]);
    }
    if (memberships.length) {
      await db.query('delete from public.organization_members where id = any($1::uuid[])', [memberships]);
    }
    if (organizations.length) {
      await db.query('delete from public.organizations where id = any($1::uuid[])', [organizations]);
    }
    if (users.length) {
      await db.query('delete from public.profiles where id = any($1::uuid[])', [users]);
      await db.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => {});
    cleanupError = new LocalFixtureCleanupError(
      `Exact-ID cleanup failed for run ${maskUuid(run.runId)}.`,
      error,
    );
  } finally {
    try {
      temporaryResourcesRemoved = await run.removeTemporaryResources();
    } catch (error) {
      cleanupError = cleanupError || new LocalFixtureCleanupError(
        `Temporary-resource cleanup failed for run ${maskUuid(run.runId)}.`,
        error,
      );
    }
  }

  if (cleanupError) throw cleanupError;

  const exactResiduals = {
    users: await countByIds(db, 'auth.users', 'id', users, 'uuid'),
    profiles: await countByIds(db, 'public.profiles', 'id', users, 'uuid'),
    organizations: await countByIds(db, 'public.organizations', 'id', organizations, 'uuid'),
    memberships: await countByIds(db, 'public.organization_members', 'id', memberships, 'uuid'),
    billingCustomers: await countByIds(db, 'public.billing_customers', 'id', billingCustomers, 'bigint'),
    subscriptions: await countByIds(db, 'public.subscriptions', 'id', subscriptions, 'bigint'),
    webhookEvents: await countByIds(db, 'public.webhook_events', 'id', webhookEvents, 'bigint'),
  };

  const tagPattern = `%${run.runId}%`;
  const compactPattern = `%${run.compactRunId}%`;
  const tagged = await db.query(`
    select
      (select count(*)::integer from auth.users where email like $1) as users,
      (select count(*)::integer from public.organizations where name like $1 or slug like $1) as organizations,
      (select count(*)::integer from public.subscriptions
        where stripe_customer_id like $2 or stripe_subscription_id like $2 or price_id like $2) as subscriptions,
      (select count(*)::integer from public.billing_customers
        where stripe_customer_id like $2 or stripe_subscription_id like $2 or plan_name like $1) as billing_customers,
      (select count(*)::integer from public.webhook_events where event_id like $2) as webhook_events
  `, [tagPattern, compactPattern]);
  const taggedResiduals = tagged.rows[0] || {};
  const residualTotal = [
    ...Object.values(exactResiduals),
    ...Object.values(taggedResiduals),
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  if (residualTotal !== 0) {
    throw new LocalFixtureCleanupError(
      `Cleanup left ${residualTotal} tracked or tagged row(s) for run ${maskUuid(run.runId)}.`,
    );
  }

  run.writeLine(`Local fixture cleanup: PASS (${maskUuid(run.runId)}, zero residual rows)`);
  return { exactResiduals, taggedResiduals, residualTotal, temporaryResourcesRemoved };
}
