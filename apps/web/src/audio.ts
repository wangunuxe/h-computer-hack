export function pcm16(samples: readonly number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => { const value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0)); view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
  return buffer;
}

export class Downsampler {
  private remaining: number;
  private sum = 0;
  private ratio: number;
  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < 16000) throw new Error('Unsupported sample rate');
    this.ratio = inputRate / 16000; this.remaining = this.ratio;
  }
  process(samples: Float32Array): ArrayBuffer {
    const output: number[] = [];
    for (const sample of samples) {
      let available = 1;
      while (available > 1e-9) {
        const take = Math.min(this.remaining, available);
        this.sum += sample * take; this.remaining -= take; available -= take;
        if (this.remaining < 1e-9) { output.push(this.sum / this.ratio); this.sum = 0; this.remaining = this.ratio; }
      }
    }
    return pcm16(output);
  }
}
