import { describe, it, expect } from 'vitest';
import { classifyCloseCode } from './ws';

describe('classifyCloseCode', () => {
  it('treats 1001 as expired without reconnect', () => {
    expect(classifyCloseCode(1001)).toEqual({ kind: 'expired', reconnect: false });
  });

  it('reconnects on 1012 (service restart) so a rolling restart recovers by itself', () => {
    expect(classifyCloseCode(1012)).toEqual({ kind: null, reconnect: true });
  });

  it('treats 4001 as invalid share code without reconnect', () => {
    expect(classifyCloseCode(4001)).toEqual({ kind: 'invalid_code', reconnect: false });
  });

  it('treats 4002 as room full without reconnect', () => {
    expect(classifyCloseCode(4002)).toEqual({ kind: 'room_full', reconnect: false });
  });

  it('keeps reconnect enabled for ordinary network closes', () => {
    expect(classifyCloseCode(1000)).toEqual({ kind: null, reconnect: true });
    expect(classifyCloseCode(1006)).toEqual({ kind: null, reconnect: true });
    expect(classifyCloseCode(1011)).toEqual({ kind: null, reconnect: true });
  });
});
