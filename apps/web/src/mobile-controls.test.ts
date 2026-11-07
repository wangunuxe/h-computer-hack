import { describe, expect, it, vi } from 'vitest';
import { bindMicControls } from './mic-controls.js';
import { canStop, type Stage } from './state.js';
import { labels } from './labels.js';
import { captureFailure, recordingDiagnostic, recordingErrorKeys, SpeechInitializationError } from './recording-error.js';

function setup(mode: 'hold' | 'toggle') {
  const button = { setPointerCapture: vi.fn() } as unknown as HTMLButtonElement, dock = {} as HTMLElement;
  let active = false;
  const start = vi.fn(() => { active = true; }), release = vi.fn(() => { active = false; });
  bindMicControls(button, dock, { mode: () => mode, active: () => active, start, release });
  const pointer = (id = 1) => ({ pointerId: id, button: 0, preventDefault: vi.fn() }) as unknown as PointerEvent;
  return { button, dock, start, release, pointer };
}
describe('mobile microphone controls', () => {
  it('captures a hold pointer and finishes only on its release, not a move or secondary finger', () => {
    const s = setup('hold'); const event = s.pointer(); s.button.onpointerdown!(event);
    expect(s.button.setPointerCapture).toHaveBeenCalledWith(1); expect(event.preventDefault).toHaveBeenCalled();
    expect(s.button.onpointerleave).toBeUndefined();
    s.button.onpointerup!(s.pointer(2)); expect(s.release).not.toHaveBeenCalled();
    s.button.onpointerup!(event); expect(s.start).toHaveBeenCalledOnce(); expect(s.release).toHaveBeenCalledOnce();
  });
  it('finalizes a cancelled hold once, ignores unrelated fingers, and permits a fresh hold', () => {
    const s = setup('hold'); s.button.onpointerdown!(s.pointer()); s.button.onpointercancel!(s.pointer(2));
    expect(s.release).not.toHaveBeenCalled();
    s.button.onpointercancel!(s.pointer()); s.button.onpointerup!(s.pointer());
    expect(s.release).toHaveBeenCalledOnce();
    s.button.onpointerdown!(s.pointer(2)); s.button.onpointerup!(s.pointer(2));
    expect(s.release).toHaveBeenCalledTimes(2);
  });
  it.each(['hold', 'toggle'] as const)('supports screen-reader synthetic click in %s mode', (mode) => {
    const s = setup(mode); const event = { detail: 0 } as PointerEvent;
    s.button.onclick!(event); s.button.onclick!(event); expect(s.start).toHaveBeenCalledOnce(); expect(s.release).toHaveBeenCalledOnce();
  });
  it('ignores the compatibility click after a hold and prevents the dock context menu', () => {
    const s = setup('hold'); s.button.onpointerdown!(s.pointer()); s.button.onpointerup!(s.pointer()); s.button.onclick!({ detail: 1 } as PointerEvent);
    expect(s.start).toHaveBeenCalledOnce(); expect(s.release).toHaveBeenCalledOnce();
    const event = { preventDefault: vi.fn() } as unknown as PointerEvent; s.dock.oncontextmenu!(event); expect(event.preventDefault).toHaveBeenCalled();
  });
  it.each(['fr', 'en'] as const)('has distinct errors in %s and excludes private causes from logging', (language) => {
    const messages = Object.values(recordingErrorKeys).map((key) => labels[language][key]); expect(new Set(messages).size).toBe(6);
    expect(recordingDiagnostic(captureFailure(new Error('wss://private?token=SECRET')))).toEqual({ kind: 'capture', code: 'capture', causeName: 'Error' });
    expect(recordingDiagnostic({ kind: 'service', code: 'rate-limit', cause: new SpeechInitializationError(429) })).toEqual({ kind: 'service', code: 'rate-limit', causeName: 'Error', status: 429 });
  });
  it.each(['LISTEN', 'CLARIFY', 'PRESENT', 'CHOOSE', 'DONE'] as Stage[])('hides Stop while waiting for input in %s', (stage) => expect(canStop(stage)).toBe(false));
  it.each(['UNDERSTAND', 'RESEARCH', 'EXECUTE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT'] as Stage[])('allows cancellation in %s', (stage) => expect(canStop(stage)).toBe(true));
});
