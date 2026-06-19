import { describe, it, expect, afterEach } from 'vitest';
import {
  getApiBase, setApiBase,
  getPiApiMode, setPiApiMode, getPiApiUrl, setPiApiUrl,
} from '../../src/features/sync/piClient';

afterEach(() => localStorage.clear());

describe('dual Pi API URL', () => {
  it('per-slot get/set + mode + getApiBase resolves the active slot', () => {
    setPiApiUrl('local', 'http://192.168.1.107:8080/');
    setPiApiUrl('remote', 'https://pi.ts.net');
    expect(getPiApiUrl('local')).toBe('http://192.168.1.107:8080'); // trailing slash stripped
    expect(getPiApiUrl('remote')).toBe('https://pi.ts.net');
    setPiApiMode('remote');
    expect(getApiBase()).toBe('https://pi.ts.net');
    setPiApiMode('local');
    expect(getPiApiMode()).toBe('local');
    expect(getApiBase()).toBe('http://192.168.1.107:8080');
  });

  it('defaults mode to remote and missing URLs to empty', () => {
    expect(getPiApiMode()).toBe('remote');
    expect(getApiBase()).toBe('');
  });

  it('migrates the legacy single key into the Remote slot (mode remote), once', () => {
    localStorage.setItem('verreaux:piApiBase', 'https://legacy.ts.net/');
    expect(getApiBase()).toBe('https://legacy.ts.net');
    expect(getPiApiUrl('remote')).toBe('https://legacy.ts.net');
    expect(getPiApiMode()).toBe('remote');
    expect(localStorage.getItem('verreaux:piApiBase')).toBeNull();
  });

  it('setApiBase (back-compat) writes the active slot', () => {
    setPiApiMode('local');
    setApiBase('http://pi:8080');
    expect(getPiApiUrl('local')).toBe('http://pi:8080');
    expect(getApiBase()).toBe('http://pi:8080');
  });
});
