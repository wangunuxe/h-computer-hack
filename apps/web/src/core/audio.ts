/** Synthesised sound design (no audio assets): station ambience, SNCF-style jingle, UI ticks. */
export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambience?: { gain: GainNode; stop: () => void };
  muted = false;

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private noiseBuffer(seconds = 2, brown = true) {
    const ctx = this.ensure();
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private tone(freq: number, at: number, dur: number, vol = 0.2, type: OscillatorType = "sine") {
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Busy station hall: low rumble + murmur. `level` 0..1. */
  ambienceOn(level = 1) {
    const ctx = this.ensure();
    if (this.ambience) {
      this.ambience.gain.gain.setTargetAtTime(0.22 * level, ctx.currentTime, 0.4);
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.22 * level, ctx.currentTime, 0.6);
    gain.connect(this.master!);

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer(4, true);
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    rumble.connect(lp).connect(gain);

    const murmur = ctx.createBufferSource();
    murmur.buffer = this.noiseBuffer(3, false);
    murmur.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.9;
    const mg = ctx.createGain();
    mg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(mg.gain);
    murmur.connect(bp).connect(mg).connect(gain);

    rumble.start();
    murmur.start();
    lfo.start();
    this.ambience = {
      gain,
      stop: () => {
        rumble.stop();
        murmur.stop();
        lfo.stop();
      },
    };
  }

  ambienceOff(fade = 0.8) {
    if (!this.ambience || !this.ctx) return;
    const a = this.ambience;
    this.ambience = undefined;
    a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => a.stop(), fade * 1000 + 200);
  }

  /** Four-note station announcement jingle (C – G – A♭ – E♭). */
  jingle() {
    const ctx = this.ensure();
    const t = ctx.currentTime + 0.05;
    const notes = [523.25, 783.99, 830.61, 622.25];
    notes.forEach((f, i) => {
      const at = t + i * 0.32;
      const dur = i === 3 ? 1.6 : 0.7;
      this.tone(f, at, dur, 0.16, "sine");
      this.tone(f * 2, at, dur * 0.6, 0.05, "sine");
      this.tone(f * 3, at, dur * 0.3, 0.02, "triangle");
    });
  }

  alarm(times = 3) {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      this.tone(960, t + i * 0.5, 0.22, 0.07, "square");
      this.tone(720, t + i * 0.5 + 0.24, 0.22, 0.07, "square");
    }
  }

  blip(pitch = 1) {
    const ctx = this.ensure();
    this.tone(1400 * pitch, ctx.currentTime, 0.06, 0.04, "sine");
  }

  tick() {
    const ctx = this.ensure();
    this.tone(2600, ctx.currentTime, 0.015, 0.015, "square");
  }

  click() {
    const ctx = this.ensure();
    this.tone(1800, ctx.currentTime, 0.03, 0.06, "triangle");
    this.tone(600, ctx.currentTime, 0.04, 0.04, "sine");
  }

  whoosh() {
    const ctx = this.ensure();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(1, false);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    src.connect(bp).connect(g).connect(this.master!);
    src.start();
    src.stop(t + 0.7);
  }

  listenStart() {
    const ctx = this.ensure();
    this.tone(660, ctx.currentTime, 0.12, 0.12);
    this.tone(990, ctx.currentTime + 0.1, 0.18, 0.12);
  }

  listenStop() {
    const ctx = this.ensure();
    this.tone(990, ctx.currentTime, 0.12, 0.1);
    this.tone(660, ctx.currentTime + 0.1, 0.18, 0.1);
  }

  pay() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    this.tone(1318.5, t, 0.5, 0.14);
    this.tone(1760, t + 0.09, 0.8, 0.12);
  }

  voila() {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, t + i * 0.09, 1.4 - i * 0.1, 0.1));
    this.tone(130.8, t, 2.2, 0.12, "triangle");
  }
}

export const sfx = new Sfx();
