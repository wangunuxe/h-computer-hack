import workletUrl from './pcm-worklet.ts?worker&url';
import { parseGladia, stopRecording } from './protocol.js';
import { captureFailure, SpeechInitializationError, type RecordingFailure } from './recording-error.js';
import { playbackSession } from './speech.js';

export interface Credentials { id: string; resume_token: string }
export class Recorder {
  private context?: AudioContext; private stream?: MediaStream; private socket?: WebSocket; private node?: AudioWorkletNode;
  private controller = new AbortController(); private timer?: ReturnType<typeof setTimeout>; private segments = new Map<string, { final?: string; partial?: string }>(); private stopping = false;
  private tailTimer?: ReturnType<typeof setTimeout>; private endTimer?: ReturnType<typeof setTimeout>; private captureEnded = false; private stopSent = false;
  private buffered: ArrayBuffer[] = []; private bufferedBytes = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private audioBytes = 0;
  constructor(private transcript: (text: string) => void, private error: (failure: RecordingFailure) => void, private done: () => void, private limit: () => void = () => {}, private elapsed: (seconds: number) => void = () => {}, private playback: () => void = () => {}) {}
  async start(credentials: Credentials) {
    try {
      const started = Date.now(); this.elapsed(0);
      this.ticker = setInterval(() => this.elapsed(Math.floor((Date.now() - started) / 1000)), 1000);
      this.timer = setTimeout(() => { if (!this.stopping) { this.stop(); if (!this.controller.signal.aborted) this.limit(); } }, 180_000);
      playbackSession('play-and-record'); this.context = new AudioContext();
      const resumed = this.context.resume();
      void resumed.catch(() => {});
      await this.capture(resumed);
    } catch (cause) { this.fail(captureFailure(cause)); return; }
    if (this.controller.signal.aborted) return;
    try { await this.connect(credentials); }
    catch (cause) { this.fail({ kind: 'service', code: cause instanceof SpeechInitializationError && cause.status === 429 ? 'rate-limit' : 'initialization', cause }); }
  }
  private async capture(resumed: Promise<void>) {
    const stream = this.stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true, channelCount: 1 } });
    if (this.controller.signal.aborted || this.stopping) { stream.getTracks().forEach((track) => track.stop()); return; }
    await resumed;
    if (this.controller.signal.aborted || this.stopping) return;
    await this.context!.audioWorklet.addModule(workletUrl);
    if (this.controller.signal.aborted || this.stopping) return;
    this.node = new AudioWorkletNode(this.context!, 'pcm16');
    this.node.port.onmessage = (event) => {
      if (this.controller.signal.aborted || this.captureEnded) return;
      const buffer = event.data as ArrayBuffer;
      if (this.bufferedBytes + (this.socket?.bufferedAmount ?? 0) + buffer.byteLength > 1_000_000) { this.fail({ kind: 'service', code: 'audio-backlog' }); return; }
      this.audioBytes += buffer.byteLength;
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(buffer);
      else { this.buffered.push(buffer); this.bufferedBytes += buffer.byteLength; }
    };
    this.context!.createMediaStreamSource(stream).connect(this.node);
    const silent = this.context!.createGain(); silent.gain.value = 0; this.node.connect(silent).connect(this.context!.destination);
  }
  private async connect(credentials: Credentials) {
      const response = await fetch('/gladia/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: this.controller.signal });
      if (!response.ok) throw new SpeechInitializationError(response.status);
      const { url } = await response.json(); this.controller.signal.throwIfAborted();
      const socket = this.socket = new WebSocket(url);
      socket.onmessage = (event) => {
        const message = parseGladia(String(event.data));
        if ((message.type === 'final' || message.type === 'partial') && message.text) {
          const segment = this.segments.get(message.id) ?? {};
          segment[message.type] = message.text; this.segments.set(message.id, segment);
        }
        if (message.type === 'end') this.finish();
        if (message.type === 'error') this.fail({ kind: 'provider', code: 'provider-event', cause: event.data });
      };
      socket.onerror = (cause) => this.fail({ kind: 'service', code: 'connection', cause });
      socket.onclose = (event) => { if (this.stopping && event.code === 1000) this.finish(); else this.fail({ kind: 'service', code: 'connection-closed', cause: event }); };
      socket.onopen = () => {
        if (this.controller.signal.aborted) { socket.close(); return; }
        for (const buffer of this.buffered) socket.send(buffer);
        this.buffered = []; this.bufferedBytes = 0;
        if (this.stopping && this.captureEnded) this.sendStop();
      };
  }
  stop() {
    if (this.stopping) return;
    if (!this.audioBytes) { this.fail({ kind: 'empty', code: 'released-before-audio' }); return; }
    clearTimeout(this.timer); clearInterval(this.ticker);
    this.timer = setTimeout(() => { if ([...this.segments.values()].some((segment) => segment.final || segment.partial)) this.finishNow(); else this.fail({ kind: 'service', code: 'finalization-timeout' }); }, 10_000);
    this.stopping = true;
    this.tailTimer = setTimeout(() => {
      this.captureEnded = true; this.releaseCapture();
      if (this.socket?.readyState === WebSocket.OPEN) this.sendStop();
    }, 250);
  }
  private sendStop() {
    if (this.stopSent) return;
    this.stopSent = true; this.socket!.send(stopRecording);
  }
  private releaseCapture() {
    this.stream?.getTracks().forEach((track) => track.stop()); this.node?.disconnect();
    const context = this.context; this.context = undefined;
    void Promise.resolve(context?.close()).catch(() => {}).then(() => { playbackSession('playback'); this.playback(); });
  }
  cancel() {
    if (this.controller.signal.aborted) return;
    this.controller.abort(); clearTimeout(this.timer); clearTimeout(this.tailTimer); clearTimeout(this.endTimer); clearInterval(this.ticker); this.releaseCapture();
    this.buffered = []; this.bufferedBytes = 0;
    this.socket?.close(); this.done();
  }
  private fail(failure: RecordingFailure) { if (this.controller.signal.aborted) return; this.cancel(); this.error(failure); }
  private finish() {
    if (this.controller.signal.aborted || this.endTimer) return;
    if ([...this.segments.values()].some((segment) => segment.partial && !segment.final) || !this.segments.size) this.endTimer = setTimeout(() => this.finishNow(), 300);
    else this.finishNow();
  }
  private finishNow() { if (this.controller.signal.aborted) return; const text = [...this.segments.values()].map((segment) => segment.final || segment.partial).join(' ').trim(); if (text) { this.cancel(); this.transcript(text); } else this.fail({ kind: 'empty', code: 'empty-transcript' }); }
}
