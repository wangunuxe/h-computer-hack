import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VoilaSession } from './session.js';

export const secureEqual = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
type Entry = { token: string; clientIp: string; claimed: boolean; timer?: ReturnType<typeof setTimeout> };

export class SessionRegistry {
  private entries = new Map<string, Entry>();

  constructor(readonly sessions = new Map<string, VoilaSession>(), private timers: Timers = globalThis, private capacity = 100) {}

  issue(clientIp = 'unknown') {
    if (this.entries.size >= this.capacity) return { error: 'capacity' as const };
    if ([...this.entries.values()].filter((entry) => !entry.claimed && entry.clientIp === clientIp).length >= 3) return { error: 'client-limit' as const };
    const id = randomBytes(24).toString('base64url');
    const resume_token = randomBytes(32).toString('base64url');
    this.entries.set(id, { token: resume_token, clientIp, claimed: false });
    this.expireAfter(id, 2 * 60_000);
    return { id, resume_token };
  }

  connect(id: string, token: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || !secureEqual(token, entry.token)) return false;
    entry.claimed = true;
    this.timers.clearTimeout(entry.timer);
    entry.timer = undefined;
    return true;
  }

  disconnect(id: string) { this.expireAfter(id, 30 * 60_000); }

  dispose() {
    for (const entry of this.entries.values()) this.timers.clearTimeout(entry.timer);
    for (const session of this.sessions.values()) session.dispose();
    this.entries.clear(); this.sessions.clear();
  }

  private expireAfter(id: string, delay: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.timers.clearTimeout(entry.timer);
    entry.timer = this.timers.setTimeout(() => {
      this.sessions.get(id)?.dispose();
      this.sessions.delete(id);
      this.entries.delete(id);
    }, delay);
    entry.timer.unref?.();
  }
}
