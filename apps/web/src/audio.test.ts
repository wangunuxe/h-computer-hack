import { describe, expect, it } from 'vitest';
import { Downsampler, pcm16 } from './audio.js';
describe('PCM audio', () => {
  it('clips and encodes signed little-endian PCM16', () => {
    const view = new DataView(pcm16([-2, -1, 0, 1, 2, NaN]));
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767, 0]);
    expect(pcm16([]).byteLength).toBe(0);
  });
  it.each([16000, 44100, 48000])('preserves one second and chunk boundaries at %s Hz', (rate) => {
    const samples = Float32Array.from({ length: rate }, (_, i) => Math.sin(i / 19));
    const expected = new Uint8Array(new Downsampler(rate).process(samples)); const sampler = new Downsampler(rate); const bytes: number[] = [];
    for (let i = 0; i < samples.length; i += 128) bytes.push(...new Uint8Array(sampler.process(samples.subarray(i, i + 128))));
    expect(expected.byteLength).toBe(32000); expect(new Uint8Array(bytes)).toEqual(expected);
  });
  it('averages rather than dropping samples and rejects invalid rates', () => {
    expect(new DataView(new Downsampler(48000).process(new Float32Array([1, 0, -1]))).getInt16(0, true)).toBe(0);
    expect(() => new Downsampler(0)).toThrow(); expect(() => new Downsampler(NaN)).toThrow();
  });
});
