export type BillingPlanId = "single" | "triple" | "unlimited" | "bonus" | "technical";

export type BillingPlan = {
  id: BillingPlanId;
  label: string;
  subscriptionsLimit: number | null;
  minimumIntervalMinutes: number;
  defaultDurationDays: number;
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    id: "single",
    label: "1 подписка",
    subscriptionsLimit: 1,
    minimumIntervalMinutes: 20,
    defaultDurationDays: 30,
  },
  {
    id: "triple",
    label: "3 подписки",
    subscriptionsLimit: 3,
    minimumIntervalMinutes: 10,
    defaultDurationDays: 30,
  },
  {
    id: "unlimited",
    label: "анлим",
    subscriptionsLimit: null,
    minimumIntervalMinutes: 5,
    defaultDurationDays: 30,
  },
  {
    id: "bonus",
    label: "1 бонусная подписка",
    subscriptionsLimit: 1,
    minimumIntervalMinutes: 5,
    defaultDurationDays: 30,
  },
  {
    id: "technical",
    label: "техническая",
    subscriptionsLimit: null,
    minimumIntervalMinutes: 5,
    defaultDurationDays: 3650,
  },
];

const BILLING_PLAN_BY_ID = new Map(BILLING_PLANS.map((plan) => [plan.id, plan]));

export function getBillingPlan(planId: string | null | undefined) {
  if (planId && BILLING_PLAN_BY_ID.has(planId as BillingPlanId)) {
    return BILLING_PLAN_BY_ID.get(planId as BillingPlanId) ?? BILLING_PLAN_BY_ID.get("technical")!;
  }

  return BILLING_PLAN_BY_ID.get("technical")!;
}

export function getBillingPlanOptions() {
  return BILLING_PLANS.map((plan) => ({
    value: plan.id,
    label:
      plan.id === "single"
        ? "1 подписка (мин. 20 мин)"
        : plan.id === "triple"
          ? "3 подписки (мин. 10 мин)"
          : plan.id === "unlimited"
            ? "анлим (мин. 5 мин)"
            : plan.id === "bonus"
              ? "1 бонусная подписка (мин. 5 мин)"
              : "техническая (бесплатная, 10 лет, мин. 5 мин)",
  }));
}

export function formatBillingPlanLabel(planId: string | null | undefined) {
  return getBillingPlan(planId).label;
}

export function getDefaultBillingExpiresAt(planId: string | null | undefined, now = new Date()) {
  const plan = getBillingPlan(planId);
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + plan.defaultDurationDays);
  return expiresAt;
}

function parseDateLike(value: unknown) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function persistUserBillingState(db: any, options: {
  userId: string;
  planId: string | null | undefined;
  expiresAt: unknown;
}) {
  const plan = getBillingPlan(options.planId);
  const expiresAt = parseDateLike(options.expiresAt) ?? getDefaultBillingExpiresAt(plan.id);
  const status = expiresAt.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";

  await db.user.update({
    where: { id: options.userId },
    data: {
      planId: plan.id,
      planExpiresAt: expiresAt,
    },
  });

  await db.userSubscription.updateMany({
    where: {
      userId: options.userId,
      status: "ACTIVE",
    },
    data: {
      status: "CANCELED",
    },
  });

  await db.userSubscription.create({
    data: {
      userId: options.userId,
      planId: plan.id,
      status,
      startedAt: new Date(),
      expiresAt,
      autoRenew: false,
    },
  });

  return {
    plan,
    expiresAt,
    status,
  };
}

export async function enforceSearchSubscriptionLimits(db: any, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { planId: true },
  });
  const plan = getBillingPlan(user?.planId);

  const subscriptions = await db.subscription.findMany({
    where: { userId },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      enabled: true,
      intervalMinutes: true,
    },
  });

  if (subscriptions.length === 0) {
    return { plan, adjusted: 0, disabled: 0 };
  }

  let adjusted = 0;
  for (const subscription of subscriptions) {
    if (Number(subscription.intervalMinutes ?? 0) < plan.minimumIntervalMinutes) {
      await db.subscription.update({
        where: { id: subscription.id },
        data: { intervalMinutes: plan.minimumIntervalMinutes },
      });
      adjusted += 1;
    }
  }

  let disabled = 0;
  if (plan.subscriptionsLimit != null) {
    const enabledSubscriptions = subscriptions.filter((subscription) => subscription.enabled);
    const excess = enabledSubscriptions.length - plan.subscriptionsLimit;

    if (excess > 0) {
      const idsToDisable = enabledSubscriptions.slice(0, excess).map((subscription) => subscription.id);
      await db.subscription.updateMany({
        where: { id: { in: idsToDisable } },
        data: { enabled: false },
      });
      disabled = idsToDisable.length;
    }
  }

  return { plan, adjusted, disabled };
}
