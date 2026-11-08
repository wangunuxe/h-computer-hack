import { micDebug } from './mic-debug.js';

export interface SpeechPort { speak(text: string, language: string, done: () => void): void; cancel(): void; resume?(): void; prime?(language: string): void }
export class SpeechQueue {
  private queue: { text: string; key?: string }[] = []; private unlocked = false; private busy = false; private generation = 0; private held = false; private activeText?: string;
  constructor(private port: SpeechPort, private language: string) {}
  get idle() { return !this.busy && !this.queue.length; }
  unlock() { this.unlocked = true; this.port.prime?.(this.language); this.port.resume?.(); this.pump(); }
  hold() { this.held = true; }
  resume() { this.held = false; this.port.resume?.(); this.pump(); }
  enqueue(text: string, key?: string) {
    if (!text.trim()) return;
    if (this.activeText === text || this.queue.some((item) => item.text === text)) return;
    if (key) this.queue = this.queue.filter((item) => item.key !== key);
    if (this.queue.at(-1)?.text !== text) this.queue.push({ text, key });
    this.pump();
  }
  bargeIn() { this.generation++; this.queue = []; this.busy = false; this.activeText = undefined; this.port.cancel(); }
  private pump() {
    if (!this.unlocked || this.held || this.busy || !this.queue.length) return;
    const { text } = this.queue.shift()!; const generation = this.generation; this.busy = true; this.activeText = text;
    this.port.speak(text, this.language, () => { if (generation !== this.generation) return; this.busy = false; this.activeText = undefined; this.pump(); });
  }
}

export function playbackSession(type: 'playback' | 'play-and-record') {
  micDebug('audio.session', { type });
  try { const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession; if (session) session.type = type; } catch { /* Not supported on every browser. */ }
}

export class BrowserSpeech implements SpeechPort {
  private current?: SpeechSynthesisUtterance;
  private primer?: SpeechSynthesisUtterance;
  private primed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private failed: () => void, private synthesis = globalThis.speechSynthesis,
    private utterance = (text: string) => new SpeechSynthesisUtterance(text)) {}
  resume() { playbackSession('playback'); this.synthesis?.resume(); }
  prime(language: string) {
    if (this.primed || !this.synthesis) return;
    this.cancel();
    this.primed = true;
    const primer = this.primer = this.utterance(' '); primer.volume = 0; primer.lang = language;
    primer.onend = () => { if (this.primer === primer) this.primer = undefined; micDebug('speech.prime.end'); };
    primer.onerror = (event) => { if (this.primer !== primer) return; this.primer = undefined; this.primed = false; micDebug('speech.prime.error', { code: speechError(event.error) }); };
    try { this.resume(); this.synthesis.speak(primer); micDebug('speech.prime'); }
    catch { this.primer = undefined; this.primed = false; micDebug('speech.prime.error', { code: 'exception' }); }
  }
  speak(text: string, language: string, done: () => void) {
    if (!this.synthesis) { this.failed(); done(); return; }
    this.cancel();
    this.resume();
    const current = this.current = this.utterance(text);
    const available = this.synthesis.getVoices();
    const voices = available.filter((voice) => voice.lang.toLowerCase().split('-')[0] === language.split('-')[0]);
    current.voice = voices.find((voice) => voice.localService) ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
    current.lang = language; current.volume = 1; current.rate = 1;
    micDebug('speech.request', { voiceIndex: current.voice ? available.indexOf(current.voice) : -1, language, local: current.voice?.localService, paused: this.synthesis.paused, speaking: this.synthesis.speaking });
    let finished = false;
    const finish = (failed: boolean) => {
      if (finished || this.current !== current) return;
      finished = true; clearTimeout(this.timer); this.current = undefined;
      if (failed) { this.primed = false; this.synthesis.cancel(); this.failed(); }
      done();
    };
    current.onstart = () => micDebug('speech.start');
    current.onend = () => { micDebug('speech.end'); finish(false); };
    current.onerror = (event) => { const code = speechError(event.error); micDebug('speech.error', { code }); finish(code !== 'interrupted' && code !== 'canceled'); };
    this.timer = setTimeout(() => { micDebug('speech.error', { code: 'timeout' }); finish(true); }, Math.min(120_000, Math.max(10_000, text.length * 150)));
    try { this.synthesis.speak(current); } catch { micDebug('speech.error', { code: 'exception' }); finish(true); }
  }
  cancel() { clearTimeout(this.timer); this.current = undefined; this.primer = undefined; this.synthesis?.cancel(); }
}
function speechError(code: string) {
  return ['canceled', 'interrupted', 'audio-busy', 'audio-hardware', 'network', 'synthesis-unavailable', 'synthesis-failed', 'language-unavailable', 'voice-unavailable', 'text-too-long', 'invalid-argument', 'not-allowed'].includes(code) ? code : 'unknown';
}
