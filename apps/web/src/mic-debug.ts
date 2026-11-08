type Fields = Record<string, string | number | boolean | undefined>;
export function micDebugEnabled() {
  if (typeof document === 'undefined' || typeof location === 'undefined') return false;
  const value = new URLSearchParams(location.search).get('debug');
  try {
    if (value === '1') sessionStorage.setItem('voila.mic-debug', '1');
    if (value === '0') sessionStorage.removeItem('voila.mic-debug');
    return value === '1' || (value !== '0' && sessionStorage.getItem('voila.mic-debug') === '1');
  } catch { return value === '1'; }
}
export function micDebug(event: string, fields: Fields = {}) {
  if (!micDebugEnabled()) return;
  let log = document.getElementById('mic-debug');
  if (!log) {
    log = document.createElement('pre'); log.id = 'mic-debug'; log.setAttribute('aria-hidden', 'true');
    log.style.cssText = 'position:fixed;top:0;right:0;z-index:1000;max-height:30vh;width:min(100%,32rem);box-sizing:border-box;margin:0;padding:6px;background:#000e;color:#fff;font:11px/1.3 monospace;white-space:pre-wrap;overflow:hidden;pointer-events:none';
    try { log.textContent = sessionStorage.getItem('voila.mic-log') ?? ''; } catch { /* Storage is optional. */ }
    document.body.append(log);
  }
  const line = `${new Date().toISOString().slice(11, 23)} ${event} ${JSON.stringify(fields)}`;
  log.textContent = [...(log.textContent ?? '').split('\n').filter(Boolean), line].slice(-80).join('\n');
  log.scrollTop = log.scrollHeight;
  try { sessionStorage.setItem('voila.mic-log', log.textContent); } catch { /* Storage is optional. */ }
}
export function traceMicEvents(button: HTMLButtonElement) {
  if (!micDebugEnabled()) return;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'click']) button.addEventListener(type, (event) => {
    const pointer = event as PointerEvent;
    micDebug('mic.event', { type, pointerType: pointer.pointerType, detail: pointer.detail });
  }, true);
}
export function traceAudioContext(context: AudioContext, source: 'cue' | 'recorder') {
  const log = () => micDebug('audio.state', { source, state: context.state });
  log(); context.addEventListener?.('statechange', log);
}
