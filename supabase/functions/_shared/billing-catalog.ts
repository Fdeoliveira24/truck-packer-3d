export type BillingTierId = "trial" | "pro" | "business";
export type BillingInterval = "month" | "year";

type BillingTier = {
  id: BillingTierId;
  name: string;
  workspaceLimit: number;
  checkoutEnabled: boolean;
  prices: Record<BillingInterval, string>;
  legacyPrices: Record<BillingInterval, string[]>;
};

export type BillingCatalog = {
  tiers: Record<BillingTierId, BillingTier>;
  activeCheckoutPriceIds: string[];
  legacyRecognitionPriceIds: string[];
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

function commaSeparatedEnv(name: string): string[] {
  return uniqueNonEmpty(env(name).split(",").map((value) => value.trim()));
}

export function getBillingCatalog(): BillingCatalog {
  const tiers: Record<BillingTierId, BillingTier> = {
    trial: {
      id: "trial",
      name: "Trial",
      workspaceLimit: positiveIntegerEnv(
        "TP3D_TRIAL_WORKSPACE_LIMIT",
        DEFAULT_WORKSPACE_LIMITS.trial,
      ),
      checkoutEnabled: false,
      prices: { month: "", year: "" },
      legacyPrices: { month: [], year: [] },
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
      legacyPrices: {
        month: commaSeparatedEnv("STRIPE_PRICE_PRO_MONTHLY_LEGACY"),
        year: commaSeparatedEnv("STRIPE_PRICE_PRO_YEARLY_LEGACY"),
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
      legacyPrices: {
        month: commaSeparatedEnv("STRIPE_PRICE_BUSINESS_MONTHLY_LEGACY"),
        year: commaSeparatedEnv("STRIPE_PRICE_BUSINESS_YEARLY_LEGACY"),
      },
    },
  };

  const activeCheckoutPriceIds = tiers.pro.checkoutEnabled
    ? uniqueNonEmpty([tiers.pro.prices.month, tiers.pro.prices.year])
    : [];
  const currentConfiguredPriceIds = uniqueNonEmpty([
    tiers.pro.prices.month,
    tiers.pro.prices.year,
    tiers.business.prices.month,
    tiers.business.prices.year,
  ]);
  const legacyRecognitionPriceIds = uniqueNonEmpty([
    ...tiers.pro.legacyPrices.month,
    ...tiers.pro.legacyPrices.year,
    ...tiers.business.legacyPrices.month,
    ...tiers.business.legacyPrices.year,
  ]).filter((priceId) => !currentConfiguredPriceIds.includes(priceId));

  return { tiers, activeCheckoutPriceIds, legacyRecognitionPriceIds };
}

export function workspaceLimitForTier(tierId: BillingTierId): number {
  return getBillingCatalog().tiers[tierId].workspaceLimit;
}

export function configuredBusinessPriceIds(): string[] {
  const business = getBillingCatalog().tiers.business;
  return uniqueNonEmpty([business.prices.month, business.prices.year]);
}

export function resolveRecognizedTierByPriceId(priceId: unknown): BillingTierId | null {
  const normalizedPriceId = String(priceId || "").trim();
  if (!normalizedPriceId) return null;
  const catalog = getBillingCatalog();

  // Current configuration remains authoritative over recognition-only lists.
  // Preserve the existing Business precedence if both current tier variables
  // accidentally contain the same Price.
  if (Object.values(catalog.tiers.business.prices).includes(normalizedPriceId)) return "business";
  if (Object.values(catalog.tiers.pro.prices).includes(normalizedPriceId)) return "pro";
  if (catalog.tiers.business.legacyPrices.month.includes(normalizedPriceId) ||
      catalog.tiers.business.legacyPrices.year.includes(normalizedPriceId)) return "business";
  if (catalog.tiers.pro.legacyPrices.month.includes(normalizedPriceId) ||
      catalog.tiers.pro.legacyPrices.year.includes(normalizedPriceId)) return "pro";
  return null;
}

export function isKnownPriceId(priceId: unknown): boolean {
  return resolveRecognizedTierByPriceId(priceId) !== null;
}

export function isCheckoutEnabledPriceId(priceId: unknown): boolean {
  const normalizedPriceId = String(priceId || "").trim();
  return Boolean(normalizedPriceId && getBillingCatalog().activeCheckoutPriceIds.includes(normalizedPriceId));
}

export function isLegacyPriceId(priceId: unknown): boolean {
  const normalizedPriceId = String(priceId || "").trim();
  if (!normalizedPriceId || isCheckoutEnabledPriceId(normalizedPriceId)) return false;
  return getBillingCatalog().legacyRecognitionPriceIds.includes(normalizedPriceId);
}

export function workspaceLimitForPrice(
  priceId: unknown,
  fallbackTier: BillingTierId = "pro",
): number {
  const catalog = getBillingCatalog();
  const recognizedTier = resolveRecognizedTierByPriceId(priceId);
  if (recognizedTier) return catalog.tiers[recognizedTier].workspaceLimit;
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

  const recognizedTier = resolveRecognizedTierByPriceId(priceId);
  if (recognizedTier) return workspaceLimitForTier(recognizedTier);

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
  if (pro.legacyPrices.month.includes(normalizedPriceId)) return "month";
  if (pro.legacyPrices.year.includes(normalizedPriceId)) return "year";
  return null;
}

export function allowedCheckoutPriceIds(): string[] {
  return getBillingCatalog().activeCheckoutPriceIds;
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
  if (isCheckoutEnabledPriceId(priceId)) return;
  const error = new Error("Invalid price_id");
  (error as { status?: number }).status = 400;
  throw error;
}
