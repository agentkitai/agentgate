import { describe, it, expect, vi, beforeEach } from 'vitest';
import dns from 'dns/promises';
import { isPrivateIP, isCloudMetadata, validateWebhookUrl } from '../lib/url-validator.js';

// Mock DNS resolution for testing
vi.mock('dns/promises', () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
  },
}));

describe('isPrivateIP', () => {
  describe('IPv4 private ranges', () => {
    it('blocks 127.x.x.x (loopback)', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.255.255.255')).toBe(true);
    });

    it('blocks 10.x.x.x (Class A private)', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('blocks 172.16-31.x.x (Class B private)', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      // Should NOT block 172.15 or 172.32
      expect(isPrivateIP('172.15.0.1')).toBe(false);
      expect(isPrivateIP('172.32.0.1')).toBe(false);
    });

    it('blocks 192.168.x.x (Class C private)', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isPrivateIP('169.254.0.1')).toBe(true);
      expect(isPrivateIP('169.254.255.255')).toBe(true);
    });

    it('blocks 0.x.x.x', () => {
      expect(isPrivateIP('0.0.0.0')).toBe(true);
      expect(isPrivateIP('0.255.255.255')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });
  });

  describe('IPv6 private addresses', () => {
    it('blocks ::1 (loopback)', () => {
      expect(isPrivateIP('::1')).toBe(true);
    });

    it('blocks fe80:: (link-local)', () => {
      expect(isPrivateIP('fe80::')).toBe(true);
      expect(isPrivateIP('fe80::1')).toBe(true);
    });

    it('blocks fc00::/fd00:: (unique local)', () => {
      expect(isPrivateIP('fc00::')).toBe(true);
      expect(isPrivateIP('fd12:3456:789a::1')).toBe(true);
    });

    it('blocks IPv4-mapped private IPs', () => {
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateIP('::ffff:172.16.0.1')).toBe(true);
    });

    it('allows public IPv6', () => {
      expect(isPrivateIP('2001:4860:4860::8888')).toBe(false);
    });
  });
});

describe('isCloudMetadata', () => {
  it('blocks AWS/GCP/Azure metadata IP', () => {
    expect(isCloudMetadata('169.254.169.254')).toBe(true);
  });

  it('blocks AWS ECS metadata IP', () => {
    expect(isCloudMetadata('169.254.170.2')).toBe(true);
  });

  it('blocks IPv6 metadata', () => {
    expect(isCloudMetadata('fd00:ec2::254')).toBe(true);
  });

  it('blocks IPv4-mapped metadata', () => {
    expect(isCloudMetadata('::ffff:169.254.169.254')).toBe(true);
  });

  it('allows other IPs', () => {
    expect(isCloudMetadata('8.8.8.8')).toBe(false);
    expect(isCloudMetadata('169.254.1.1')).toBe(false); // Link-local but not metadata
  });
});

