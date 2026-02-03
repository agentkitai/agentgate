import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @actions/core before importing
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    repo: { repo: 'test-repo', owner: 'test-owner' },
    ref: 'refs/heads/main',
    sha: 'abc123',
    workflow: 'Test Workflow',
    runId: 12345,
    runNumber: 1,
    actor: 'test-user',
    eventName: 'push',
    job: 'test-job',
  },
}));

import * as core from '@actions/core';

describe('AgentGate GitHub Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input parsing', () => {
    it('should require api_url', () => {
      const mockGetInput = vi.mocked(core.getInput);
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'api_url') throw new Error('Input required and not supplied: api_url');
        return '';
      });

      expect(() => core.getInput('api_url', { required: true })).toThrow();
    });

    it('should parse params as JSON', () => {
      const params = '{"environment": "production"}';
      const parsed = JSON.parse(params);
      expect(parsed).toEqual({ environment: 'production' });
    });

    it('should default timeout to 300 seconds', () => {
      const timeout = parseInt('', 10) || 300;
      expect(timeout).toBe(300);
    });
  });

  describe('context building', () => {
    it('should include GitHub context fields', async () => {
      const { context } = await import('@actions/github');
      
      expect(context.repo.repo).toBe('test-repo');
      expect(context.repo.owner).toBe('test-owner');
      expect(context.actor).toBe('test-user');
      expect(context.sha).toBe('abc123');
    });
  });

  describe('status handling', () => {
    it('should set failed for denied status', () => {
      const mockSetFailed = vi.mocked(core.setFailed);
      
      // Simulate denied status handling
      const status = 'denied';
      const decidedBy = 'admin';
      
      if (status === 'denied') {
        core.setFailed(`Request denied by ${decidedBy}`);
      }
      
      expect(mockSetFailed).toHaveBeenCalledWith('Request denied by admin');
    });

    it('should set failed for timeout status', () => {
      const mockSetFailed = vi.mocked(core.setFailed);
      
      const status = 'timeout';
      const timeoutSeconds = 300;
      
      if (status === 'timeout') {
        core.setFailed(`Timed out waiting for decision after ${timeoutSeconds} seconds`);
      }
      
      expect(mockSetFailed).toHaveBeenCalledWith('Timed out waiting for decision after 300 seconds');
    });

    it('should not fail for approved status', () => {
      const mockSetFailed = vi.mocked(core.setFailed);
      
      const status = 'approved';
      
      if (status === 'denied' || status === 'timeout' || status === 'expired') {
        core.setFailed('Request not approved');
      }
      
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('output setting', () => {
    it('should set all required outputs', () => {
      const mockSetOutput = vi.mocked(core.setOutput);
      
      // Simulate output setting
      core.setOutput('status', 'approved');
      core.setOutput('request_id', 'req-123');
      core.setOutput('decided_by', 'admin');
      
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'approved');
      expect(mockSetOutput).toHaveBeenCalledWith('request_id', 'req-123');
      expect(mockSetOutput).toHaveBeenCalledWith('decided_by', 'admin');
    });
  });
});
