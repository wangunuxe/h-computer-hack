import type { ServerEvent, WebEvent } from '@voila/shared';
export type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
export interface State {
  yesNo: boolean;
  cancellable: boolean;
  stage: Stage; options: Extract<ServerEvent, { type: 'options' }>['items']; summary?: string;
  payment?: Extract<ServerEvent, { type: 'payment_handoff' }>; booking?: Extract<ServerEvent, { type: 'booking_card' }>['booking'];
  feed: Extract<ServerEvent, { type: 'feed' }>[]; error?: string;
}
export const initialState = (): State => ({ stage: 'LISTEN', options: [], feed: [], cancellable: false, yesNo: false });
export const canStop = (state: State) => state.cancellable;
export function reduce(state: State, event: ServerEvent): State {
  switch (event.type) {
    case 'activity': return { ...state, cancellable: event.cancellable };
    case 'stage': return event.stage === 'LISTEN' ? { ...initialState(), feed: state.feed } : { ...state, stage: event.stage, yesNo: false };
    case 'options': return { ...state, options: event.items };
    case 'confirm': return { ...state, summary: event.summary, yesNo: true };
    case 'clarify': case 'profile_request': return { ...state, yesNo: event.yes_no === true };
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
export function paymentCommand(text: string): boolean {
  const value = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  return /^(?:(?:oui|yes|ok|okay|d accord) )?(?:(?:je veux |je voudrais |i want to |i d like to |let me |go to )?(?:payer|paye|paie|paiement|pay|payment)|(?:ouvre|ouvrir|ouvrez|open) (?:le |la page de |the )?(?:paiement|payment)(?: page)?)(?: (?:maintenant|now|s il vous plait|please|merci|thanks))*$/.test(value);
}
export function optionEvent(options: State['options'], id: string): WebEvent | undefined {
  const index = options.findIndex((option) => option.id === id);
  return index < 0 ? undefined : { type: 'user_reply', text: String(index + 1) };
}
