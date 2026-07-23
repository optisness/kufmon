import { describe, expect, it, vi } from "vitest";
import { enforceSearchSubscriptionLimits, persistUserBillingState, getBillingPlan } from "../src/billing.js";

describe("billing helpers", () => {
  it("enforces plan limits by raising intervals and disabling excess subscriptions", async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ planId: "single" }),
        update: vi.fn(),
      },
      subscription: {
        findMany: vi.fn().mockResolvedValue([
          { id: "sub-1", enabled: true, intervalMinutes: 10 },
          { id: "sub-2", enabled: true, intervalMinutes: 30 },
          { id: "sub-3", enabled: true, intervalMinutes: 40 },
        ]),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      userSubscription: {
        updateMany: vi.fn(),
        create: vi.fn(),
      },
    };

    const result = await enforceSearchSubscriptionLimits(db, "user-1");

    expect(result.plan.id).toBe("single");
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { intervalMinutes: 20 },
    });
    expect(db.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sub-1", "sub-2"] } },
      data: { enabled: false },
    });
  });

  it("persists the current billing plan on the user and creates a history record", async () => {
    const db = {
      user: {
        update: vi.fn().mockResolvedValue({}),
      },
      userSubscription: {
        updateMany: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
      subscription: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    const result = await persistUserBillingState(db, {
      userId: "user-1",
      planId: "technical",
      expiresAt: "2036-01-01",
    });

    expect(getBillingPlan("technical").id).toBe("technical");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        planId: "technical",
        planExpiresAt: expect.any(Date),
      },
    });
    expect(db.userSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "ACTIVE",
      },
      data: {
        status: "CANCELED",
      },
    });
    expect(db.userSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        planId: "technical",
        status: "ACTIVE",
        autoRenew: false,
      }),
    });
    expect(result.plan.id).toBe("technical");
  });
});
