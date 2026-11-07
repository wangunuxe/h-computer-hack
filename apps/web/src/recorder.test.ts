import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from './recorder.js';
import { stopRecording } from './protocol.js';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 0; bufferedAmount = 0;
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onerror?: () => void; onclose?: (event: { code: number }) => void;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor() { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  finish(text?: string) {
    if (text) this.onmessage?.({ data: JSON.stringify({ type: 'transcript', data: { id: '1', is_final: true, utterance: { text } } }) });
    this.onmessage?.({ data: JSON.stringify({ type: 'end_session' }) });
  }
}
class Worklet {
  static instances: Worklet[] = [];
  port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  disconnect = vi.fn(); connect = vi.fn((node) => node);
  constructor() { Worklet.instances.push(this); }
  emit(buffer: ArrayBuffer) { this.port.onmessage?.({ data: buffer }); }
}
class Context {
  resume = vi.fn(async () => {}); close = vi.fn(async () => {}); destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() }));
}
const credentials = { id: 'issued', resume_token: 'token' };
const response = () => new Response(JSON.stringify({ url: 'wss://gladia.example/live' }));
const active: Recorder[] = [];
function setup() {
  const track = { stop: vi.fn() }; const stream = { getTracks: () => [track] };
  const media = vi.fn().mockResolvedValue(stream); const fetcher = vi.fn().mockResolvedValue(response());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } }); vi.stubGlobal('fetch', fetcher);
  const transcript = vi.fn(); const error = vi.fn(); const done = vi.fn();
  const recorder = new Recorder(transcript, error, done); active.push(recorder);
  return { recorder, transcript, error, done, media, fetcher, track, stream };
}
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; Worklet.instances = []; vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Worklet); });
afterEach(() => { for (const recorder of active.splice(0)) recorder.cancel(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('recorder audio startup and finalization', () => {
  it('finishes normally at 180 seconds and delivers all final utterances', async () => {
    const s = setup(); const limit = vi.fn(), elapsed = vi.fn();
    const recorder = new Recorder(s.transcript, s.error, s.done, limit, elapsed); active.push(recorder);
    await recorder.start(credentials); const socket = Socket.instances[0]!; socket.open();
    vi.advanceTimersByTime(179_000); expect(socket.send).not.toHaveBeenCalled(); expect(elapsed).toHaveBeenLastCalledWith(179);
    vi.advanceTimersByTime(1000); expect(socket.send).toHaveBeenCalledExactlyOnceWith(stopRecording);
    expect(limit).toHaveBeenCalledOnce(); expect(s.done).not.toHaveBeenCalled(); expect(s.error).not.toHaveBeenCalled();
    socket.finish('Bonjour '.repeat(430).trim());
    expect(s.transcript).toHaveBeenCalledExactlyOnceWith('Bonjour '.repeat(430).trim()); expect(s.error).not.toHaveBeenCalled();
  });
  it('captures while fetching the URL and flushes ordered PCM followed by stop after an early release', async () => {
    const s = setup(); const request = deferred<Response>(); s.fetcher.mockReturnValue(request.promise);
    const starting = s.recorder.start(credentials); await flush();
    expect(s.media).toHaveBeenCalledWith({ audio: { noiseSuppression: true, echoCancellation: true, channelCount: 1 } });
    expect(Socket.instances).toHaveLength(0);
    const first = new ArrayBuffer(2), second = new ArrayBuffer(4); Worklet.instances[0]!.emit(first);
    request.resolve(response()); await starting;
    const socket = Socket.instances[0]!; Worklet.instances[0]!.emit(second);
    s.recorder.stop(); s.recorder.stop();
    expect(s.track.stop).toHaveBeenCalled(); expect(s.done).not.toHaveBeenCalled(); expect(socket.send).not.toHaveBeenCalled();
    socket.open(); expect(socket.send.mock.calls).toEqual([[first], [second], [stopRecording]]);
    socket.finish('Bonjour Paris'); expect(s.transcript).toHaveBeenCalledExactlyOnceWith('Bonjour Paris'); expect(s.error).not.toHaveBeenCalled(); expect(s.done).toHaveBeenCalledOnce();
  });
  it('flushes on open and continues sending live PCM until release', async () => {
    const s = setup(); await s.recorder.start(credentials);
    const socket = Socket.instances[0]!; const first = new ArrayBuffer(2), second = new ArrayBuffer(4);
    Worklet.instances[0]!.emit(first); socket.open(); Worklet.instances[0]!.emit(second);
    s.recorder.stop(); socket.finish('Merci');
    expect(socket.send.mock.calls).toEqual([[first], [second], [stopRecording]]); expect(s.transcript).toHaveBeenCalledWith('Merci');
  });
  it('stops late microphone tracks after release without cancelling the connecting socket', async () => {
    const s = setup(); const permission = deferred<typeof s.stream>(); s.media.mockReturnValue(permission.promise);
    const starting = s.recorder.start(credentials); s.recorder.stop(); permission.resolve(s.stream); await starting;
    expect(s.track.stop).toHaveBeenCalled(); expect(Worklet.instances).toHaveLength(0);
    const socket = Socket.instances[0]!; socket.open(); expect(socket.send.mock.calls).toEqual([[stopRecording]]);
    socket.finish(); expect(s.transcript).not.toHaveBeenCalled(); expect(s.error).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce();
  });
  it('cleans up late permission results after cancellation and ignores the aborted URL response', async () => {
    const s = setup(); const permission = deferred<typeof s.stream>(); const request = deferred<Response>();
    s.media.mockReturnValue(permission.promise); s.fetcher.mockReturnValue(request.promise);
    const starting = s.recorder.start(credentials); s.recorder.cancel(); permission.resolve(s.stream); request.resolve(response()); await starting;
    expect(s.track.stop).toHaveBeenCalled(); expect(Socket.instances).toHaveLength(0); expect(Worklet.instances).toHaveLength(0); expect(s.done).toHaveBeenCalledOnce(); expect(s.error).not.toHaveBeenCalled();
  });
  it('fails closed if the preconnection PCM buffer exceeds its bound', async () => {
    const s = setup(); await s.recorder.start(credentials); Worklet.instances[0]!.emit(new ArrayBuffer(1_000_001));
    expect(s.error).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce(); expect(s.track.stop).toHaveBeenCalled(); expect(Socket.instances[0]!.send).not.toHaveBeenCalled();
  });
  it('cleans up capture when URL initialization fails', async () => {
    const s = setup(); s.fetcher.mockResolvedValue(new Response('{}', { status: 429 })); await s.recorder.start(credentials);
    expect(s.error).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce(); expect(s.track.stop).toHaveBeenCalled(); expect(Socket.instances).toHaveLength(0);
  });
  it('bounds finalization after release', async () => {
    const s = setup(); await s.recorder.start(credentials); Socket.instances[0]!.open(); s.recorder.stop();
    vi.advanceTimersByTime(10_000); expect(s.error).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce(); expect(s.track.stop).toHaveBeenCalled();
  });
});
