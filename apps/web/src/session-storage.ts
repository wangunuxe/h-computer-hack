import type { Credentials } from './recorder.js';
const key = 'voila.session';
export const sessionTtl = 30 * 60_000;
export interface SavedSession extends Credentials { helloSent: boolean; expiresAt: number }
export class SessionStorage {
  constructor(private stores: (() => Storage | undefined)[] = [() => globalThis.sessionStorage, () => globalThis.localStorage], private now = () => Date.now()) {}
  load(): SavedSession | undefined {
    for (const store of this.stores) {
      try {
        const value = JSON.parse(store()?.getItem(key) ?? 'null');
        if (value && typeof value.id === 'string' && value.id && typeof value.resume_token === 'string' && value.resume_token && typeof value.helloSent === 'boolean' && Number.isFinite(value.expiresAt) && value.expiresAt > this.now() && value.expiresAt <= this.now() + sessionTtl) return value;
        store()?.removeItem(key);
      } catch { /* Storage may be unavailable. */ }
    }
  }
  save(credentials: Credentials, helloSent: boolean) {
    const value = JSON.stringify({ id: credentials.id, resume_token: credentials.resume_token, helloSent, expiresAt: this.now() + sessionTtl });
    for (const store of this.stores) { try { store()?.setItem(key, value); } catch { /* Storage may be unavailable. */ } }
  }
  clear() { for (const store of this.stores) { try { store()?.removeItem(key); } catch { /* Storage may be unavailable. */ } } }
}
