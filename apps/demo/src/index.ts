#!/usr/bin/env tsx
/**
 * AgentGate Demo
 *
 * This demo shows the full approval workflow:
 * 1. Agent requests approval for an action
 * 2. Request is created with status "pending"
 * 3. Human (or this demo) approves/denies via API
 * 4. Agent receives the decision
 *
 * Usage:
 *   pnpm demo          # Run from root
 *   tsx src/index.ts   # Run from apps/demo
 *
 * Prerequisites:
 *   - Server running on http://localhost:3000
 *   - pnpm dev (from root) starts server + dashboard
 */

import { AgentGateClient, TimeoutError } from "@agentgate/sdk";

// Configuration
const SERVER_URL = process.env.AGENTGATE_URL || "http://localhost:3000";
const API_KEY = process.env.AGENTGATE_API_KEY || "";
const DEMO_APPROVER = "demo-script";

// Create SDK client
const client = new AgentGateClient({
  baseUrl: SERVER_URL,
  apiKey: API_KEY,
});

// Helper to log with timestamps
function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Helper to simulate human approval via direct API call
async function simulateApproval(
  requestId: string,
  decision: "approved" | "denied",
  reason?: string
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }
  
  const response = await fetch(
    `${SERVER_URL}/api/requests/${requestId}/decide`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision,
        decidedBy: DEMO_APPROVER,
        reason,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to submit decision: ${response.status}`);
  }

  return response.json();
}

// Demo 1: Simple approval flow
async function demoSimpleApproval() {
  console.log("\n" + "=".repeat(60));
  console.log("Demo 1: Simple Approval Flow");
  console.log("=".repeat(60));

  // Step 1: Agent requests approval
  log("Agent requesting approval for send_email action...");
  const request = await client.request({
    action: "send_email",
    params: {
      to: "customer@example.com",
      subject: "Order Confirmation",
      body: "Your order #12345 has been shipped!",
    },
    context: {
      agent: "order-notification-bot",
      orderId: "12345",
    },
    urgency: "normal",
  });

  log("Request created:", {
    id: request.id,
    action: request.action,
    status: request.status,
  });

  // If policy auto-approved/denied, we're done
  if (request.status !== "pending") {
    log(`Request was ${request.status} by policy!`);
    return;
  }

  // Step 2: Simulate human review (in real scenario, this happens in dashboard/Slack)
  log("Request is pending. Simulating human approval in 2 seconds...");
  await sleep(2000);

  // Step 3: Human approves
  log("Human approving the request...");
  await simulateApproval(request.id, "approved", "Looks good, approved!");

  // Step 4: Agent polls and receives decision
  log("Agent waiting for decision...");
  const decided = await client.waitForDecision(request.id, {
    timeout: 10000,
    pollInterval: 500,
  });

  log("Decision received!", {
    id: decided.id,
    status: decided.status,
    decidedBy: decided.decidedBy,
    decisionReason: decided.decisionReason,
  });

  // Step 5: Execute the action
  // Note: confirm() was removed in v0.5 — use audit log endpoint for tracking
  log("Agent would now execute the approved action.");
}

// Demo 2: Denial flow
async function demoDenialFlow() {
  console.log("\n" + "=".repeat(60));
  console.log("Demo 2: Denial Flow");
  console.log("=".repeat(60));

  log("Agent requesting approval for transfer_funds action...");
  const request = await client.request({
    action: "transfer_funds",
    params: {
      amount: 50000,
      currency: "USD",
      to: "external-account-999",
    },
    context: {
      agent: "finance-bot",
      reason: "Vendor payment",
    },
    urgency: "high",
  });

  log("Request created:", {
    id: request.id,
    status: request.status,
  });

  if (request.status !== "pending") {
    log(`Request was ${request.status} by policy!`);
    return;
  }

  // Simulate denial
  log("Human reviewing... This looks suspicious!");
  await sleep(1500);

  await simulateApproval(
    request.id,
    "denied",
    "Amount too high, requires manager approval"
  );

  const decided = await client.waitForDecision(request.id, {
    timeout: 5000,
  });

  log("Decision received:", {
    status: decided.status,
    reason: decided.decisionReason,
  });

  // Agent handles denial
  if (decided.status === "denied") {
    log("Agent: Action denied. Will escalate to manager.");
  }
}

// Demo 3: List pending requests
async function demoListRequests() {
  console.log("\n" + "=".repeat(60));
  console.log("Demo 3: List Requests");
  console.log("=".repeat(60));

  log("Listing all requests...");
  const requests = await client.listRequests({ limit: 5 });

  log(`Found ${requests.length} requests:`);
  for (const req of requests) {
    console.log(
      `  - [${req.status.toUpperCase()}] ${req.action} (${req.id.slice(0, 8)}...)`
    );
  }
}

// Demo 4: Timeout handling
async function demoTimeout() {
  console.log("\n" + "=".repeat(60));
  console.log("Demo 4: Timeout Handling");
  console.log("=".repeat(60));

  log("Agent requesting approval (will timeout)...");
  const request = await client.request({
    action: "delete_database",
    params: { database: "production" },
    urgency: "critical",
  });

  if (request.status !== "pending") {
    log(`Request was ${request.status} by policy!`);
    return;
  }

  log("Waiting for decision with 3s timeout (no one will approve)...");

  try {
    await client.waitForDecision(request.id, {
      timeout: 3000,
      pollInterval: 500,
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      log("Timeout! Agent handles gracefully:", error.message);
    } else {
      throw error;
    }
  }
}

// Utility
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Health check
async function checkServer(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Main
async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║               AgentGate Demo Application                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Server URL: ${SERVER_URL}`);

  // Check server connectivity
  log("Checking server connectivity...");
  const isHealthy = await checkServer();
  if (!isHealthy) {
    console.error("\n❌ Cannot connect to AgentGate server!");
    console.error(`   Make sure the server is running at ${SERVER_URL}`);
    console.error("   Start it with: pnpm dev (from project root)");
    process.exit(1);
  }
  log("Server is healthy! ✓");

  try {
    // Run demos
    await demoSimpleApproval();
    await demoDenialFlow();
    await demoListRequests();
    await demoTimeout();

    console.log("\n" + "=".repeat(60));
    console.log("✅ All demos completed!");
    console.log("=".repeat(60));
    console.log("\nNext steps:");
    console.log("  - Open the dashboard at http://localhost:5173");
    console.log("  - View and manage requests in real-time");
    console.log("  - Try the Slack integration for mobile approvals");
    console.log();
  } catch (error) {
    console.error("\n❌ Demo failed:", error);
    process.exit(1);
  }
}

main();
