import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const FRAMES_DIR = './frames';
const API_URL = 'http://localhost:3000';
const DASHBOARD_URL = 'http://localhost:5173';
const API_KEY = 'agk_7xeX0DWKR3qqLylACoPheccLc2Yb1qgFZYOlOSSibPY';

if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

async function waitForServer(url, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function createRequest(action, version, service, urgency = 'normal') {
  const res = await fetch(`${API_URL}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      action,
      params: { version, service, environment: 'production' },
      context: { 
        author: 'github-actions', 
        commit: 'abc123f',
        changes: ['Payment gateway v2', 'Bug fixes']
      },
      urgency
    })
  });
  return res.json();
}

async function approveRequest(id) {
  const res = await fetch(`${API_URL}/api/requests/${id}/decide`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({ 
      decision: 'approved', 
      reason: 'Reviewed changes - LGTM!',
      decidedBy: 'admin@example.com'
    })
  });
  return res.json();
}

async function main() {
  console.log('🎬 Starting demo capture...\n');

  console.log('Waiting for API server...');
  if (!await waitForServer(`${API_URL}/health`)) {
    console.error('API server not available');
    process.exit(1);
  }
  console.log('✓ API server ready');

  console.log('Waiting for dashboard...');
  if (!await waitForServer(DASHBOARD_URL)) {
    console.error('Dashboard not available');
    process.exit(1);
  }
  console.log('✓ Dashboard ready\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2
  });
  
  // Set localStorage BEFORE navigating
  await context.addInitScript((key) => {
    localStorage.setItem('agentgate_api_key', key);
  }, API_KEY);
  
  const page = await context.newPage();

  let frameNum = 0;
  const screenshot = async (name) => {
    const filename = `${String(frameNum++).padStart(4, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(FRAMES_DIR, filename) });
    console.log(`📸 Captured: ${filename}`);
    return filename;
  };

  try {
    // Go directly to dashboard (should skip login because of localStorage)
    console.log('\n📍 Scene 1: Dashboard (empty state)');
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 2000));
    await screenshot('dashboard-empty');

    // Create requests
    console.log('\n📍 Scene 2: AI agents request approvals');
    const req1 = await createRequest('deploy:production', '2.1.0', 'payment-api', 'high');
    const req2 = await createRequest('scale:cluster', '50-nodes', 'kubernetes', 'normal');
    const req3 = await createRequest('release:canary', '1.5.0', 'frontend', 'low');
    console.log(`   Created 3 requests`);
    
    await page.reload();
    await page.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 2000));
    await screenshot('requests-pending');

    // Click on a request to see details (if applicable)
    console.log('\n📍 Scene 3: View request details');
    const row = page.locator('table tbody tr').first();
    if (await row.count() > 0) {
      await row.click();
      await new Promise(r => setTimeout(r, 1500));
      await screenshot('request-detail');
    }

    // Approve the high-priority request
    console.log('\n📍 Scene 4: Human approves deployment');
    const result = await approveRequest(req1.id);
    console.log(`   Approval result: ${result.status || result.error || 'done'}`);
    
    await page.reload();
    await page.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 2000));
    await screenshot('after-approval');

    // Check audit log if available
    console.log('\n📍 Scene 5: Audit trail');
    const auditNav = page.locator('nav a, aside a, a').filter({ hasText: /audit/i }).first();
    if (await auditNav.count() > 0) {
      await auditNav.click();
      await page.waitForLoadState('networkidle');
      await new Promise(r => setTimeout(r, 1500));
      await screenshot('audit-log');
    }

    console.log('\n✅ Capture complete!');
    console.log(`   Frames in: ${FRAMES_DIR}/`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
