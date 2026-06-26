// @agentkitai/agentgate-server — Public JWKS for asymmetric agent tokens (#40).
//
// GET /.well-known/jwks.json — the PUBLIC half of the RS256 agent-token signing
// key(s). Downstream verifiers (AgentLens, Lore) fetch this to verify agent
// tokens without holding the shared HS256 secret. Returns a valid empty key set
// when no asymmetric key is configured (HS256 fast path). PUBLIC — public keys
// only, mounted before the user-auth middleware.

import { Hono } from "hono";

import { getPublicJwks } from "../lib/agent-token-keys.js";

const router = new Hono();

router.get("/jwks.json", async (c) => {
  const jwks = await getPublicJwks();
  // Short cache: long enough to amortize fetches, short enough that a rotation
  // propagates within minutes. RFC 7517 media type for a JWK Set.
  return c.body(JSON.stringify(jwks), 200, {
    "content-type": "application/jwk-set+json",
    "cache-control": "public, max-age=300",
  });
});

export default router;
