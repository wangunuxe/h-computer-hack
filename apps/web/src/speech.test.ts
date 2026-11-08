import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeech, SpeechQueue, playbackSession } from './speech.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('speech queue', () => {
  it('unlocks real queued content without cancelling it and coalesces obsolete cards', () => {
    const speak = vi.fn(), cancel = vi.fn(), resume = vi.fn(); const queue = new SpeechQueue({ speak, cancel, resume }, 'fr-FR');
    queue.enqueue('Old options', 'cards'); queue.enqueue('Taxi from Étoile', 'cards'); queue.unlock(); queue.unlock();
    expect(cancel).not.toHaveBeenCalled(); expect(speak).toHaveBeenCalledExactlyOnceWith('Taxi from Étoile', 'fr-FR', expect.any(Function));
  });
  it('unlocks a real question in the first microphone gesture before holding capture speech', () => {
    const speak = vi.fn(); const queue = new SpeechQueue({ speak, cancel: vi.fn() }, 'fr-FR');
    queue.enqueue('Où souhaitez-vous aller ?'); queue.bargeIn(); queue.resume();
    queue.enqueue('Où souhaitez-vous aller ?'); queue.unlock(); queue.hold();
    expect(speak).toHaveBeenCalledExactlyOnceWith('Où souhaitez-vous aller ?', 'fr-FR', expect.any(Function));
    speak.mock.calls[0]![2](); queue.enqueue('D’où partez-vous ?'); expect(speak).toHaveBeenCalledOnce();
    queue.resume(); expect(speak).toHaveBeenLastCalledWith('D’où partez-vous ?', 'fr-FR', expect.any(Function));
  });
  it('defers captions during capture and resumes them after playback is restored', () => {
    const speak = vi.fn(); const queue = new SpeechQueue({ speak, cancel: vi.fn() }, 'en-GB'); queue.unlock(); queue.hold();
    queue.enqueue('Transcribing'); queue.enqueue('Transcribing'); queue.enqueue('Where are you?'); expect(speak).not.toHaveBeenCalled();
    queue.resume(); expect(speak).toHaveBeenCalledExactlyOnceWith('Transcribing', 'en-GB', expect.any(Function));
    queue.enqueue('Transcribing'); speak.mock.calls[0]![2](); expect(speak).toHaveBeenLastCalledWith('Where are you?', 'en-GB', expect.any(Function));
  });
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

describe('mobile browser speech', () => {
  function setup() {
    vi.useFakeTimers(); const failed = vi.fn(), done = vi.fn();
    const synthesis = { resume: vi.fn(), cancel: vi.fn(), speak: vi.fn((_utterance: SpeechSynthesisUtterance) => {}), getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]), speaking: false, pending: false };
    const make = (text: string) => ({ text } as SpeechSynthesisUtterance);
    const port = new BrowserSpeech(failed, synthesis as unknown as SpeechSynthesis, make);
    return { port, failed, done, synthesis };
  }
  it('speaks audible text with a local matching voice and restores playback before speaking', () => {
    const s = setup(), audioSession = { type: 'play-and-record' }; vi.stubGlobal('navigator', { audioSession });
    const local = { lang: 'fr-FR', localService: true } as SpeechSynthesisVoice;
    s.synthesis.getVoices.mockReturnValue([{ lang: 'en-US', localService: true } as SpeechSynthesisVoice, local]);
    s.port.speak('Bonjour', 'fr-FR', s.done); const utterance = s.synthesis.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe('Bonjour'); expect(utterance.voice).toBe(local); expect(utterance.volume).toBe(1); expect(audioSession.type).toBe('playback');
    expect(s.synthesis.resume).toHaveBeenCalledBefore(s.synthesis.speak);
    utterance.onend!({} as SpeechSynthesisEvent); expect(s.done).toHaveBeenCalledOnce(); expect(s.failed).not.toHaveBeenCalled();
  });
  it('handles voices loading later and does not rely on an initial populated voice list', () => {
    const s = setup(); s.port.speak('One', 'en-GB', s.done); const first = s.synthesis.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    expect(first.lang).toBe('en-GB'); first.onend!({} as SpeechSynthesisEvent);
    const voice = { lang: 'en-GB', localService: true } as SpeechSynthesisVoice; s.synthesis.getVoices.mockReturnValue([voice]);
    s.port.speak('Two', 'en-GB', s.done); expect((s.synthesis.speak.mock.calls[1]![0] as SpeechSynthesisUtterance).voice).toBe(voice); s.port.cancel();
  });
  it('exposes synthesis errors and stalled utterances instead of silently wedging the queue', () => {
    const s = setup(); s.port.speak('One', 'en-GB', s.done); const utterance = s.synthesis.speak.mock.calls[0]![0] as SpeechSynthesisUtterance;
    utterance.onerror!({} as SpeechSynthesisErrorEvent); utterance.onend!({} as SpeechSynthesisEvent); expect(s.failed).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce();
    s.port.speak('Two', 'en-GB', s.done); vi.advanceTimersByTime(10_000); expect(s.failed).toHaveBeenCalledTimes(2); expect(s.done).toHaveBeenCalledTimes(2);
  });
  it('tolerates browsers without the optional Audio Session API', () => { vi.stubGlobal('navigator', {}); expect(() => playbackSession('playback')).not.toThrow(); });
});
