import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../db/index.js';
import { webhooks, webhookDeliveries } from '../db/schema.js';
import { requirePermission } from '../middleware/auth.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { validateWebhookUrl } from '../lib/url-validator.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
import { signPayload } from '../lib/webhook.js';
import { getConfig } from '../config.js';

const router = new Hono();

// All routes require admin scope
router.use('*', requirePermission('webhooks:manage'));

// Create webhook
const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1), // e.g., ["request.approved", "request.denied"]
  secret: z.string().min(32).optional(), // Auto-generate if not provided
});

router.post('/', zValidator('json', createWebhookSchema), async (c) => {
  const { url, events, secret } = c.req.valid('json');
  
  // SSRF protection: validate URL before accepting
  const validation = await validateWebhookUrl(url);
  if (!validation.valid) {
    return c.json({ error: `Invalid webhook URL: ${validation.error}` }, 400);
  }
  
  const id = nanoid();
  const webhookSecret = secret || crypto.randomBytes(32).toString('hex');
  
  // Encrypt secret at rest if encryption key is configured
  const config = getConfig();
  const storedSecret = config.webhookEncryptionKey
    ? encrypt(webhookSecret, deriveKey(config.webhookEncryptionKey))
    : webhookSecret;
  
  await getDb().insert(webhooks).values({
    id,
    url,
    events: JSON.stringify(events),
    secret: storedSecret,
    createdAt: Date.now(),
    enabled: 1,
  });
  
  return c.json({ 
    id, 
    url, 
    events, 
    secret: webhookSecret, // Only shown once on creation
    enabled: true,
    message: 'Save this secret - it will not be shown again'
  }, 201);
});

// List webhooks (without secrets)
router.get('/', async (c) => {
  const result = await getDb().select({
    id: webhooks.id,
    url: webhooks.url,
    events: webhooks.events,
    createdAt: webhooks.createdAt,
    enabled: webhooks.enabled,
  }).from(webhooks);
  
  return c.json({ 
    webhooks: result.map(w => ({
      ...w,
      events: JSON.parse(w.events),
      enabled: w.enabled === 1,
    }))
  });
});

// Aggregate webhook stats
router.get('/stats', async (c) => {
  // Get all delivery stats grouped by webhook
  const allDeliveries = await getDb().select({
    webhookId: webhookDeliveries.webhookId,
    status: webhookDeliveries.status,
    responseCode: webhookDeliveries.responseCode,
    lastAttemptAt: webhookDeliveries.lastAttemptAt,
  }).from(webhookDeliveries);

  const allWebhooks = await getDb().select({
    id: webhooks.id,
    url: webhooks.url,
    enabled: webhooks.enabled,
  }).from(webhooks);

  // Compute per-webhook breakdown
  const webhookMap = new Map<string, {
    webhookId: string;
    url: string;
    totalDeliveries: number;
    successCount: number;
    failureCount: number;
    pendingRetries: number;
    lastDeliveryAt: number | null;
  }>();

  for (const wh of allWebhooks) {
    webhookMap.set(wh.id, {
      webhookId: wh.id,
      url: wh.url,
      totalDeliveries: 0,
      successCount: 0,
      failureCount: 0,
      pendingRetries: 0,
      lastDeliveryAt: null,
    });
  }

  let totalDeliveries = 0;
  let totalSuccess = 0;
  let totalFailure = 0;
  let totalPendingRetries = 0;

  for (const d of allDeliveries) {
    totalDeliveries++;
    const entry = webhookMap.get(d.webhookId);

    if (d.status === 'success') {
      totalSuccess++;
      if (entry) entry.successCount++;
    } else if (d.status === 'failed') {
      totalFailure++;
      if (entry) entry.failureCount++;
    } else if (d.status === 'pending') {
      totalPendingRetries++;
      if (entry) entry.pendingRetries++;
    }

    if (entry) {
      entry.totalDeliveries++;
      if (d.lastAttemptAt && d.lastAttemptAt > (entry.lastDeliveryAt ?? 0)) {
        entry.lastDeliveryAt = d.lastAttemptAt;
      }
    }
  }

  // Compute per-webhook stats
  const perWebhook = Array.from(webhookMap.values()).map((w) => {
    const total = w.successCount + w.failureCount + w.pendingRetries;
    return {
      webhookId: w.webhookId,
      url: w.url,
      successRate: total > 0 ? Math.round((w.successCount / total) * 10000) / 100 : 0,
      avgLatencyMs: 0,
      pendingRetries: w.pendingRetries,
      lastDeliveryAt: w.lastDeliveryAt,
    };
  });

  const successRate = totalDeliveries > 0
    ? Math.round((totalSuccess / totalDeliveries) * 10000) / 100
    : 0;

  return c.json({
    totalDeliveries,
    successCount: totalSuccess,
    failureCount: totalFailure,
    successRate,
    avgResponseTimeMs: 0,
    pendingRetryCount: totalPendingRetries,
    perWebhook,
  });
});

