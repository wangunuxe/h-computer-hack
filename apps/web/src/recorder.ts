import workletUrl from './pcm-worklet.ts?worker&url';
import { parseGladia, stopRecording } from './protocol.js';

export interface Credentials { id: string; resume_token: string }
export class Recorder {
  private context?: AudioContext; private stream?: MediaStream; private socket?: WebSocket; private node?: AudioWorkletNode;
  private controller = new AbortController(); private timer?: ReturnType<typeof setTimeout>; private final = new Map<string, string>(); private stopping = false;
  private buffered: ArrayBuffer[] = []; private bufferedBytes = 0;
  constructor(private transcript: (text: string) => void, private error: () => void, private done: () => void) {}
  async start(credentials: Credentials) {
    try {
      this.timer = setTimeout(() => { this.error(); this.cancel(); }, 60_000);
      this.context = new AudioContext();
      const resumed = this.context.resume();
      await Promise.all([resumed, this.capture(resumed), this.connect(credentials)]);
    } catch { if (!this.controller.signal.aborted) this.error(); this.cancel(); }
  }
  private async capture(resumed: Promise<void>) {
    const stream = this.stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, channelCount: 1 } });
    if (this.controller.signal.aborted || this.stopping) { stream.getTracks().forEach((track) => track.stop()); return; }
    await resumed;
    await this.context!.audioWorklet.addModule(workletUrl);
    if (this.controller.signal.aborted || this.stopping) return;
    this.node = new AudioWorkletNode(this.context!, 'pcm16');
    this.node.port.onmessage = (event) => {
      if (this.controller.signal.aborted || this.stopping) return;
      const buffer = event.data as ArrayBuffer;
      if (this.bufferedBytes + (this.socket?.bufferedAmount ?? 0) + buffer.byteLength > 1_000_000) { this.error(); this.cancel(); return; }
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(buffer);
      else { this.buffered.push(buffer); this.bufferedBytes += buffer.byteLength; }
    };
    this.context!.createMediaStreamSource(stream).connect(this.node);
    const silent = this.context!.createGain(); silent.gain.value = 0; this.node.connect(silent).connect(this.context!.destination);
  }
  private async connect(credentials: Credentials) {
      const response = await fetch('/gladia/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: this.controller.signal });
      if (!response.ok) throw new Error('Speech initialization failed');
      const { url } = await response.json(); this.controller.signal.throwIfAborted();
      const socket = this.socket = new WebSocket(url);
      socket.onmessage = (event) => {
        const message = parseGladia(String(event.data));
        if (message.type === 'final') this.final.set(message.id, message.text);
        if (message.type === 'end') this.finish();
        if (message.type === 'error') { this.error(); this.cancel(); }
      };
      socket.onerror = () => { if (!this.controller.signal.aborted) this.error(); this.cancel(); };
      socket.onclose = (event) => { if (this.stopping && event.code === 1000) this.finish(); else if (!this.controller.signal.aborted) { this.error(); this.cancel(); } };
      socket.onopen = () => {
        if (this.controller.signal.aborted) { socket.close(); return; }
        for (const buffer of this.buffered) socket.send(buffer);
        this.buffered = []; this.bufferedBytes = 0;
        if (this.stopping) this.sendStop();
      };
  }
  stop() {
    if (this.stopping) return;
    this.stopping = true; this.node?.disconnect(); this.stream?.getTracks().forEach((track) => track.stop());
    if (this.socket?.readyState === WebSocket.OPEN) this.sendStop();
  }
  private sendStop() {
    this.socket!.send(stopRecording); clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.error(); this.cancel(); }, 10_000);
  }
  cancel() {
    if (this.controller.signal.aborted) return;
    this.controller.abort(); clearTimeout(this.timer); this.stream?.getTracks().forEach((track) => track.stop()); this.node?.disconnect();
    this.buffered = []; this.bufferedBytes = 0;
    this.socket?.close(); void this.context?.close(); this.done();
  }
  private finish() { if (this.controller.signal.aborted) return; const text = [...this.final.values()].join(' ').trim(); this.cancel(); if (text) this.transcript(text); else this.error(); }
}
