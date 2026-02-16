import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { createApiKey, revokeApiKey } from '../lib/api-keys.js';
import { requirePermission } from '../middleware/auth.js';

const router = new Hono();

// All routes require admin scope
router.use('*', requirePermission('keys:manage'));

// Create new API key
const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  rateLimit: z.number().int().positive().nullable().optional(),
});

router.post('/', zValidator('json', createKeySchema), async (c) => {
  const { name, scopes, rateLimit } = c.req.valid('json');
  const { id, key } = await createApiKey(name, scopes, rateLimit ?? null);
  
  // Return key ONCE - it won't be shown again
  return c.json({ 
    id, 
    key,  // Only returned on creation!
    name, 
    scopes,
    rateLimit: rateLimit ?? null,
    message: 'Save this key - it will not be shown again'
  }, 201);
});

// List API keys (without the actual key)
router.get('/', async (c) => {
  const keys = await getDb().select({
    id: apiKeys.id,
    name: apiKeys.name,
    scopes: apiKeys.scopes,
    createdAt: apiKeys.createdAt,
    lastUsedAt: apiKeys.lastUsedAt,
    revokedAt: apiKeys.revokedAt,
    rateLimit: apiKeys.rateLimit,
  }).from(apiKeys);
  
  return c.json({ 
    keys: keys.map(k => ({
      ...k,
      scopes: JSON.parse(k.scopes),
      active: k.revokedAt === null,
    }))
  });
});

// Update API key
const updateKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).min(1).optional(),
  rateLimit: z.number().int().positive().nullable().optional(),
});

router.patch('/:id', zValidator('json', updateKeySchema), async (c) => {
  const id = c.req.param('id');
  const { name, scopes, rateLimit } = c.req.valid('json');
  
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (scopes !== undefined) updateData.scopes = JSON.stringify(scopes);
  if (rateLimit !== undefined) updateData.rateLimit = rateLimit;
  
  if (Object.keys(updateData).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }
  
  await getDb().update(apiKeys).set(updateData).where(eq(apiKeys.id, id));
  
  return c.json({ success: true });
});

// Revoke API key
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await revokeApiKey(id);
  return c.json({ success: true, message: 'API key revoked' });
});

export default router;
