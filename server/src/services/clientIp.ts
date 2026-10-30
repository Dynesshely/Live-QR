import { BlockList, isIP } from 'node:net';

/**
 * One IP-resolution implementation shared by the HTTP side (rate limiter,
 * access log, upload audit), the WebSocket side (viewer connect/disconnect,
 * upload recipients) and — by construction — everything else.
 *
 * Semantics match the "trust proxy" model: the socket peer is only trusted to
 * speak for the client when `trustProxy` says so (default `loopback`, i.e. the
 * Caddy/Vite reverse proxy running next to us). Only then is the FIRST
 * `X-Forwarded-For` hop adopted. A direct client that brings its own header is
 * therefore never believed.
 */

export type TrustProxySetting = boolean | number | string;

export interface ClientAddressInput {
  peerAddress?: string | null;
  forwardedFor?: string | string[] | null;
  trustProxy: TrustProxySetting;
}

export interface ClientAddressCarrier {
  socket?: { remoteAddress?: string | null } | null;
  headers?: Record<string, string | string[] | undefined> | null;
}

interface IpRange {
  net: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

const NAMED_RANGES: Record<string, IpRange[]> = {
  loopback: [
    { net: '127.0.0.0', prefix: 8, family: 'ipv4' },
    { net: '::1', prefix: 128, family: 'ipv6' },
  ],
  linklocal: [
    { net: '169.254.0.0', prefix: 16, family: 'ipv4' },
    { net: 'fe80::', prefix: 10, family: 'ipv6' },
  ],
  uniquelocal: [
    { net: '10.0.0.0', prefix: 8, family: 'ipv4' },
    { net: '172.16.0.0', prefix: 12, family: 'ipv4' },
    { net: '192.168.0.0', prefix: 16, family: 'ipv4' },
    { net: 'fc00::', prefix: 7, family: 'ipv6' },
  ],
};

const trustListCache = new Map<string, BlockList | null>();

export function ipFamilyOf(ip: string): 'ipv4' | 'ipv6' | null {
  const version = isIP(ip);
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return null;
}

/**
 * Normalize a socket/XFF value into a bare IP literal:
 * strips brackets, IPv4 port suffixes, IPv6 zone ids and the IPv4-mapped
 * prefix (`::ffff:127.0.0.1` → `127.0.0.1`). Returns null when it is not an IP.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let value = raw.trim();
  if (!value) return null;

  // [::1]:1234 / [::1]
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) value = value.slice(1, end);
  }

  // ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) value = mapped[1];

  // 127.0.0.1:1234
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (ipv4WithPort) value = ipv4WithPort[1];

  // fe80::1%eth0
  const zone = value.indexOf('%');
  if (zone > 0) value = value.slice(0, zone);

  return isIP(value) ? value : null;
}

function compileTrustList(spec: string): BlockList | null {
  if (trustListCache.has(spec)) return trustListCache.get(spec) ?? null;

  const list = new BlockList();
  let valid = true;

  for (const rawToken of spec.split(',')) {
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;

    const named = NAMED_RANGES[token];
    if (named) {
      for (const range of named) list.addSubnet(range.net, range.prefix, range.family);
      continue;
    }

    const slash = token.indexOf('/');
    if (slash > 0) {
      const net = normalizeIp(token.slice(0, slash));
      const family = net ? ipFamilyOf(net) : null;
      const prefix = Number(token.slice(slash + 1));
      const maxPrefix = family === 'ipv4' ? 32 : 128;

      if (!net || !family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        valid = false;
        continue;
      }

      list.addSubnet(net, prefix, family);
      continue;
    }

    const ip = normalizeIp(token);
    const family = ip ? ipFamilyOf(ip) : null;
    if (!ip || !family) {
      valid = false;
      continue;
    }
    list.addAddress(ip, family);
  }

  const compiled = valid ? list : null;
  trustListCache.set(spec, compiled);
  return compiled;
}

/** Is the socket peer itself a proxy we are willing to trust? */
export function isTrustedPeer(peer: string | null, trustProxy: TrustProxySetting): boolean {
  if (trustProxy === true) return true;
  if (trustProxy === false) return false;
  if (typeof trustProxy === 'number') return trustProxy > 0;

  const ip = normalizeIp(peer);
  if (!ip) return false;

  const family = ipFamilyOf(ip);
  if (!family) return false;

  const list = compileTrustList(trustProxy);
  return list ? list.check(ip, family) : false;
}

/** First (left-most) hop of X-Forwarded-For, i.e. the original client. */
export function firstForwardedForHop(
  forwardedFor: string | string[] | null | undefined,
): string | null {
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  if (!raw) return null;

  const first = raw.split(',')[0]?.trim();
  return first ? normalizeIp(first) : null;
}

/** Resolve the real client IP (never throws, always returns a string). */
export function resolveClientIp(input: ClientAddressInput): string {
  const peer = normalizeIp(input.peerAddress ?? '') ?? ((input.peerAddress ?? '').trim() || 'unknown');

  if (!isTrustedPeer(peer, input.trustProxy)) return peer;

  return firstForwardedForHop(input.forwardedFor) ?? peer;
}

/** Adapter for anything that looks like an http.IncomingMessage / Express Request. */
export function ipFromNodeRequest(req: ClientAddressCarrier, trustProxy: TrustProxySetting): string {
  return resolveClientIp({
    peerAddress: req.socket?.remoteAddress,
    forwardedFor: req.headers?.['x-forwarded-for'],
    trustProxy,
  });
}

export function userAgentFromNodeRequest(req: ClientAddressCarrier): string {
  const ua = req.headers?.['user-agent'];
  return (Array.isArray(ua) ? ua[0] : ua) ?? '';
}
