/**
 * Shared HTTP client for AgentGate API communication.
 *
 * Consolidates Bearer-token auth + JSON fetch logic that was
 * previously duplicated across packages (MCP, SDK, CLI).
 */
export class AgentGateHttpClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private timeoutMs = 30_000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = `AgentGate API error: ${response.status}`;
      try {
        const json = JSON.parse(text);
        message = json.error || json.message || message;
      } catch {
        // ignore parse errors — keep the default message
      }
      throw new Error(message);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
