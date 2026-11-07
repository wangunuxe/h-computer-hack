import { describe, expect, it, vi } from 'vitest';
import { bindMicControls } from './mic-controls.js';
import { canStop, initialState, type Stage } from './state.js';
import { labels } from './labels.js';
import { captureFailure, recordingDiagnostic, recordingErrorKeys, SpeechInitializationError } from './recording-error.js';
describe('tap-only mobile microphone controls', () => {
  it.each([0, 1])('starts and stops for synthetic or ordinary clicks, detail %s', (detail) => {
    const button = {} as HTMLButtonElement, dock = {} as HTMLElement; let active = false;
    const start = vi.fn(() => { active = true; }), release = vi.fn(() => { active = false; });
    bindMicControls(button, dock, { active: () => active, start, release });
    button.onclick!({ detail } as PointerEvent); button.onclick!({ detail } as PointerEvent);
    expect(start).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce(); expect(button.onpointerdown).toBeUndefined(); expect(button.onpointerup).toBeUndefined();
    const event = { preventDefault: vi.fn() } as unknown as PointerEvent; dock.oncontextmenu!(event); expect(event.preventDefault).toHaveBeenCalled();
  });
  it.each(['fr', 'en'] as const)('has specific errors in %s without exposing provider secrets', (language) => {
    expect(new Set(Object.values(recordingErrorKeys).map((key) => labels[language][key])).size).toBe(6);
    expect(recordingDiagnostic(captureFailure(new Error('wss://private?token=SECRET')))).toEqual({ kind: 'capture', code: 'capture', causeName: 'Error' });
    expect(recordingDiagnostic({ kind: 'service', code: 'rate-limit', cause: new SpeechInitializationError(429) })).toEqual({ kind: 'service', code: 'rate-limit', causeName: 'Error', status: 429 });
  });
  it.each(['CLARIFY', 'RESEARCH', 'CONFIRM', 'AWAIT_PAYMENT'] as Stage[])('shows Stop for actual cancellable work in %s only', (stage) => {
    expect(canStop({ ...initialState(), stage })).toBe(false); expect(canStop({ ...initialState(), stage, cancellable: true })).toBe(true);
  });
});
