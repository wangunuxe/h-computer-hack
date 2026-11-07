import { describe, expect, it, vi } from 'vitest';
import { SpeechQueue } from './speech.js';
describe('speech queue', () => {
  it('waits for unlock and speaks FIFO in the profile language', () => {
    const speak = vi.fn(); const queue = new SpeechQueue({ speak, cancel: vi.fn() }, 'fr-FR');
    queue.enqueue('one'); queue.enqueue('two'); expect(speak).not.toHaveBeenCalled(); queue.unlock();
    expect(speak).toHaveBeenCalledWith('one', 'fr-FR', expect.any(Function)); speak.mock.calls[0]![2](); expect(speak).toHaveBeenLastCalledWith('two', 'fr-FR', expect.any(Function));
  });
  it('barge-in clears pending speech and ignores stale completion callbacks', () => {
    const speak = vi.fn(); const cancel = vi.fn(); const queue = new SpeechQueue({ speak, cancel }, 'en-GB');
    queue.unlock(); queue.enqueue('one'); queue.enqueue('stale'); const oldEnd = speak.mock.calls[0]![2]; queue.bargeIn(); expect(cancel).toHaveBeenCalledOnce();
    queue.enqueue('new'); queue.enqueue('next'); oldEnd(); expect(speak).toHaveBeenCalledTimes(2); speak.mock.calls[1]![2](); expect(speak).toHaveBeenLastCalledWith('next', 'en-GB', expect.any(Function));
  });
  it('ignores empty utterances', () => { const speak = vi.fn(); const queue = new SpeechQueue({ speak, cancel: vi.fn() }, 'fr'); queue.unlock(); queue.enqueue(' '); expect(speak).not.toHaveBeenCalled(); });
});
