import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionAttempt, replaceOnForeground } from './connection.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('connection deadlines', () => {
  it('bounds both fetch and connecting sockets, aborting before retry', () => {
    const expired = vi.fn(); const attempt = new ConnectionAttempt(expired);
    vi.advanceTimersByTime(9999); expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(expired).toHaveBeenCalledOnce(); expect(attempt.controller.signal.aborted).toBe(true);
  });
  it('clears the deadline on success and aborts an obsolete foreground attempt without retrying', () => {
    const expired = vi.fn(); const ready = new ConnectionAttempt(expired); ready.clear();
    const stale = new ConnectionAttempt(expired); stale.cancel(); vi.advanceTimersByTime(20_000);
    expect(expired).not.toHaveBeenCalled(); expect(stale.controller.signal.aborted).toBe(true);
  });
  it.each([undefined, 0, 1, 2, 3])('replaces only open or connecting sockets on foreground: %s', (state) => expect(replaceOnForeground(state)).toBe(state === 0 || state === 1));
});
