import { describe, it, expect } from 'vitest';
import {
  firstForwardedForHop,
  ipFromNodeRequest,
  isTrustedPeer,
  normalizeIp,
  resolveClientIp,
  userAgentFromNodeRequest,
  type ClientAddressCarrier,
} from './clientIp.js';

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('strips brackets, ports and IPv6 zone ids', () => {
    expect(normalizeIp('[::1]:41605')).toBe('::1');
    expect(normalizeIp('[::1]')).toBe('::1');
    expect(normalizeIp('127.0.0.1:1234')).toBe('127.0.0.1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('  10.0.0.5  ')).toBe('10.0.0.5');
  });

  it('returns null for anything that is not an IP', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp('example.com')).toBeNull();
  });
});

describe('firstForwardedForHop', () => {
  it('takes the first (left-most) hop', () => {
    expect(firstForwardedForHop('203.0.113.7, 10.0.0.1, 127.0.0.1')).toBe('203.0.113.7');
    expect(firstForwardedForHop(['203.0.113.7', '10.0.0.1'])).toBe('203.0.113.7');
    expect(firstForwardedForHop('203.0.113.7:443')).toBe('203.0.113.7');
  });

  it('returns null for malformed or missing headers', () => {
    expect(firstForwardedForHop(undefined)).toBeNull();
    expect(firstForwardedForHop('')).toBeNull();
    expect(firstForwardedForHop('garbage')).toBeNull();
  });
});

describe('isTrustedPeer', () => {
  it('honours the boolean forms', () => {
    expect(isTrustedPeer('203.0.113.7', true)).toBe(true);
    expect(isTrustedPeer('127.0.0.1', false)).toBe(false);
    expect(isTrustedPeer('127.0.0.1', 0)).toBe(false);
    expect(isTrustedPeer('127.0.0.1', 1)).toBe(true);
  });

  it('matches loopback / linklocal / uniquelocal', () => {
    expect(isTrustedPeer('127.0.0.1', 'loopback')).toBe(true);
    expect(isTrustedPeer('::1', 'loopback')).toBe(true);
    expect(isTrustedPeer('203.0.113.7', 'loopback')).toBe(false);
    expect(isTrustedPeer('169.254.1.2', 'linklocal')).toBe(true);
    expect(isTrustedPeer('127.0.0.1', 'linklocal')).toBe(false);
    expect(isTrustedPeer('10.1.2.3', 'uniquelocal')).toBe(true);
    expect(isTrustedPeer('203.0.113.7', 'uniquelocal')).toBe(false);
  });

  it('matches explicit addresses and CIDR blocks', () => {
    expect(isTrustedPeer('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(isTrustedPeer('11.1.2.3', '10.0.0.0/8')).toBe(false);
    expect(isTrustedPeer('127.0.0.1', '127.0.0.1')).toBe(true);
    expect(isTrustedPeer('127.0.0.2', '127.0.0.1')).toBe(false);
  });

  it('returns false for an invalid trust spec', () => {
    expect(isTrustedPeer('127.0.0.1', 'nonsense')).toBe(false);
  });
});

describe('resolveClientIp', () => {
  it('adopts the first XFF hop when the peer is a trusted loopback proxy (official Caddy deployment)', () => {
    expect(
      resolveClientIp({
        peerAddress: '127.0.0.1',
        forwardedFor: '203.0.113.7, 127.0.0.1',
        trustProxy: 'loopback',
      }),
    ).toBe('203.0.113.7');
  });

  it('adopts XFF for an IPv4-mapped loopback peer', () => {
    expect(
      resolveClientIp({
        peerAddress: '::ffff:127.0.0.1',
        forwardedFor: '198.51.100.9',
        trustProxy: 'loopback',
      }),
    ).toBe('198.51.100.9');
  });

  it('ignores a client-supplied XFF on a direct (untrusted) connection', () => {
    expect(
      resolveClientIp({
        peerAddress: '198.51.100.9',
        forwardedFor: '203.0.113.7',
        trustProxy: 'loopback',
      }),
    ).toBe('198.51.100.9');
  });

  it('ignores XFF entirely when trust proxy is disabled', () => {
    expect(
      resolveClientIp({
        peerAddress: '127.0.0.1',
        forwardedFor: '203.0.113.7',
        trustProxy: false,
      }),
    ).toBe('127.0.0.1');
  });

  it('falls back to the peer when the XFF hop is malformed', () => {
    expect(
      resolveClientIp({
        peerAddress: '127.0.0.1',
        forwardedFor: 'not-an-ip',
        trustProxy: 'loopback',
      }),
    ).toBe('127.0.0.1');
  });

  it('never throws and reports unknown without a peer', () => {
    expect(resolveClientIp({ peerAddress: undefined, trustProxy: 'loopback' })).toBe('unknown');
    expect(resolveClientIp({ peerAddress: null, forwardedFor: null, trustProxy: false })).toBe(
      'unknown',
    );
  });
});

describe('request adapters', () => {
  const makeReq = (overrides: Partial<ClientAddressCarrier> = {}): ClientAddressCarrier => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    ...overrides,
  });

  it('reads the peer address and X-Forwarded-For from an IncomingMessage-like object', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(ipFromNodeRequest(req, 'loopback')).toBe('203.0.113.7');
    expect(ipFromNodeRequest(req, false)).toBe('127.0.0.1');
  });

  it('reads the UA header, tolerating arrays and absence', () => {
    expect(userAgentFromNodeRequest(makeReq({ headers: { 'user-agent': 'vitest' } }))).toBe('vitest');
    expect(userAgentFromNodeRequest(makeReq({ headers: { 'user-agent': ['a', 'b'] } }))).toBe('a');
    expect(userAgentFromNodeRequest(makeReq())).toBe('');
  });
});
