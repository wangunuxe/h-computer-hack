import type { ServerEvent, WebEvent } from '@voila/shared';
export type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
export interface State {
  cancellable: boolean;
  stage: Stage; options: Extract<ServerEvent, { type: 'options' }>['items']; summary?: string;
  payment?: Extract<ServerEvent, { type: 'payment_handoff' }>; booking?: Extract<ServerEvent, { type: 'booking_card' }>['booking'];
  feed: Extract<ServerEvent, { type: 'feed' }>[]; error?: string;
}
export const initialState = (): State => ({ stage: 'LISTEN', options: [], feed: [], cancellable: false });
export const canStop = (state: State) => state.cancellable;
export function reduce(state: State, event: ServerEvent): State {
  switch (event.type) {
    case 'activity': return { ...state, cancellable: event.cancellable };
    case 'stage': return event.stage === 'LISTEN' ? { ...initialState(), feed: state.feed } : { ...state, stage: event.stage };
    case 'options': return { ...state, options: event.items };
    case 'confirm': return { ...state, summary: event.summary };
    case 'payment_handoff': return { ...state, payment: event };
    case 'booking_card': return { ...state, booking: event.booking };
    case 'feed': return { ...state, feed: [...state.feed, event].slice(-100) };
    case 'error': return { ...state, error: event.message };
    default: return state;
  }
}
export function transcriptEvent(stage: Stage, text: string): WebEvent | undefined {
  const trimmed = text.trim();
  return trimmed ? { type: ['LISTEN', 'DONE'].includes(stage) ? 'final_transcript' : 'user_reply', text: trimmed } : undefined;
}
export function optionEvent(options: State['options'], id: string): WebEvent | undefined {
  const index = options.findIndex((option) => option.id === id);
  return index < 0 ? undefined : { type: 'user_reply', text: String(index + 1) };
}
