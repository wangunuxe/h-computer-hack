import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStorage, sessionTtl } from './session-storage.js';
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } as Storage; };
afterEach(() => vi.unstubAllGlobals());
describe('payment-return session storage', () => {
  it('restores a claimed session after same-tab payment navigation, never in an independent tab', () => {
    const tab = memory(), otherTab = memory(), local = memory(); vi.stubGlobal('localStorage', local);
    local.setItem('voila.session', JSON.stringify({ id: 'legacy', resume_token: 'token', helloSent: true, expiresAt: 1000 + sessionTtl }));
    const store = new SessionStorage(() => tab, () => 1000);
    store.save({ id: 'same-session', resume_token: 'private-token' }, true);
    expect(store.load()).toEqual({ id: 'same-session', resume_token: 'private-token', helloSent: true, expiresAt: 1000 + sessionTtl });
    expect(new SessionStorage(() => tab, () => 2000).load()?.id).toBe('same-session');
    expect(new SessionStorage(() => otherTab, () => 2000).load()).toBeUndefined();
    expect(store.load()?.id).toBe('same-session');
    store.clear(); expect(store.load()).toBeUndefined(); expect(local.getItem('voila.session')).toBeNull();
  });
  it('expires after thirty minutes and ignores corrupt or unavailable storage', () => {
    let now = 0; const tab = memory(); const store = new SessionStorage(() => tab, () => now);
    store.save({ id: 'id', resume_token: 'token' }, false); now = sessionTtl;
    expect(store.load()).toBeUndefined(); expect(tab.getItem('voila.session')).toBeNull();
    tab.setItem('voila.session', '{'); expect(store.load()).toBeUndefined();
    const unavailable = new SessionStorage(() => { throw new Error('blocked'); });
    expect(() => { unavailable.save({ id: 'id', resume_token: 'token' }, true); unavailable.clear(); }).not.toThrow(); expect(unavailable.load()).toBeUndefined();
  });
  it('refreshes expiry while connected and on departure, retaining thirty minutes for return', () => {
    let now = 0; const tab = memory(); const store = new SessionStorage(() => tab, () => now);
    const credentials = { id: 'id', resume_token: 'token' }; store.save(credentials, true);
    now = sessionTtl - 1; store.save(credentials, true); now += sessionTtl - 1;
    expect(store.load()?.id).toBe('id'); now++; expect(store.load()).toBeUndefined();
  });
});
