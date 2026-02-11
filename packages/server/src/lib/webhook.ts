import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { webhooks, webhookDeliveries } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { validateWebhookUrl } from './url-validator.js';
import { getLogger } from './logger.js';
import { decrypt, encrypt, isEncrypted, deriveKey } from './crypto.js';
import { getConfig } from '../config.js';

const MAX_ATTEMPTS = 3;

/** Decrypt a webhook secret if encryption is configured */
function decryptSecret(storedSecret: string): string {
  const config = getConfig();
  if (config.webhookEncryptionKey) {
    return decrypt(storedSecret, deriveKey(config.webhookEncryptionKey));
  }
  return storedSecret;
}

// Sign payload with HMAC-SHA256
export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Deliver webhook to all matching endpoints
export async function deliverWebhook(event: string, data: unknown): Promise<void> {
  // Find enabled webhooks that subscribe to this event
  const matchingWebhooks = await getDb().select().from(webhooks)
    .where(eq(webhooks.enabled, 1));
  
  const filtered = matchingWebhooks.filter(wh => {
    const events = JSON.parse(wh.events) as string[];
    return events.includes(event) || events.includes('*');
  });

  await Promise.allSettled(
    filtered.map(webhook => deliverToWebhook(webhook, event, data))
  );
}

async function deliverToWebhook(webhook: typeof webhooks.$inferSelect, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  const signature = signPayload(payload, decryptSecret(webhook.secret));
  
  // Create delivery record
  const deliveryId = nanoid();
  await getDb().insert(webhookDeliveries).values({
    id: deliveryId,
    webhookId: webhook.id,
    event,
    payload,
    status: 'pending',
    attempts: 0,
  });

  // Attempt first delivery immediately
  await attemptDelivery(deliveryId, webhook.url, payload, signature);
}

/**
 * Compute the exponential backoff delay for a given attempt number.
 * attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s
 */
function getBackoffMs(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

async function attemptDelivery(deliveryId: string, url: string, payload: string, signature: string, attempt = 1) {
  // SSRF protection: Re-validate URL before each delivery attempt (DNS rebinding defense)
  const validation = await validateWebhookUrl(url);
  if (!validation.valid) {
    await getDb().update(webhookDeliveries)
      .set({
        status: 'failed',
        attempts: attempt,
        lastAttemptAt: Date.now(),
        responseBody: `SSRF protection: ${validation.error}`,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return; // Do not retry - this is a security block, not a transient error
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentGate-Signature': signature,
      },
      body: payload,
    });

    const responseBody = await response.text().catch(() => null);

    if (response.ok) {
      await getDb().update(webhookDeliveries)
        .set({
          status: 'success',
          attempts: attempt,
          lastAttemptAt: Date.now(),
          responseCode: response.status,
          responseBody,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    } else if (attempt < MAX_ATTEMPTS) {
      // Mark as pending for retry by the scanner (DB-based retry)
      await getDb().update(webhookDeliveries)
        .set({
          status: 'pending',
          attempts: attempt,
          lastAttemptAt: Date.now(),
          responseCode: response.status,
          responseBody,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    } else {
      // Max attempts reached — mark as permanently failed
      await getDb().update(webhookDeliveries)
        .set({
          status: 'failed',
          attempts: attempt,
          lastAttemptAt: Date.now(),
          responseCode: response.status,
          responseBody,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    if (attempt < MAX_ATTEMPTS) {
      // Mark as pending for retry by the scanner (DB-based retry)
      await getDb().update(webhookDeliveries)
        .set({
          status: 'pending',
          attempts: attempt,
          lastAttemptAt: Date.now(),
          responseBody: errorMsg,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    } else {
      // Max attempts reached — mark as permanently failed
      await getDb().update(webhookDeliveries)
        .set({
          status: 'failed',
          attempts: attempt,
          lastAttemptAt: Date.now(),
          responseBody: errorMsg,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    }
  }
}

/**
 * Periodic retry scanner for webhook deliveries.
 * Finds pending deliveries that have been attempted at least once and are
 * due for retry based on exponential backoff (2^attempts * 1000ms).
 * 
 * Runs every `intervalMs` milliseconds (default: 30 seconds).
 */
export function startRetryScanner(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const now = Date.now();

      // Find pending deliveries that have been attempted at least once
      // (attempts > 0 means they've had at least one failed attempt)
      const pending = await getDb().select().from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.status, 'pending'),
          gt(webhookDeliveries.attempts, 0),
        ))
        .limit(10);

      for (const delivery of pending) {
        // Check if enough time has passed for exponential backoff
        const backoffMs = getBackoffMs(delivery.attempts);
        const retryAfter = (delivery.lastAttemptAt ?? 0) + backoffMs;

        if (now < retryAfter) {
          continue; // Not yet due for retry
        }

        // Skip deliveries that have already reached max attempts
        // (shouldn't be pending, but defensive check)
        if (delivery.attempts >= MAX_ATTEMPTS) {
          await getDb().update(webhookDeliveries)
            .set({ status: 'failed' })
            .where(eq(webhookDeliveries.id, delivery.id));
          continue;
        }

        // Re-fetch the webhook to get the current URL and secret
        const [webhook] = await getDb().select().from(webhooks)
          .where(eq(webhooks.id, delivery.webhookId))
          .limit(1);

        if (!webhook || !webhook.enabled) {
          // Webhook deleted or disabled — mark delivery as failed
          await getDb().update(webhookDeliveries)
            .set({
              status: 'failed',
              lastAttemptAt: now,
              responseBody: webhook ? 'Webhook disabled' : 'Webhook not found',
            })
            .where(eq(webhookDeliveries.id, delivery.id));
          continue;
        }

        const signature = signPayload(delivery.payload, decryptSecret(webhook.secret));
        const nextAttempt = delivery.attempts + 1;

        getLogger().info(
          { deliveryId: delivery.id, attempt: nextAttempt, webhookId: webhook.id },
          'Retry scanner: retrying webhook delivery'
        );

        await attemptDelivery(delivery.id, webhook.url, delivery.payload, signature, nextAttempt);
      }
    } catch (err) {
      getLogger().error({ err }, 'Webhook retry scanner error');
    }
  }, intervalMs);
}

/**
 * Encrypt any plaintext webhook secrets in the database.
 * Called once at startup when WEBHOOK_ENCRYPTION_KEY is set.
 */
export async function encryptExistingSecrets(): Promise<number> {
  const config = getConfig();
  if (!config.webhookEncryptionKey) return 0;

  const key = deriveKey(config.webhookEncryptionKey);
  const allWebhooks = await getDb().select({ id: webhooks.id, secret: webhooks.secret }).from(webhooks);

  let migrated = 0;
  for (const wh of allWebhooks) {
    if (!isEncrypted(wh.secret)) {
      const encrypted = encrypt(wh.secret, key);
      await getDb().update(webhooks).set({ secret: encrypted }).where(eq(webhooks.id, wh.id));
      migrated++;
    }
  }

  if (migrated > 0) {
    getLogger().info({ count: migrated }, 'Encrypted existing plaintext webhook secrets');
  }

  return migrated;
}
