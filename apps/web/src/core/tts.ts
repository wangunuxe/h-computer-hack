/** Thin wrapper over speechSynthesis with a timing fallback when muted or unavailable. */
export class Tts {
  muted = false;
  rate = 1.05;
  private voice?: SpeechSynthesisVoice;

  constructor(private lang = "en-US") {
    if (!("speechSynthesis" in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      const prefer = ["Samantha", "Ava", "Google UK English Female", "Google US English", "Microsoft Aria", "Karen", "Daniel"];
      this.voice =
        prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ??
        voices.find((v) => v.lang.startsWith(this.lang.slice(0, 2)));
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  static estimateMs(text: string) {
    return 400 + text.split(/\s+/).length * 330;
  }

  speak(text: string, opts: { lang?: string; pitch?: number; rate?: number } = {}): Promise<void> {
    const est = Tts.estimateMs(text);
    if (this.muted || !("speechSynthesis" in window)) return new Promise((r) => setTimeout(r, est));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang ?? this.lang;
      if (this.voice && !opts.lang) u.voice = this.voice;
      u.rate = opts.rate ?? this.rate;
      u.pitch = opts.pitch ?? 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // Some engines never fire onend; never hang the show.
      setTimeout(finish, est * 1.8 + 1500);
      speechSynthesis.speak(u);
    });
  }

  cancel() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}
