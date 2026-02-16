import { describe, it, expect } from "vitest";
import app from "../../index.js";

describe("Readiness Probe - GET /ready", () => {
  it("should return 200 with status ok when healthy", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.checks.db).toBe(true);
  });
});

describe("Startup Probe - GET /startup", () => {
  it("should return 200 with status ok when migrations applied", async () => {
    const res = await app.request("/startup");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.checks.migrations).toBe(true);
  });
});
