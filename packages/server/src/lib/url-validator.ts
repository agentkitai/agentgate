import dns from 'dns/promises';
import { URL } from 'url';

/**
 * SSRF Protection for webhook URLs
 * Blocks internal IPs, cloud metadata endpoints, and other dangerous destinations
 */

// Private IPv4 ranges
const PRIVATE_IPV4_RANGES = [
  { prefix: '10.', description: '10.0.0.0/8' },
  { prefix: '127.', description: '127.0.0.0/8 (loopback)' },
  { prefix: '192.168.', description: '192.168.0.0/16' },
  { prefix: '0.', description: '0.0.0.0/8' },
];

// 172.16.0.0 - 172.31.255.255 needs special handling
function isPrivate172Range(ip: string): boolean {
  const match = ip.match(/^172\.(\d+)\./);
  if (!match || !match[1]) return false;
  const secondOctet = parseInt(match[1], 10);
  return secondOctet >= 16 && secondOctet <= 31;
}

// Private/reserved IPv6 addresses
const PRIVATE_IPV6_PATTERNS = [
  /^::1$/i,                     // Loopback
  /^fe80:/i,                    // Link-local
  /^fc00:/i,                    // Unique local (fc00::/7)
  /^fd[0-9a-f]{2}:/i,           // Unique local
  /^::$/,                       // Unspecified
  /^::ffff:(?:10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i, // IPv4-mapped private
  /^::ffff:169\.254\./i,        // IPv4-mapped link-local
  /^::ffff:0\./i,               // IPv4-mapped 0.0.0.0/8
];

// Cloud metadata endpoints
const CLOUD_METADATA_IPS = [
  '169.254.169.254',  // AWS, GCP, Azure IMDS
  '169.254.170.2',    // AWS ECS metadata
  'fd00:ec2::254',    // AWS IPv6 IMDS
];

const CLOUD_METADATA_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
];

// Loopback / local hostnames — blocked by default, but permitted when the
// dev/test allowPrivate escape hatch is on (see validateWebhookUrl).
const LOOPBACK_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  ...LOOPBACK_HOSTNAMES,
  ...CLOUD_METADATA_HOSTNAMES,
];

/**
 * Check if an IP address is in a private/reserved range
 */
