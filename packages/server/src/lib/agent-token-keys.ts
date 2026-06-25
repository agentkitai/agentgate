// @agentgate/server — Asymmetric (RS256) agent-token keys + JWKS (#40).
//
// Optional, opt-in upgrade to the agent-identity spine. By default agent tokens
// are signed with the shared HS256 JWT_SECRET, which every downstream verifier
// (AgentLens, Lore) must ALSO hold — so one leaked secret mints tokens anywhere.
// Set AGENT_TOKEN_SIGNING_KEY (a PKCS#8 RSA private key) and AgentGate signs
// with RS256 instead, publishing only the PUBLIC half at
// GET /.well-known/jwks.json. Downstream verifiers fetch the JWKS and verify
// with no secret. Unset → the HS256 fast path is used unchanged.
//
// Rotation: set a NEW signing key + kid, and keep the PREVIOUS public JWK in
// AGENT_TOKEN_VERIFY_KEYS until its last issued token expires — both stay in the
// JWKS and verify, but only the active key signs.
//
// This module owns key material only (no claim shape); agent-tokens.ts owns the
// typ/sub/aud claims, so there is no import cycle.

import {
  importPKCS8,
  exportJWK,
  createLocalJWKSet,
  calculateJwkThumbprint,
  type JWK,
} from "jose";

import { getConfig } from "../config.js";

type JwksVerifier = ReturnType<typeof createLocalJWKSet>;

interface KeysState {
  /** The active RS256 signer, or null when no signing key is configured. */
  signer: { key: CryptoKey; kid: string; audience?: string; issuer?: string } | null;
  /** jose key resolver over every public key (active + rotation), or null. */
  verifier: JwksVerifier | null;
  /** The public JWKS served at /.well-known/jwks.json (empty when unconfigured). */
  publicJwks: { keys: JWK[] };
}

// Cached as a Promise so concurrent callers share one import (key import is async).
let cache: Promise<KeysState> | null = null;

async function build(): Promise<KeysState> {
  const cfg = getConfig();
  const pem = cfg.agentTokenSigningKey?.trim();
  const audience = cfg.agentTokenAudience?.trim() || undefined;
  const issuer = cfg.agentTokenIssuer?.trim() || undefined;
  const publicKeys: JWK[] = [];
  let signer: KeysState["signer"] = null;

  if (pem) {
    // A bad PEM must NOT reject (the rejection would be cached forever and turn
    // every mint + RS verify into a 500). Fail closed to the HS256 path instead.
    try {
      // extractable so we can derive the PUBLIC JWK to publish; the key already
      // lives in-process, so this exposes nothing new.
      const key = (await importPKCS8(pem, "RS256", { extractable: true })) as CryptoKey;
      const full = await exportJWK(key); // private JWK (kty,n,e,d,p,q,...)
      // Publish ONLY the public members — never d/p/q/dp/dq/qi.
      const pub: JWK = { kty: full.kty, n: full.n, e: full.e, alg: "RS256", use: "sig" };
      const kid = cfg.agentTokenSigningKid?.trim() || (await calculateJwkThumbprint(pub));
      pub.kid = kid;
      publicKeys.push(pub);
      signer = { key, kid, audience, issuer };
    } catch (err) {
      console.error(
        `Warning: AGENT_TOKEN_SIGNING_KEY is not a valid PKCS#8 RS256 key; ` +
          `falling back to the HS256 path: ${String(err)}`,
      );
    }
  }
  const activeKid = signer?.kid;

  // Retired signers, kept live for verification during a rotation window. These
  // are operator-supplied, so reconstruct each from a STRICT public-RSA
  // whitelist — never spread the raw JWK, which would publish private members
  // (d/p/q/...) or an oct secret `k` on the public JWKS endpoint.
  const verifyRaw = cfg.agentTokenVerifyKeys?.trim();
  if (verifyRaw) {
    try {
      const parsed = JSON.parse(verifyRaw) as unknown;
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { keys?: unknown[] })?.keys)
          ? (parsed as { keys: unknown[] }).keys
          : [];
      for (const k of arr) {
        const jwk = (k ?? {}) as JWK;
        const ok =
          jwk.kty === "RSA" &&
          typeof jwk.kid === "string" &&
          typeof jwk.n === "string" &&
          typeof jwk.e === "string";
        if (!ok) {
          console.error(
            "Warning: AGENT_TOKEN_VERIFY_KEYS entry skipped " +
              "(must be a public RSA JWK with kty/kid/n/e)",
          );
          continue;
        }
        // The active signer is already published; a colliding kid would make
        // verification ambiguous (rotation footgun) — the active key wins.
        if (jwk.kid === activeKid) continue;
        publicKeys.push({ kty: "RSA", n: jwk.n, e: jwk.e, kid: jwk.kid, alg: "RS256", use: "sig" });
      }
    } catch {
      // ponytail: a malformed AGENT_TOKEN_VERIFY_KEYS must never crash token
      // verification — log and ignore the rotation keys.
      console.error(
        "Warning: AGENT_TOKEN_VERIFY_KEYS is not valid JSON; ignoring rotation keys",
      );
    }
  }

  const verifier = publicKeys.length ? createLocalJWKSet({ keys: publicKeys }) : null;
  return { signer, verifier, publicJwks: { keys: publicKeys } };
}

function state(): Promise<KeysState> {
  return (cache ??= build());
}

/** The active RS256 signer, or null when only the HS256 fast path is configured. */
export async function getActiveSigningKey(): Promise<KeysState["signer"]> {
  return (await state()).signer;
}

/** jose JWKS resolver for verifying RS256 agent tokens, or null when none configured. */
export async function getJwksVerifier(): Promise<JwksVerifier | null> {
  return (await state()).verifier;
}

/** Public JWKS for GET /.well-known/jwks.json (a valid empty set when unconfigured). */
export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  return (await state()).publicJwks;
}

/** The configured audience to require on RS256 verify, or undefined. */
export function getAgentTokenAudience(): string | undefined {
  return getConfig().agentTokenAudience?.trim() || undefined;
}

/** Drop the cached keys (tests + after a config reset). */
export function __resetAgentTokenKeysCache(): void {
  cache = null;
}