describe('validateWebhookUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('protocol validation', () => {
    it('allows http URLs', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);
      
      const result = await validateWebhookUrl('http://example.com/webhook');
      expect(result.valid).toBe(true);
    });

    it('allows https URLs', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);
      
      const result = await validateWebhookUrl('https://example.com/webhook');
      expect(result.valid).toBe(true);
    });

    it('rejects file:// URLs', async () => {
      const result = await validateWebhookUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTP');
    });

    it('rejects ftp:// URLs', async () => {
      const result = await validateWebhookUrl('ftp://example.com/');
      expect(result.valid).toBe(false);
    });
  });

  describe('hostname validation', () => {
    it('blocks localhost', async () => {
      const result = await validateWebhookUrl('http://localhost/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('blocks localhost.localdomain', async () => {
      const result = await validateWebhookUrl('http://localhost.localdomain/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks metadata.google.internal', async () => {
      const result = await validateWebhookUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.valid).toBe(false);
    });

    it('blocks subdomains of blocked hosts', async () => {
      const result = await validateWebhookUrl('http://foo.localhost/webhook');
      expect(result.valid).toBe(false);
    });
  });

  describe('IP address validation (direct)', () => {
    it('blocks 127.0.0.1 directly', async () => {
      const result = await validateWebhookUrl('http://127.0.0.1/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('blocks 10.x.x.x directly', async () => {
      const result = await validateWebhookUrl('http://10.0.0.1/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks 192.168.x.x directly', async () => {
      const result = await validateWebhookUrl('http://192.168.1.1/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks 172.16-31.x.x directly', async () => {
      const result = await validateWebhookUrl('http://172.20.0.1/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks cloud metadata IP directly', async () => {
      const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metadata');
    });

    it('allows public IP directly', async () => {
      const result = await validateWebhookUrl('http://93.184.216.34/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('IP bypass attempts', () => {
    it('blocks decimal IP encoding (2130706433 = 127.0.0.1)', async () => {
      const result = await validateWebhookUrl('http://2130706433/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('blocks hex IP encoding (0x7f000001 = 127.0.0.1)', async () => {
      const result = await validateWebhookUrl('http://0x7f000001/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks octal IP encoding (0177.0.0.1 = 127.0.0.1)', async () => {
      const result = await validateWebhookUrl('http://0177.0.0.1/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks decimal metadata IP (2852039166 = 169.254.169.254)', async () => {
      const result = await validateWebhookUrl('http://2852039166/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metadata');
    });
  });

  describe('DNS resolution validation', () => {
    it('blocks hostname resolving to private IP', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['10.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://internal.example.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('resolves to private IP');
    });

    it('blocks hostname resolving to loopback', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['127.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://evil.example.com/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks hostname resolving to metadata IP', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['169.254.169.254']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://metadata-proxy.example.com/');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metadata');
    });

    it('blocks if ANY resolved IP is private (multi-A record attack)', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34', '127.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://multi.example.com/webhook');
      expect(result.valid).toBe(false);
    });

    it('blocks private IPv6 resolution', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue([]);
      vi.mocked(dns.resolve6).mockResolvedValue(['::1']);

      const result = await validateWebhookUrl('http://ipv6-loopback.example.com/webhook');
      expect(result.valid).toBe(false);
    });

    it('rejects if DNS resolution fails completely', async () => {
      vi.mocked(dns.resolve4).mockRejectedValue(new Error('NXDOMAIN'));
      vi.mocked(dns.resolve6).mockRejectedValue(new Error('NXDOMAIN'));

      const result = await validateWebhookUrl('http://nonexistent.example.com/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('resolve');
    });

    it('allows valid public hostname', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34']);
      vi.mocked(dns.resolve6).mockResolvedValue(['2606:2800:220:1:248:1893:25c8:1946']);

      const result = await validateWebhookUrl('https://example.com/webhook');
      expect(result.valid).toBe(true);
      expect(result.resolvedIP).toBe('93.184.216.34');
    });
  });

  describe('invalid URL handling', () => {
    it('rejects malformed URLs', async () => {
      const result = await validateWebhookUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('rejects empty string', async () => {
      const result = await validateWebhookUrl('');
      expect(result.valid).toBe(false);
    });
  });

  describe('allowPrivate dev/test escape hatch', () => {
    it('rejects loopback by default (flag unset)', async () => {
      const result = await validateWebhookUrl('http://127.0.0.1:8787/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('accepts loopback IP when allowPrivate is set', async () => {
      const result = await validateWebhookUrl('http://127.0.0.1:8787/webhook', { allowPrivate: true });
      expect(result.valid).toBe(true);
      expect(result.resolvedIP).toBe('127.0.0.1');
    });

    it('accepts localhost hostname when allowPrivate is set', async () => {
      // localhost is not a literal IP, so it goes through DNS resolution → 127.0.0.1
      vi.mocked(dns.resolve4).mockResolvedValue(['127.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://localhost:8787/webhook', { allowPrivate: true });
      expect(result.valid).toBe(true);
    });

    it('STILL blocks localhost hostname by default (flag unset)', async () => {
      const result = await validateWebhookUrl('http://localhost:8787/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('accepts private RFC-1918 IPs when allowPrivate is set', async () => {
      expect((await validateWebhookUrl('http://10.0.0.5/hook', { allowPrivate: true })).valid).toBe(true);
      expect((await validateWebhookUrl('http://192.168.1.10/hook', { allowPrivate: true })).valid).toBe(true);
      expect((await validateWebhookUrl('http://172.20.0.1/hook', { allowPrivate: true })).valid).toBe(true);
    });

    it('accepts IPv6 loopback when allowPrivate is set', async () => {
      const result = await validateWebhookUrl('http://[::1]:8787/webhook', { allowPrivate: true });
      expect(result.valid).toBe(true);
    });

    it('accepts hostname resolving to a private IP when allowPrivate is set', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['127.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://lvh.me:8787/webhook', { allowPrivate: true });
      expect(result.valid).toBe(true);
    });

    it('always accepts public URLs regardless of the flag', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      expect((await validateWebhookUrl('https://example.com/webhook')).valid).toBe(true);
      expect((await validateWebhookUrl('https://example.com/webhook', { allowPrivate: true })).valid).toBe(true);
    });

    it('STILL blocks cloud metadata even when allowPrivate is set', async () => {
      const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data/', { allowPrivate: true });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metadata');
    });

    it('STILL blocks cloud metadata hostnames even when allowPrivate is set', async () => {
      const result = await validateWebhookUrl('http://metadata.google.internal/computeMetadata/v1/', { allowPrivate: true });
      expect(result.valid).toBe(false);
    });

    it('STILL blocks a hostname resolving to the metadata IP when allowPrivate is set', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['169.254.169.254']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      const result = await validateWebhookUrl('http://metadata-proxy.example.com/', { allowPrivate: true });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('metadata');
    });

    it('STILL blocks non-HTTP protocols even when allowPrivate is set', async () => {
      const result = await validateWebhookUrl('file:///etc/passwd', { allowPrivate: true });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('HTTP');
    });

    it('STILL blocks decimal-encoded loopback by default', async () => {
      const result = await validateWebhookUrl('http://2130706433/webhook');
      expect(result.valid).toBe(false);
    });
  });
});