export function isPrivateIP(ip: string): boolean {
  // Check simple IPv4 prefixes
  for (const range of PRIVATE_IPV4_RANGES) {
    if (ip.startsWith(range.prefix)) {
      return true;
    }
  }

  // Check 172.16-31.x.x range
  if (isPrivate172Range(ip)) {
    return true;
  }

  // Link-local IPv4 (169.254.x.x)
  if (ip.startsWith('169.254.')) {
    return true;
  }

  // Check IPv6 private patterns
  for (const pattern of PRIVATE_IPV6_PATTERNS) {
    if (pattern.test(ip)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an IP is a cloud metadata endpoint
 */
export function isCloudMetadata(ip: string): boolean {
  // Direct IP match
  if (CLOUD_METADATA_IPS.includes(ip)) {
    return true;
  }

  // Check for IPv4-mapped IPv6 versions
  const ipv4Mapped = ip.match(/^::ffff:(.+)$/i);
  if (ipv4Mapped && ipv4Mapped[1] && CLOUD_METADATA_IPS.includes(ipv4Mapped[1])) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is blocked.
 *
 * When `allowPrivate` is set (dev/test escape hatch), loopback hostnames such
 * as `localhost` are permitted, but cloud-metadata hostnames stay blocked.
 */
function isBlockedHostname(hostname: string, allowPrivate: boolean): boolean {
  const normalizedHost = hostname.toLowerCase();

  // In allowPrivate mode only cloud-metadata hostnames remain off-limits;
  // otherwise the full blocklist (loopback + metadata) applies.
  const blockList = allowPrivate ? CLOUD_METADATA_HOSTNAMES : BLOCKED_HOSTNAMES;

  // Direct match
  if (blockList.includes(normalizedHost)) {
    return true;
  }

  // Subdomain of blocked hostname
  for (const blocked of blockList) {
    if (normalizedHost.endsWith('.' + blocked)) {
      return true;
    }
  }

  return false;
}

/**
 * Parse potential IP from various formats (decimal, octal, hex)
 * Attackers try to bypass filters using alternate IP representations
 */
function normalizeIP(value: string): string | null {
  // Try decimal notation (e.g., 2130706433 = 127.0.0.1)
  const decimal = parseInt(value, 10);
  if (!isNaN(decimal) && decimal > 0 && decimal <= 0xFFFFFFFF && /^\d+$/.test(value)) {
    return [
      (decimal >>> 24) & 0xFF,
      (decimal >>> 16) & 0xFF,
      (decimal >>> 8) & 0xFF,
      decimal & 0xFF,
    ].join('.');
  }

  // Try hex notation (e.g., 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(value)) {
    const hex = parseInt(value, 16);
    if (hex > 0 && hex <= 0xFFFFFFFF) {
      return [
        (hex >>> 24) & 0xFF,
        (hex >>> 16) & 0xFF,
        (hex >>> 8) & 0xFF,
        hex & 0xFF,
      ].join('.');
    }
  }

  // Try octal notation in IP (e.g., 0177.0.0.1)
  if (/^0\d/.test(value) || value.includes('.0')) {
    const parts = value.split('.');
    if (parts.length === 4) {
      const octets = parts.map(p => {
        if (/^0\d+$/.test(p)) {
          // Octal
          return parseInt(p, 8);
        }
        return parseInt(p, 10);
      });
      if (octets.every(o => !isNaN(o) && o >= 0 && o <= 255)) {
        return octets.join('.');
      }
    }
  }

  return null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  resolvedIP?: string;
}

export interface ValidateWebhookOptions {
  /**
   * Dev/test ONLY: permit webhook destinations on loopback and RFC-1918/private
   * ranges (127.0.0.1, ::1, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost).
   *
   * Cloud metadata endpoints (169.254.169.254 & friends) and non-HTTP(S)
   * protocols remain blocked even when this is set — so the guard still stops
   * the canonical SSRF vectors. Default: false. Never enable in production.
   */
  allowPrivate?: boolean;
}

/**
 * Validate a webhook URL for SSRF vulnerabilities
 * Resolves DNS and checks if destination is safe
 */
export async function validateWebhookUrl(
  url: string,
  options: ValidateWebhookOptions = {},
): Promise<ValidationResult> {
  const allowPrivate = options.allowPrivate ?? false;
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
  }

  const hostname = parsed.hostname;

  // Check blocked hostnames
  if (isBlockedHostname(hostname, allowPrivate)) {
    return { valid: false, error: 'Hostname is not allowed' };
  }

  // Check if hostname is an IP address (various formats)
  const normalizedFromHost = normalizeIP(hostname);
  if (normalizedFromHost) {
    // Check cloud metadata FIRST (169.254.169.254 is in link-local range but more specific)
    if (isCloudMetadata(normalizedFromHost)) {
      return { valid: false, error: 'Cloud metadata endpoints are not allowed' };
    }
    if (!allowPrivate && isPrivateIP(normalizedFromHost)) {
      return { valid: false, error: 'Private IP addresses are not allowed' };
    }
    return { valid: true, resolvedIP: normalizedFromHost };
  }

  // Check if it's a raw IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    // Check cloud metadata FIRST
    if (isCloudMetadata(hostname)) {
      return { valid: false, error: 'Cloud metadata endpoints are not allowed' };
    }
    if (!allowPrivate && isPrivateIP(hostname)) {
      return { valid: false, error: 'Private IP addresses are not allowed' };
    }
    return { valid: true, resolvedIP: hostname };
  }

  // Check if it's an IPv6 address (in brackets in URL, but hostname won't have brackets)
  if (hostname.includes(':') || /^\[.*\]$/.test(parsed.host)) {
    const ipv6 = hostname.replace(/^\[|\]$/g, '');
    // Check cloud metadata FIRST
    if (isCloudMetadata(ipv6)) {
      return { valid: false, error: 'Cloud metadata endpoints are not allowed' };
    }
    if (!allowPrivate && isPrivateIP(ipv6)) {
      return { valid: false, error: 'Private IP addresses are not allowed' };
    }
    return { valid: true, resolvedIP: ipv6 };
  }

  // Resolve DNS to check actual IP
  try {
    const addresses = await dns.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.resolve6(hostname).catch(() => []);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      return { valid: false, error: 'Could not resolve hostname' };
    }

    // Check ALL resolved addresses (attacker could have multiple A records)
    // Check cloud metadata FIRST (more specific than link-local)
    for (const ip of allAddresses) {
      if (isCloudMetadata(ip)) {
        return { valid: false, error: `Hostname resolves to cloud metadata endpoint: ${ip}` };
      }
      if (!allowPrivate && isPrivateIP(ip)) {
        return { valid: false, error: `Hostname resolves to private IP: ${ip}` };
      }
    }

    return { valid: true, resolvedIP: allAddresses[0] };
  } catch (error) {
    return { 
      valid: false, 
      error: `DNS resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}
