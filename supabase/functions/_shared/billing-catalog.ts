export type BillingTierId = "trial" | "pro" | "business";
export type BillingInterval = "month" | "year";

type BillingTier = {
  id: BillingTierId;
  name: string;
  workspaceLimit: number;
  checkoutEnabled: boolean;
  prices: Record<BillingInterval, string>;
};

export type BillingCatalog = {
  tiers: Record<BillingTierId, BillingTier>;
};

const DEFAULT_WORKSPACE_LIMITS: Record<BillingTierId, number> = {
  trial: 1,
  pro: 3,
  business: 10,
};

function env(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getBillingCatalog(): BillingCatalog {
  return {
    tiers: {
      trial: {
        id: "trial",
        name: "Trial",
        workspaceLimit: positiveIntegerEnv(
          "TP3D_TRIAL_WORKSPACE_LIMIT",
          DEFAULT_WORKSPACE_LIMITS.trial,
        ),
        checkoutEnabled: false,
        prices: { month: "", year: "" },
      },
      pro: {
        id: "pro",
        name: "Pro",
        workspaceLimit: positiveIntegerEnv(
          "TP3D_PRO_WORKSPACE_LIMIT",
          DEFAULT_WORKSPACE_LIMITS.pro,
        ),
        checkoutEnabled: true,
        prices: {
          month: env("STRIPE_PRICE_PRO_MONTHLY"),
          year: env("STRIPE_PRICE_PRO_YEARLY"),
        },
      },
      business: {
        id: "business",
        name: "Business",
        workspaceLimit: positiveIntegerEnv(
          "TP3D_BUSINESS_WORKSPACE_LIMIT",
          DEFAULT_WORKSPACE_LIMITS.business,
        ),
        checkoutEnabled: false,
        prices: {
          month: env("STRIPE_PRICE_BUSINESS_MONTHLY"),
          year: env("STRIPE_PRICE_BUSINESS_YEARLY"),
        },
      },
    },
  };
}

export function workspaceLimitForTier(tierId: BillingTierId): number {
  return getBillingCatalog().tiers[tierId].workspaceLimit;
}

export function configuredBusinessPriceIds(): string[] {
  const business = getBillingCatalog().tiers.business;
  return uniqueNonEmpty([business.prices.month, business.prices.year]);
}

export function workspaceLimitForPrice(
  priceId: unknown,
  fallbackTier: BillingTierId = "pro",
): number {
  const catalog = getBillingCatalog();
  const normalizedPriceId = String(priceId || "").trim();
  const businessPriceIds = uniqueNonEmpty([
    catalog.tiers.business.prices.month,
    catalog.tiers.business.prices.year,
  ]);
  if (normalizedPriceId && businessPriceIds.includes(normalizedPriceId)) {
    return catalog.tiers.business.workspaceLimit;
  }
  return catalog.tiers[fallbackTier].workspaceLimit;
}

export function workspaceLimitForEntitlement(status: unknown, priceId: unknown): number {
  if (String(status || "") === "trialing") {
    return workspaceLimitForTier("trial");
  }
  return workspaceLimitForPrice(priceId, "pro");
}

export function workspaceLimitForRestoreCandidate(
  priceId: unknown,
  planName: unknown,
  status: unknown,
): number {
  const normalizedStatus = String(status || "").toLowerCase();
  if (normalizedStatus === "trialing") {
    return workspaceLimitForTier("trial");
  }

  const normalizedPriceId = String(priceId || "").toLowerCase();
  const normalizedPlanName = String(planName || "").toLowerCase();
  if (normalizedPriceId.includes("business") || normalizedPlanName.includes("business")) {
    return workspaceLimitForTier("business");
  }
  return workspaceLimitForTier("pro");
}

export function normalizeBillingInterval(value: unknown): BillingInterval | null {
  const normalized = String(value || "").trim();
  return normalized === "month" || normalized === "year" ? normalized : null;
}

export function normalizeCheckoutInterval(value: unknown): BillingInterval | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "month" || normalized === "year" ? normalized : null;
}

export function resolveConfiguredPriceInterval(priceId: unknown): BillingInterval | null {
  const normalizedPriceId = String(priceId || "").trim();
  if (!normalizedPriceId) return null;
  const pro = getBillingCatalog().tiers.pro;
  if (normalizedPriceId === pro.prices.month) return "month";
  if (normalizedPriceId === pro.prices.year) return "year";
  return null;
}

export function allowedCheckoutPriceIds(): string[] {
  const pro = getBillingCatalog().tiers.pro;
  if (!pro.checkoutEnabled) return [];
  return uniqueNonEmpty([pro.prices.month, pro.prices.year]);
}

export function resolveCheckoutPrice(
  tierId: BillingTierId,
  interval: BillingInterval,
): string {
  const tier = getBillingCatalog().tiers[tierId];
  if (!tier.checkoutEnabled) return "";
  return tier.prices[interval] || "";
}

export function assertAllowedCheckoutPrice(priceId: string): void {
  if (allowedCheckoutPriceIds().includes(priceId)) return;
  const error = new Error("Invalid price_id");
  (error as { status?: number }).status = 400;
  throw error;
}
