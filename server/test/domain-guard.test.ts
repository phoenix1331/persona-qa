import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from '../src/domain-guard.js';

describe('isAllowedUrl', () => {
  const allowed = ['staging.shop.test', '127.0.0.1:8000', '*.stripe.com'];

  it.each([
    ['https://staging.shop.test/checkout', true],
    ['https://staging.shop.test:8443/checkout', true],
    ['http://127.0.0.1:8000/fixtures', true],
    ['http://127.0.0.1:9000/fixtures', false],
    ['https://js.stripe.com/v3', true],
    ['https://stripe.com/', true],
    ['https://evilstripe.com/', false],
    ['https://example.com/', false],
    ['https://staging.shop.test.evil.com/', false],
    ['about:blank', true],
    ['data:text/html,hi', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAllowedUrl(url, allowed)).toBe(expected);
  });

  it('matches host names case-insensitively', () => {
    expect(isAllowedUrl('https://STAGING.shop.test/', ['Staging.Shop.Test'])).toBe(true);
  });
});
