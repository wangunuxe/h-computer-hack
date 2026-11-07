import { describe, expect, it, vi } from 'vitest';
import { bindMicControls, micControlState } from './mic-controls.js';
import { readFileSync } from 'node:fs';
import { canStop, initialState, type Stage } from './state.js';
import { labels } from './labels.js';
import { captureFailure, recordingDiagnostic, recordingErrorKeys, SpeechInitializationError } from './recording-error.js';
describe('tap-only mobile microphone controls', () => {
  it.each(['fr', 'en'] as const)('keeps connection retries focusable and labelled in %s, restoring normal controls on recovery', (language) => {
    const t = labels[language];
    for (const failed of [false, true]) expect(micControlState({ connected: false, failed, active: false, releasing: true }, t)).toEqual({ caption: failed ? t.connectionRetry : t.connecting, label: failed ? t.connectionRetry : t.connecting, disabled: false, pressed: false });
    expect(micControlState({ connected: true, failed: false, active: false, releasing: false }, t)).toEqual({ caption: t.tap, label: t.tap, disabled: false, pressed: false });
    expect(micControlState({ connected: true, failed: false, active: true, releasing: false }, t).label).toBe(t.stopListening);
    expect(micControlState({ connected: true, failed: false, active: false, releasing: true }, t).disabled).toBe(true);
  });
  it('exposes status and errors to screen readers but not the spoken caption', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/id="connection" role="status" aria-live="polite"/);
    expect(html).toMatch(/id="errors" role="alert" aria-live="assertive"/);
    expect(html).toMatch(/id="caption" aria-hidden="true"/);
    expect(html).not.toMatch(/id="talk"[^>]*disabled/);
  });
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
