export interface SpeechPort { speak(text: string, language: string, done: () => void): void; cancel(): void }
export class SpeechQueue {
  private queue: string[] = []; private unlocked = false; private busy = false; private generation = 0;
  constructor(private port: SpeechPort, private language: string) {}
  unlock() { this.unlocked = true; this.pump(); }
  enqueue(text: string) { if (text.trim()) this.queue.push(text); this.pump(); }
  bargeIn() { this.generation++; this.queue = []; this.busy = false; this.port.cancel(); }
  private pump() {
    if (!this.unlocked || this.busy || !this.queue.length) return;
    const text = this.queue.shift()!; const generation = this.generation; this.busy = true;
    this.port.speak(text, this.language, () => { if (generation !== this.generation) return; this.busy = false; this.pump(); });
  }
}
