/**
 * Asymmetric (RS256) agent tokens + JWKS (#40).
 *
 * Covers the opt-in RS256 signing path, the public JWKS endpoint, audience
 * scoping, kid rotation (a retired key still verifies), and proves the default
 * HS256 fast path is unchanged when no signing key is configured.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import {
  generateKeyPair,
  exportPKCS8,
  exportJWK,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  decodeJwt,
  SignJWT,
  type JWK,
  type CryptoKey as JoseCryptoKey,
} from "jose";
import { type AuthConfig } from "@agentkitai/auth";
import * as schema from "../db/schema.js";

// agent-tokens.ts → agents.js → db/index.js at import time; stub the DB (these
// tests exercise only the crypto/JWKS paths, which never touch it).
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });
vi.mock("../db/index.js", () => ({ getDb: () => db }));

import { signAgentToken, verifyAgentToken, AGENT_TOKEN_TYP } from "../lib/agent-tokens.js";
import { __resetAgentTokenKeysCache } from "../lib/agent-token-keys.js";
import wellKnownRouter from "../routes/well-known.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function authConfig(secret = TEST_SECRET): AuthConfig {
  return {
    oidc: null,
    jwt: { secret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 },
    authDisabled: false,
  };
}

/** Generate an extractable RS256 keypair: PKCS#8 PEM, public JWK, FULL private JWK. */
async function rsaKey(): Promise<{ pem: string; pub: JWK; privJwk: JWK; priv: JoseCryptoKey }> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const pub = await exportJWK(publicKey);
  const privJwk = await exportJWK(privateKey); // includes d/p/q/dp/dq/qi
  return { pem, pub, privJwk, priv: privateKey as JoseCryptoKey };
}

const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"];

/** Apply config + clear the key cache so the next sign/verify rebuilds it. */
function configure(overrides: Record<string, unknown>) {
  setConfig(parseConfig({ jwtSecret: TEST_SECRET, ...overrides }));
  __resetAgentTokenKeysCache();
}

function jwksApp() {
  const a = new Hono();
  a.route("/.well-known", wellKnownRouter);
  return a;
}

beforeEach(() => {
  configure({}); // default: no signing key → HS256 fast path
});

afterAll(() => {
  resetConfig();
  __resetAgentTokenKeysCache();
  sqlite.close();
});

describe("RS256 signing path", () => {
  it("signs with RS256 + kid and round-trips back to the agent id", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1" });

    const token = await signAgentToken("agt_rs", authConfig());
    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe("k1");
    expect(await verifyAgentToken(token, authConfig())).toBe("agt_rs");
  });

  it("defaults the kid to the JWK thumbprint when none is configured", async () => {
    const { pem, pub } = await rsaKey();
    configure({ agentTokenSigningKey: pem });
    const expectedKid = await calculateJwkThumbprint({
      kty: pub.kty,
      n: pub.n,
      e: pub.e,
      alg: "RS256",
      use: "sig",
    });
    const token = await signAgentToken("agt_rs", authConfig());
    expect(decodeProtectedHeader(token).kid).toBe(expectedKid);
  });

  it("rejects a tampered RS256 token", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1" });
    const token = await signAgentToken("agt_rs", authConfig());
    expect(await verifyAgentToken(`${token.slice(0, -3)}xyz`, authConfig())).toBeNull();
  });

  it("rejects an RS256 token signed by a key NOT in the JWKS", async () => {
    const a = await rsaKey();
    const b = await rsaKey();
    configure({ agentTokenSigningKey: a.pem, agentTokenSigningKid: "k1" });
    const forged = await new SignJWT({ typ: AGENT_TOKEN_TYP })
      .setProtectedHeader({ alg: "RS256", kid: "rogue" })
      .setSubject("agt_x")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(b.priv);
    expect(await verifyAgentToken(forged, authConfig())).toBeNull();
  });

  it("rejects an RS256 token whose typ is not 'agent' (no user cross-over)", async () => {
    const { pem, priv } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1" });
    const userish = await new SignJWT({ typ: "access" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("user_1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(priv);
    expect(await verifyAgentToken(userish, authConfig())).toBeNull();
  });
});

describe("audience scoping", () => {
  it("mints aud and accepts it; rejects when the required audience differs", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1", agentTokenAudience: "agentlens" });
    const token = await signAgentToken("agt_rs", authConfig());
    expect(await verifyAgentToken(token, authConfig())).toBe("agt_rs");

    // Same keys, but the verifier now requires a DIFFERENT audience.
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1", agentTokenAudience: "someone-else" });
    expect(await verifyAgentToken(token, authConfig())).toBeNull();
  });
});