// Replay a failed delivery (before /:id routes to avoid param conflict)
router.post('/deliveries/:id/replay', async (c) => {
  const deliveryId = c.req.param('id');

  // Load the delivery record
  const [delivery] = await getDb().select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);

  if (!delivery) {
    return c.json({ error: 'Delivery not found' }, 404);
  }

  if (delivery.status !== 'failed') {
    return c.json({ error: 'Only failed deliveries can be replayed' }, 400);
  }

  // Load the associated webhook
  const [webhook] = await getDb().select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1);

  if (!webhook) {
    return c.json({ error: 'Associated webhook not found' }, 404);
  }

  if (!webhook.enabled) {
    return c.json({ error: 'Webhook is disabled' }, 400);
  }

  // SSRF protection: re-validate URL
  const validation = await validateWebhookUrl(webhook.url);
  if (!validation.valid) {
    return c.json({ error: `Webhook URL no longer valid: ${validation.error}` }, 400);
  }

  // Decrypt secret and sign payload
  const config = getConfig();
  const secret = config.webhookEncryptionKey
    ? decrypt(webhook.secret, deriveKey(config.webhookEncryptionKey))
    : webhook.secret;
  const signature = signPayload(delivery.payload, secret);

  // Re-send the original payload
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentGate-Signature': signature,
      },
      body: delivery.payload,
    });

    const responseBody = await response.text().catch(() => null);
    const newAttempts = delivery.attempts + 1;
    const newStatus = response.ok ? 'success' : 'failed';

    await getDb().update(webhookDeliveries)
      .set({
        status: newStatus,
        attempts: newAttempts,
        lastAttemptAt: Date.now(),
        responseCode: response.status,
        responseBody,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // Re-fetch updated delivery
    const [updated] = await getDb().select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId))
      .limit(1);

    return c.json({
      success: response.ok,
      delivery: updated,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Connection failed';
    const newAttempts = delivery.attempts + 1;

    await getDb().update(webhookDeliveries)
      .set({
        status: 'failed',
        attempts: newAttempts,
        lastAttemptAt: Date.now(),
        responseBody: errorMsg,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    const [updated] = await getDb().select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId))
      .limit(1);

    return c.json({
      success: false,
      delivery: updated,
    });
  }
});

// Get webhook with recent deliveries
router.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const webhook = await getDb().select({
    id: webhooks.id,
    url: webhooks.url,
    events: webhooks.events,
    createdAt: webhooks.createdAt,
    enabled: webhooks.enabled,
  }).from(webhooks).where(eq(webhooks.id, id)).limit(1);
  
  const webhookRecord = webhook[0];
  if (!webhookRecord) {
    return c.json({ error: 'Webhook not found' }, 404);
  }
  
  // Get recent deliveries
  const deliveries = await getDb().select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.lastAttemptAt))
    .limit(20);
  
  return c.json({
    ...webhookRecord,
    events: JSON.parse(webhookRecord.events),
    enabled: webhookRecord.enabled === 1,
    deliveries,
  });
});

// Paginated delivery records for a specific webhook
router.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const statusFilter = c.req.query('status'); // pending | success | failed

  // Verify webhook exists
  const [webhook] = await getDb().select({ id: webhooks.id })
    .from(webhooks)
    .where(eq(webhooks.id, id))
    .limit(1);

  if (!webhook) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  // Build conditions
  const conditions = [eq(webhookDeliveries.webhookId, id)];
  if (statusFilter && ['pending', 'success', 'failed'].includes(statusFilter)) {
    conditions.push(eq(webhookDeliveries.status, statusFilter as 'pending' | 'success' | 'failed'));
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const deliveries = await getDb().select()
    .from(webhookDeliveries)
    .where(whereClause)
    .orderBy(desc(webhookDeliveries.lastAttemptAt))
    .limit(limit)
    .offset(offset);

  // Get total count for pagination
  const [countResult] = await getDb().select({
    count: sql<number>`count(*)`,
  }).from(webhookDeliveries).where(whereClause);

  const total = countResult?.count ?? 0;

  return c.json({
    deliveries,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

// Update webhook
const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().optional(),
});

router.patch('/:id', zValidator('json', updateWebhookSchema), async (c) => {
  const id = c.req.param('id');
  const updates = c.req.valid('json');
  
  // SSRF protection: validate URL if being updated
  if (updates.url) {
    const validation = await validateWebhookUrl(updates.url);
    if (!validation.valid) {
      return c.json({ error: `Invalid webhook URL: ${validation.error}` }, 400);
    }
  }
  
  const updateData: Record<string, unknown> = {};
  if (updates.url) updateData.url = updates.url;
  if (updates.events) updateData.events = JSON.stringify(updates.events);
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled ? 1 : 0;
  
  await getDb().update(webhooks).set(updateData).where(eq(webhooks.id, id));
  
  return c.json({ success: true });
});

// Delete webhook
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await getDb().delete(webhooks).where(eq(webhooks.id, id));
  return c.json({ success: true });
});

// Test webhook
router.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  
  const webhook = await getDb().select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  const webhookRecord = webhook[0];
  if (!webhookRecord) {
    return c.json({ error: 'Webhook not found' }, 404);
  }
  
  // SSRF protection: re-validate URL (DNS rebinding defense)
  const validation = await validateWebhookUrl(webhookRecord.url);
  if (!validation.valid) {
    return c.json({ error: `Webhook URL no longer valid: ${validation.error}` }, 400);
  }
  
  const testPayload = {
    event: 'test',
    data: { message: 'This is a test webhook from AgentGate' },
    timestamp: Date.now(),
  };
  
  const payloadStr = JSON.stringify(testPayload);
  const config = getConfig();
  const secret = config.webhookEncryptionKey
    ? decrypt(webhookRecord.secret, deriveKey(config.webhookEncryptionKey))
    : webhookRecord.secret;
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  
  try {
    const response = await fetch(webhookRecord.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentGate-Signature': signature,
      },
      body: payloadStr,
    });
    
    return c.json({ 
      success: response.ok, 
      status: response.status,
      message: response.ok ? 'Test delivered successfully' : 'Delivery failed'
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Connection failed'
    }, 500);
  }
});

export default router;
