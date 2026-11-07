export const stopRecording = JSON.stringify({ type: 'stop_recording' });
export type GladiaMessage = { type: 'final'; id: string; text: string } | { type: 'end' } | { type: 'error' } | { type: 'ignore' };
export function parseGladia(raw: string): GladiaMessage {
  try {
    const message = JSON.parse(raw);
    if (message?.type === 'error') return { type: 'error' };
    if (message?.type === 'end_session') return { type: 'end' };
    if (message?.type === 'transcript' && message.data?.is_final === true && typeof message.data.id === 'string' && typeof message.data.utterance?.text === 'string')
      return { type: 'final', id: message.data.id, text: message.data.utterance.text.trim() };
  } catch { return { type: 'error' }; }
  return { type: 'ignore' };
}
