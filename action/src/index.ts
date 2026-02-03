import * as core from '@actions/core';
import * as github from '@actions/github';

interface ApprovalRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  urgency: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  expiresAt?: string;
}

interface ApiError {
  message?: string;
  code?: string;
}

/**
 * Make an HTTP request to the AgentGate API
 */
async function apiRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const errorBody = (await response.json()) as ApiError;
      if (errorBody.message) {
        message = errorBody.message;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('Content-Type');
  if (response.status === 204 || !contentType?.includes('application/json')) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Create an approval request
 */
async function createRequest(
  apiUrl: string,
  apiKey: string,
  action: string,
  params: Record<string, unknown>,
  context: Record<string, unknown>
): Promise<ApprovalRequest> {
  return apiRequest<ApprovalRequest>(apiUrl, apiKey, 'POST', '/api/requests', {
    action,
    params,
    context,
    urgency: 'normal',
  });
}

/**
 * Get an approval request by ID
 */
async function getRequest(
  apiUrl: string,
  apiKey: string,
  id: string
): Promise<ApprovalRequest> {
  return apiRequest<ApprovalRequest>(
    apiUrl,
    apiKey,
    'GET',
    `/api/requests/${id}`
  );
}

/**
 * Wait for a decision with timeout
 */
async function waitForDecision(
  apiUrl: string,
  apiKey: string,
  requestId: string,
  timeoutSeconds: number,
  pollIntervalMs = 5000
): Promise<{ status: string; request: ApprovalRequest | null }> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    try {
      const request = await getRequest(apiUrl, apiKey, requestId);

      // Check if decision has been made
      if (request.status !== 'pending') {
        return { status: request.status, request };
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        return { status: 'timeout', request: null };
      }

      // Log progress
      const remaining = Math.ceil((timeoutMs - elapsed) / 1000);
      core.info(`Waiting for decision... ${remaining}s remaining`);

      // Wait before next poll
      await sleep(pollIntervalMs);
    } catch (error) {
      core.warning(`Error polling for decision: ${error}`);
      await sleep(pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build context from GitHub Actions environment
 */
function buildContext(): Record<string, unknown> {
  const context = github.context;

  return {
    github: {
      repository: context.repo.repo,
      owner: context.repo.owner,
      ref: context.ref,
      sha: context.sha,
      workflow: context.workflow,
      runId: context.runId,
      runNumber: context.runNumber,
      actor: context.actor,
      eventName: context.eventName,
      job: context.job,
    },
    environment: {
      runner_os: process.env.RUNNER_OS,
      runner_arch: process.env.RUNNER_ARCH,
    },
  };
}

/**
 * Main action entry point
 */
async function run(): Promise<void> {
  try {
    // Get inputs
    const apiUrl = core.getInput('api_url', { required: true });
    const apiKey = core.getInput('api_key', { required: true });
    const actionName = core.getInput('action_name', { required: true });
    const paramsInput = core.getInput('params') || '{}';
    const timeoutSeconds = parseInt(core.getInput('timeout_seconds') || '300', 10);

    // Parse params
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(paramsInput);
    } catch {
      throw new Error(`Invalid JSON in params input: ${paramsInput}`);
    }

    // Build context from GitHub environment
    const context = buildContext();

    core.info(`Creating approval request for action: ${actionName}`);
    core.info(`Timeout: ${timeoutSeconds} seconds`);

    // Create the approval request
    const request = await createRequest(apiUrl, apiKey, actionName, params, context);
    core.info(`Created approval request: ${request.id}`);

    // Set request_id output immediately
    core.setOutput('request_id', request.id);

    // Wait for decision
    core.info('Waiting for approval decision...');
    const result = await waitForDecision(
      apiUrl,
      apiKey,
      request.id,
      timeoutSeconds
    );

    // Set outputs
    core.setOutput('status', result.status);
    core.setOutput('decided_by', result.request?.decidedBy || '');

    // Log result
    switch (result.status) {
      case 'approved':
        core.info(`✅ Request approved by ${result.request?.decidedBy || 'unknown'}`);
        break;
      case 'denied':
        core.setFailed(
          `❌ Request denied by ${result.request?.decidedBy || 'unknown'}${
            result.request?.decisionReason
              ? `: ${result.request.decisionReason}`
              : ''
          }`
        );
        break;
      case 'expired':
        core.setFailed('⏰ Request expired before a decision was made');
        break;
      case 'timeout':
        core.setFailed(`⏱️ Timed out waiting for decision after ${timeoutSeconds} seconds`);
        break;
      default:
        core.setFailed(`Unknown status: ${result.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
  }
}

// Run the action
run();
