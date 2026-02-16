import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../db/index.js';
import { webhooks, webhookDeliveries } from '../db/schema.js';
import { requirePermission } from '../middleware/auth.js';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { validateWebhookUrl } from '../lib/url-validator.js';
import { encrypt, decrypt, deriveKey } from '../lib/crypto.js';
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