describe("kid rotation", () => {
  it("verifies a retired key's token AND strips its private members from the public JWKS", async () => {
    const oldKey = await rsaKey();
    // Feed the FULL PRIVATE JWK (the natural exportJWK output) into the rotation
    // config — the code must publish only the public half.
    const oldPrivJwk: JWK = { ...oldKey.privJwk, kid: "old" };
    expect(oldPrivJwk.d).toBeDefined(); // sanity: we really are passing a private key
    const oldToken = await new SignJWT({ typ: AGENT_TOKEN_TYP })
      .setProtectedHeader({ alg: "RS256", kid: "old" })
      .setSubject("agt_old")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(oldKey.priv);

    const newKey = await rsaKey();
    configure({
      agentTokenSigningKey: newKey.pem,
      agentTokenSigningKid: "new",
      agentTokenVerifyKeys: JSON.stringify([oldPrivJwk]),
    });

    // New key signs going forward...
    const newToken = await signAgentToken("agt_new", authConfig());
    expect(decodeProtectedHeader(newToken).kid).toBe("new");
    expect(await verifyAgentToken(newToken, authConfig())).toBe("agt_new");
    // ...and the retired key's token still verifies during the rotation window.
    expect(await verifyAgentToken(oldToken, authConfig())).toBe("agt_old");

    // CRITICAL: the published JWKS must NOT leak the retired private key.
    const body = (await (await jwksApp().request("/.well-known/jwks.json")).json()) as {
      keys: JWK[];
    };
    const retired = body.keys.find((k) => k.kid === "old");
    expect(retired).toBeDefined();
    for (const m of PRIVATE_JWK_MEMBERS) expect(retired).not.toHaveProperty(m);
  });

  it("skips a non-RSA / oct rotation entry (never publishes its secret 'k')", async () => {
    const { pem } = await rsaKey();
    configure({
      agentTokenSigningKey: pem,
      agentTokenSigningKid: "k1",
      agentTokenVerifyKeys: JSON.stringify([{ kty: "oct", kid: "leak", k: "super-secret" }]),
    });
    const body = (await (await jwksApp().request("/.well-known/jwks.json")).json()) as {
      keys: JWK[];
    };
    expect(body.keys).toHaveLength(1); // only the active RSA signer
    expect(body.keys.find((k) => k.kid === "leak")).toBeUndefined();
  });

  it("a rotation key colliding with the active kid is dropped (active wins)", async () => {
    const active = await rsaKey();
    const other = await rsaKey();
    configure({
      agentTokenSigningKey: active.pem,
      agentTokenSigningKid: "dup",
      agentTokenVerifyKeys: JSON.stringify([{ ...other.pub, kid: "dup" }]),
    });
    const body = (await (await jwksApp().request("/.well-known/jwks.json")).json()) as {
      keys: JWK[];
    };
    const dup = body.keys.filter((k) => k.kid === "dup");
    expect(dup).toHaveLength(1);
    expect(dup[0].n).toBe(active.pub.n); // the active key, not the rotation entry
  });
});

describe("issuer scoping", () => {
  it("mints an iss claim when AGENT_TOKEN_ISSUER is set and still round-trips", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1", agentTokenIssuer: "https://gate.example" });
    const token = await signAgentToken("agt_rs", authConfig());
    expect(decodeJwt(token).iss).toBe("https://gate.example");
    expect(await verifyAgentToken(token, authConfig())).toBe("agt_rs");
  });
});

describe("HS256 fast path is the unchanged default", () => {
  it("signs HS256 when no signing key is configured and round-trips", async () => {
    const token = await signAgentToken("agt_hs", authConfig());
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    expect(await verifyAgentToken(token, authConfig())).toBe("agt_hs");
  });

  it("falls back to HS256 (no crash) when the signing key is malformed", async () => {
    configure({
      agentTokenSigningKey: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
    });
    const token = await signAgentToken("agt_x", authConfig());
    expect(decodeProtectedHeader(token).alg).toBe("HS256"); // failed closed to HS256
    expect(await verifyAgentToken(token, authConfig())).toBe("agt_x");
    // An RS256 token now has no verifier → rejected, not a 500.
    expect(await verifyAgentToken("eyJhbGciOiJSUzI1NiJ9.e30.x", authConfig())).toBeNull();
  });

  it("rejects an RS256 token once asymmetric keys are removed (no verifier)", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1" });
    const token = await signAgentToken("agt_rs", authConfig());
    configure({}); // keys gone
    expect(await verifyAgentToken(token, authConfig())).toBeNull();
  });
});

describe("GET /.well-known/jwks.json", () => {
  it("returns an empty key set when no asymmetric key is configured", async () => {
    const res = await jwksApp().request("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [] });
  });

  it("publishes the public key (kid + kty + n + e) and NO private members", async () => {
    const { pem } = await rsaKey();
    configure({ agentTokenSigningKey: pem, agentTokenSigningKid: "k1" });
    const res = await jwksApp().request("/.well-known/jwks.json");
    const body = (await res.json()) as { keys: JWK[] };
    expect(body.keys).toHaveLength(1);
    const jwk = body.keys[0];
    expect(jwk.kid).toBe("k1");
    expect(jwk.kty).toBe("RSA");
    expect(jwk.use).toBe("sig");
    expect(typeof jwk.n).toBe("string");
    expect(jwk.e).toBe("AQAB");
    // The private half must never be published.
    for (const priv of ["d", "p", "q", "dp", "dq", "qi"]) {
      expect(jwk).not.toHaveProperty(priv);
    }
  });
});
