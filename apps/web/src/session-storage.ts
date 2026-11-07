import type { Credentials } from './recorder.js';
const key = 'voila.session';
export const sessionTtl = 30 * 60_000;
export interface SavedSession extends Credentials { helloSent: boolean; expiresAt: number }
export class SessionStorage {
  constructor(private store: () => Storage | undefined = () => globalThis.sessionStorage, private now = () => Date.now()) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* Storage may be unavailable. */ }
  }
  load(): SavedSession | undefined {
    try {
      const value = JSON.parse(this.store()?.getItem(key) ?? 'null');
      if (value && typeof value.id === 'string' && value.id && typeof value.resume_token === 'string' && value.resume_token && typeof value.helloSent === 'boolean' && Number.isFinite(value.expiresAt) && value.expiresAt > this.now() && value.expiresAt <= this.now() + sessionTtl) return value;
    } catch { /* Storage may be unavailable. */ }
    this.clear();
  }
  save(credentials: Credentials, helloSent: boolean) {
    const value = JSON.stringify({ id: credentials.id, resume_token: credentials.resume_token, helloSent, expiresAt: this.now() + sessionTtl });
    try { this.store()?.setItem(key, value); } catch { /* Storage may be unavailable. */ }
  }
  clear() { try { this.store()?.removeItem(key); } catch { /* Storage may be unavailable. */ } }
}
