import { randomBytes } from 'node:crypto';
import type { WatchEvent, WatchPayload, ServerEvent } from '@voila/shared';
import { secureEqual } from './session-registry.js';

type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
type Sink = (event: WatchEvent) => void;
type Watch = { token: string; code: string; ip: string; session?: string; online: boolean; sinks: Set<Sink>; timer?: ReturnType<typeof setTimeout>; recent: WatchPayload[] };
export class WatchRegistry {
  private entries = new Map<string, Watch>();
  private codes = new Map<string, string>();
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private stage: (id: string) => Stage = () => 'LISTEN', private timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis, private capacity = 100) {}
  issue(ip: string) {
    if (this.entries.size >= this.capacity) return { error: 'capacity' as const };
    if ([...this.entries.values()].filter((entry) => entry.ip === ip && !entry.online && !entry.sinks.size).length >= 3) return { error: 'client-limit' as const };
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code: string;
    do { code = [...randomBytes(6)].map((n) => alphabet[n & 31]).join(''); } while (this.codes.has(code));
    const watch_id = randomBytes(24).toString('base64url'), watch_token = randomBytes(32).toString('base64url');
    const entry: Watch = { token: watch_token, code, ip, online: false, sinks: new Set(), recent: [] };
    this.entries.set(watch_id, entry); this.codes.set(code, watch_id); this.expire(watch_id, entry, 60_000);
    return { watch_id, watch_token, code };
  }
  attach(id: string, token: string, sink: Sink) {
    const entry = this.entries.get(id);
    if (!entry || !secureEqual(token, entry.token)) return;
    entry.sinks.add(sink);
    this.timers.clearTimeout(entry.timer);
    if (!entry.online) this.expire(id, entry);
    if (entry.online && entry.session) {
      sink({ type: 'paired', stage: this.stage(entry.session) });
      for (const event of entry.recent) sink({ type: 'watch', event });
      sink({ type: 'watch', event: { type: 'stage', stage: this.stage(entry.session) } });
    } else sink({ type: 'unpaired' });
    return () => { if (entry.sinks.delete(sink) && !entry.sinks.size && this.entries.get(id) === entry) this.expire(id, entry, 30_000); };
  }
  pair(code: string, session: string, ip = 'unknown') {
    const now = Date.now();
    for (const [key, attempt] of this.attempts) if (attempt.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) ?? { count: 0, until: now + 60_000 };
    this.attempts.set(ip, attempt); if (++attempt.count > 6) return;
    const id = this.codes.get(code.toUpperCase().trim()) ?? '';
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.session !== session) { this.send(entry, { type: 'unpaired' }); entry.recent = []; }
    entry.session = session; entry.online = true; this.timers.clearTimeout(entry.timer);
    if (!entry.sinks.size) this.expire(id, entry, 30_000);
    this.send(entry, { type: 'paired', stage: this.stage(session) });
  }
  connected(session: string) { for (const [id, entry] of this.entries) if (entry.session === session) { entry.online = true; this.timers.clearTimeout(entry.timer); if (!entry.sinks.size) this.expire(id, entry, 30_000); this.send(entry, { type: 'paired', stage: this.stage(session) }); } }
  disconnected(session: string) { for (const [id, entry] of this.entries) if (entry.session === session) { entry.online = false; this.send(entry, { type: 'unpaired' }); this.expire(id, entry, entry.sinks.size ? 10 * 60_000 : 30_000); } }
  clearHistory(session: string) { for (const entry of this.entries.values()) if (entry.session === session) entry.recent = []; }
  mirror(session: string, event: WatchPayload | undefined) {
    if (!event) return;
    if (event.type === 'stage' && ['LISTEN', 'DONE'].includes(event.stage)) this.clearHistory(session);
    for (const entry of this.entries.values()) if (entry.session === session && entry.online) {
      entry.recent.push(event); if (entry.recent.length > 32) entry.recent.shift();
      this.send(entry, { type: 'watch', event });
    }
  }
  dispose() { for (const entry of this.entries.values()) this.timers.clearTimeout(entry.timer); this.entries.clear(); this.codes.clear(); this.attempts.clear(); }
  private send(entry: Watch, event: WatchEvent) { for (const sink of entry.sinks) sink(event); }
  private expire(id: string, entry: Watch, ms = 10 * 60_000) {
    this.timers.clearTimeout(entry.timer);
    entry.timer = this.timers.setTimeout(() => { this.send(entry, { type: 'unpaired', expired: true }); entry.session = undefined; entry.online = false; entry.recent = []; this.entries.delete(id); this.codes.delete(entry.code); }, ms);
    entry.timer.unref?.();
  }
}
