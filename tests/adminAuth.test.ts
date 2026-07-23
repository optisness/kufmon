import { afterEach, describe, expect, it } from "vitest";
import {
  clearAdminLoginState,
  createAdminSessionToken,
  getAdminLoginLockState,
  isAdminAuthenticated,
  recordAdminLoginFailure,
} from "../src/adminAuth.js";

describe("admin auth", () => {
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
    clearAdminLoginState();
  });

  it("creates and verifies signed admin session cookies", () => {
    process.env.ADMIN_PASSWORD = "secret";

    const token = createAdminSessionToken(1_700_000_000_000);

    expect(token).toBeTruthy();
    expect(isAdminAuthenticated(`kufmon_admin_session=${token}`, 1_700_000_000_000)).toBe(true);
    expect(isAdminAuthenticated("kufmon_admin_session=bad-token", 1_700_000_000_000)).toBe(false);
  });

  it("locks login after three failed attempts", () => {
    process.env.ADMIN_PASSWORD = "secret";

    expect(recordAdminLoginFailure(1000).locked).toBe(false);
    expect(recordAdminLoginFailure(2000).locked).toBe(false);

    const thirdAttempt = recordAdminLoginFailure(3000);
    expect(thirdAttempt.locked).toBe(true);
    expect(thirdAttempt.shouldNotify).toBe(true);
    expect(getAdminLoginLockState(3000).locked).toBe(true);
  });
});
