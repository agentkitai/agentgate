// @agentkitai/agentgate-server — Assemble the agentkit-auth AuthConfig from server config.
// Shared by the agent token endpoint and agent Bearer verification on the
// requests route. (routes/auth.ts + middleware/auth.ts keep their own copies
// for now; consolidating those is a separate cleanup.)

import { getConfig, resolveJwtSecret } from "../config.js";
import type { AuthConfig } from "@agentkitai/auth";

export function getAuthConfig(): AuthConfig {
  const config = getConfig();
  return {
    oidc: config.oidcIssuer
      ? {
          issuerUrl: config.oidcIssuer,
          clientId: config.oidcClientId || "",
          clientSecret: config.oidcClientSecret || "",
          redirectUri: config.oidcRedirectUri || "",
          scopes: ["openid", "profile", "email"],
        }
      : null,
    jwt: {
      secret: resolveJwtSecret(config),
      accessTokenTtlSeconds: config.jwtAccessTtl,
      refreshTokenTtlSeconds: config.jwtRefreshTtl,
    },
    authDisabled: false,
  };
}
