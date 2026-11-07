import { describe, expect, it, vi } from 'vitest';
import { finishOnce } from './smoke-session.js';

describe('session smoke completion', () => {
  it('preserves success when cleanup closes the WebSocket', () => {
    const complete = vi.fn();
    const finish = finishOnce(complete);
    finish('handoff_and_await_payment');
    finish('socket_closed');
    finish('timeout');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('handoff_and_await_payment');
  });
  it('preserves the first failure instead of accepting a late success', () => {
    const complete = vi.fn();
    const finish = finishOnce(complete);
    finish('error');
    finish('handoff_and_await_payment');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('error');
  });
});
