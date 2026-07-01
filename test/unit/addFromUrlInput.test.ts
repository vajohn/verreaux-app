import { describe, it, expect } from 'vitest';
import { validateAddFromUrlInput } from '../../src/features/sync/addFromUrlInput';

describe('validateAddFromUrlInput', () => {
  it('requires a URL', () => {
    const r = validateAddFromUrlInput({ url: '  ', otp: '123456', from: '', to: '', enrolled: false });
    expect(r).toEqual({ ok: false, error: 'Enter a series URL.' });
  });

  it('requires a 6-digit OTP when the device is NOT enrolled', () => {
    const r = validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: '', to: '', enrolled: false });
    expect(r).toEqual({ ok: false, error: 'Enter the 6-digit authenticator code.' });
  });

  it('rejects a malformed OTP when the device is NOT enrolled', () => {
    const r = validateAddFromUrlInput({ url: 'https://x.test/s', otp: '12', from: '', to: '', enrolled: false });
    expect(r).toEqual({ ok: false, error: 'Enter the 6-digit authenticator code.' });
  });

  it('does NOT require an OTP when the device IS enrolled (token-authed)', () => {
    const r = validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: '', to: '', enrolled: true });
    expect(r).toEqual({ ok: true, url: 'https://x.test/s', otp: '', from: '', to: '' });
  });

  it('validates an optional numeric "from"', () => {
    const r = validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: 'abc', to: '', enrolled: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/From/);
  });

  it('accepts "latest" or a number for "to"', () => {
    expect(validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: '', to: 'latest', enrolled: true }).ok).toBe(true);
    expect(validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: '', to: '5', enrolled: true }).ok).toBe(true);
    expect(validateAddFromUrlInput({ url: 'https://x.test/s', otp: '', from: '', to: 'soon', enrolled: true }).ok).toBe(false);
  });

  it('trims fields on success', () => {
    const r = validateAddFromUrlInput({ url: '  https://x.test/s  ', otp: ' 123456 ', from: ' 1 ', to: ' 3 ', enrolled: false });
    expect(r).toEqual({ ok: true, url: 'https://x.test/s', otp: '123456', from: '1', to: '3' });
  });
});
