export interface SpeechPort { speak(text: string, language: string, done: () => void): void; cancel(): void; resume?(): void }
export class SpeechQueue {
  private queue: { text: string; key?: string }[] = []; private unlocked = false; private busy = false; private generation = 0; private held = false; private activeText?: string;
  constructor(private port: SpeechPort, private language: string) {}
  get idle() { return !this.busy && !this.queue.length; }
  unlock() { this.unlocked = true; this.port.resume?.(); this.pump(); }
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
  try { const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession; if (session) session.type = type; } catch { /* Not supported on every browser. */ }
}

export class BrowserSpeech implements SpeechPort {
  private current?: SpeechSynthesisUtterance;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private failed: () => void, private synthesis = globalThis.speechSynthesis,
    private utterance = (text: string) => new SpeechSynthesisUtterance(text)) {}
  resume() { playbackSession('playback'); this.synthesis?.resume(); }
  speak(text: string, language: string, done: () => void) {
    if (!this.synthesis) { this.failed(); done(); return; }
    this.resume();
    const current = this.current = this.utterance(text);
    const voices = this.synthesis.getVoices().filter((voice) => voice.lang.toLowerCase().split('-')[0] === language.split('-')[0]);
    current.voice = voices.find((voice) => voice.localService) ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
    current.lang = language; current.volume = 1; current.rate = 1;
    let finished = false;
    const finish = (failed: boolean) => {
      if (finished || this.current !== current) return;
      finished = true; clearTimeout(this.timer); this.current = undefined;
      if (failed) { this.synthesis.cancel(); this.failed(); }
      done();
    };
    current.onend = () => finish(false); current.onerror = () => finish(true);
    this.timer = setTimeout(() => finish(true), Math.min(120_000, Math.max(10_000, text.length * 150)));
    try { this.synthesis.speak(current); } catch { finish(true); }
  }
  cancel() { clearTimeout(this.timer); const active = this.current; this.current = undefined; if (active || this.synthesis?.speaking || this.synthesis?.pending) this.synthesis?.cancel(); }
}
