import { describe, expect, it } from 'vitest';
import { isMixedContent, parseSignalingUrl } from './config';

describe('signaling config', () => {
  it('accepts ws and wss urls only', () => {
    expect(parseSignalingUrl('wss://signal.example.com')).toBe('wss://signal.example.com');
    expect(parseSignalingUrl(' ws://host:8787 ')).toBe('ws://host:8787');
    expect(parseSignalingUrl('https://signal.example.com')).toBeNull();
    expect(parseSignalingUrl('')).toBeNull();
    expect(parseSignalingUrl(undefined)).toBeNull();
    expect(parseSignalingUrl('ws://')).toBeNull();
  });
  it('flags ws:// on an https page as mixed content', () => {
    expect(isMixedContent('ws://a.com', 'https:')).toBe(true);
    expect(isMixedContent('wss://a.com', 'https:')).toBe(false);
    expect(isMixedContent('ws://a.com', 'http:')).toBe(false);
    expect(isMixedContent(null, 'https:')).toBe(false);
  });
});
