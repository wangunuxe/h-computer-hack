import { describe, expect, it } from 'vitest';
import { parseGladia, stopRecording } from './protocol.js';
describe('Gladia protocol', () => {
  it('retains short partial utterances for finalization fallback', () => {
    expect(parseGladia(JSON.stringify({ type: 'transcript', data: { id: 'one', is_final: false, utterance: { text: ' oui ' } } }))).toEqual({ type: 'partial', id: 'one', text: 'oui' });
  });
  it('reads the documented final utterance shape', () => {
    expect(parseGladia(JSON.stringify({ type: 'transcript', data: { id: 'one', is_final: true, utterance: { text: ' Bonjour ' } } }))).toEqual({ type: 'final', id: 'one', text: 'Bonjour' });
    expect(JSON.parse(stopRecording)).toEqual({ type: 'stop_recording' });
  });
  it.each(['{}', 'null', '{"type":"transcript","data":{"is_final":false}}', '{"type":"transcript","data":{"is_final":true}}'])('ignores non-final, incomplete and unrelated messages: %s', (raw) => expect(parseGladia(raw)).toEqual({ type: 'ignore' }));
  it('recognizes completion and errors', () => { expect(parseGladia('{"type":"end_session"}')).toEqual({ type: 'end' }); expect(parseGladia('{"type":"error"}')).toEqual({ type: 'error' }); expect(parseGladia('{')).toEqual({ type: 'error' }); });
});
