/**
 * External SPIFFE JWT-SVID verification (#41).
 *
 * AgentGate accepts a SPIFFE JWT-SVID (verified against the trust bundle) as a
 * verified principal = the SPIFFE ID. Covers the mandatory audience check, the
 * trust-domain pin, asymmetric-only signing, and the disabled-by-default state.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK, type CryptoKey as JoseCryptoKey } from "jose";

import { verifySpiffeSvid, spiffeEnabled, __resetSpiffeCache } from "../lib/spiffe.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const TD = "example.org";
const AUD = "spiffe://example.org/agentgate";

async function trustDomainKey(kid = "td1") {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = kid;
  jwk.alg = "ES256";
  jwk.use = "sig";
  return { priv: privateKey as JoseCryptoKey, jwk, kid };
}

async function svid(
  priv: JoseCryptoKey,
  kid: string,
  opts: { sub?: string; aud?: string | string[] } = {},
) {
  const b = new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(opts.sub ?? `spiffe://${TD}/agent/checkout`)
    .setIssuedAt()
    .setExpirationTime("5m");
  if (opts.aud !== undefined) b.setAudience(opts.aud);
  return b.sign(priv);
}

/** Configure the trust bundle inline (no network) + reset the verifier cache. */
async function configure(overrides: Record<string, unknown>, jwk?: JWK) {
  setConfig(
    parseConfig({
      ...(jwk ? { spiffeTrustBundle: JSON.stringify({ keys: [jwk] }) } : {}),
      ...overrides,
    }),
  );
  __resetSpiffeCache();
}

beforeEach(() => {
  resetConfig();
  __resetSpiffeCache();
});
afterAll(() => {
  resetConfig();
  __resetSpiffeCache();
});

describe("verifySpiffeSvid", () => {
  it("verifies a valid SVID and returns the SPIFFE ID", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    expect(spiffeEnabled()).toBe(true);
    const token = await svid(k.priv, k.kid, { aud: AUD });
    expect(await verifySpiffeSvid(token)).toBe(`spiffe://${TD}/agent/checkout`);
  });

  it("accepts an aud array that includes the configured audience", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    const token = await svid(k.priv, k.kid, { aud: ["https://other", AUD] });
    expect(await verifySpiffeSvid(token)).toBe(`spiffe://${TD}/agent/checkout`);
  });

  it("rejects a missing or wrong audience (spec mandates audience validation)", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    expect(await verifySpiffeSvid(await svid(k.priv, k.kid))).toBeNull(); // no aud
    expect(await verifySpiffeSvid(await svid(k.priv, k.kid, { aud: "spiffe://example.org/other" }))).toBeNull();
  });

  it("rejects a SVID from a different trust domain", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    const token = await svid(k.priv, k.kid, { sub: "spiffe://evil.org/agent/x", aud: AUD });
    expect(await verifySpiffeSvid(token)).toBeNull();
  });

  it("rejects a non-spiffe subject", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    const token = await svid(k.priv, k.kid, { sub: "agt_not_spiffe", aud: AUD });
    expect(await verifySpiffeSvid(token)).toBeNull();
  });

  it("rejects a SVID signed by a key not in the trust bundle", async () => {
    const inBundle = await trustDomainKey("td1");
    const rogue = await trustDomainKey("rogue");
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, inBundle.jwk);
    const token = await svid(rogue.priv, "rogue", { aud: AUD });
    expect(await verifySpiffeSvid(token)).toBeNull();
  });

  it("rejects an HS256 token (asymmetric algs only)", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`spiffe://${TD}/agent/checkout`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-shared-secret-at-least-32-chars-long!!"));
    expect(await verifySpiffeSvid(hs)).toBeNull();
  });

  it("rejects a bare trust-domain root with no workload path", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    const token = await svid(k.priv, k.kid, { sub: `spiffe://${TD}/`, aud: AUD });
    expect(await verifySpiffeSvid(token)).toBeNull();
  });

  it("rejects an SVID older than SPIFFE_MAX_SVID_AGE", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD, spiffeMaxSvidAge: 60 }, k.jwk);
    const now = Math.floor(Date.now() / 1000);
    const old = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: k.kid })
      .setSubject(`spiffe://${TD}/agent/checkout`)
      .setAudience(AUD)
      .setIssuedAt(now - 7200)
      .setExpirationTime(now + 7200)
      .sign(k.priv);
    expect(await verifySpiffeSvid(old)).toBeNull();
    expect(await verifySpiffeSvid(await svid(k.priv, k.kid, { aud: AUD }))).toBe(`spiffe://${TD}/agent/checkout`);
  });
});

describe("disabled by default", () => {
  it("is off (returns null) when no audience is configured, even with a bundle", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeTrustDomain: TD }, k.jwk); // bundle but NO audience
    expect(spiffeEnabled()).toBe(false);
    expect(await verifySpiffeSvid(await svid(k.priv, k.kid, { aud: AUD }))).toBeNull();
  });

  it("is off when no trust bundle is configured", async () => {
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }); // audience but NO bundle
    expect(spiffeEnabled()).toBe(false);
  });

  it("is off when no trust domain is configured (federation-bundle safety)", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD }, k.jwk); // bundle + audience, NO trust domain
    expect(spiffeEnabled()).toBe(false);
    expect(await verifySpiffeSvid(await svid(k.priv, k.kid, { aud: AUD }))).toBeNull();
  });

  it("fails closed at config parse on a malformed SPIFFE_JWKS_URL", () => {
    expect(() =>
      parseConfig({ spiffeAudience: AUD, spiffeTrustDomain: TD, spiffeJwksUrl: "not-a-url" }),
    ).toThrow();
  });

  it("returns null for undefined input", async () => {
    const k = await trustDomainKey();
    await configure({ spiffeAudience: AUD, spiffeTrustDomain: TD }, k.jwk);
    expect(await verifySpiffeSvid(undefined)).toBeNull();
  });
});
