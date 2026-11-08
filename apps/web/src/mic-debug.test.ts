// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { micDebug, micDebugEnabled, traceAudioContext, traceMicEvents } from './mic-debug.js';

beforeEach(() => { sessionStorage.clear(); document.body.replaceChildren(); vi.stubGlobal('location', new URL('https://example.test/')); });
afterEach(() => { sessionStorage.clear(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('opt-in microphone diagnostics', () => {
  it('does not render or store logs without debug enabled', () => {
    micDebug('start'); expect(document.getElementById('mic-debug')).toBeNull(); expect(sessionStorage.getItem('voila.mic-log')).toBeNull();
  });
  it('persists activation and bounded logs in this tab, without exposing button text or URL secrets', () => {
    vi.stubGlobal('location', new URL('https://example.test/?debug=1&token=SECRET'));
    const button = document.createElement('button'); button.textContent = 'PRIVATE TRANSCRIPT'; document.body.append(button);
    traceMicEvents(button); button.click();
    const overlay = document.getElementById('mic-debug')!;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.textContent).toMatch(/\d\d:\d\d:\d\d\.\d{3} mic.event/);
    expect(overlay.textContent).not.toMatch(/SECRET|PRIVATE|token/);
    vi.stubGlobal('location', new URL('https://example.test/'));
    expect(micDebugEnabled()).toBe(true);
    for (let i = 0; i < 100; i++) micDebug('audio.state', { source: 'recorder', state: 'running' });
    expect(overlay.textContent!.split('\n')).toHaveLength(80);
    overlay.remove(); micDebug('start'); expect(document.getElementById('mic-debug')!.textContent).toContain('audio.state');
    vi.stubGlobal('location', new URL('https://example.test/?debug=0')); expect(micDebugEnabled()).toBe(false);
  });
  it('logs audio state changes without changing the context', () => {
    vi.stubGlobal('location', new URL('https://example.test/?debug=1'));
    const context = Object.assign(new EventTarget(), { state: 'running' });
    traceAudioContext(context as unknown as AudioContext, 'recorder');
    context.state = 'interrupted'; context.dispatchEvent(new Event('statechange'));
    expect(document.getElementById('mic-debug')!.textContent).toContain('interrupted'); expect(context.state).toBe('interrupted');
  });
  it('still works with unavailable session storage', () => {
    vi.stubGlobal('location', new URL('https://example.test/?debug=1'));
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, clear() {} });
    expect(() => micDebug('start')).not.toThrow(); expect(document.getElementById('mic-debug')).not.toBeNull();
  });
});
