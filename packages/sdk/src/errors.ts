// @agentkitai/agentgate-sdk - Error types

/**
 * Error thrown by AgentGate SDK operations
 */
export class AgentGateError extends Error {
  /** HTTP status code (if applicable) */
  public readonly statusCode: number;
  /** Error code for programmatic handling */
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'AgentGateError';
    this.statusCode = statusCode;
    this.code = code;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentGateError);
    }
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends AgentGateError {
  constructor(message: string = 'Request timed out') {
    super(message, 408, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}
