import { Downsampler } from './audio.js';
declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class PCMProcessor extends AudioWorkletProcessor {
  private sampler = new Downsampler(sampleRate);
  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (channel) { const buffer = this.sampler.process(channel); this.port.postMessage(buffer, [buffer]); }
    return true;
  }
}
registerProcessor('pcm16', PCMProcessor);
