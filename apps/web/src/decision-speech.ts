import type { ServerEvent } from '@voila/shared';
import { decisionHint } from './labels.js';
import type { Stage } from './state.js';

export class DecisionSpeech {
  private question?: { text: string; utterance: string };
  private mirror?: string;
  constructor(private language: 'fr' | 'en') {}
  utterance(event: ServerEvent, stage: Stage): string | undefined {
    if (event.type === 'stage') { this.question = undefined; this.mirror = undefined; }
    if (event.type === 'confirm' || event.type === 'clarify' || event.type === 'profile_request') {
      const text = (event.type === 'confirm' ? event.summary : event.question).trim();
      const yesNo = event.type === 'confirm' || event.yes_no === true;
      const utterance = text && yesNo ? `${text}${/[.!?…]$/.test(text) ? ' ' : '. '}${decisionHint(this.language, stage)}` : text;
      this.question = yesNo && text ? { text, utterance } : undefined;
      this.mirror = text;
      return utterance || undefined;
    }
    if (event.type === 'say') {
      const text = event.text.trim();
      const mirrored = text === this.mirror; this.mirror = undefined;
      if (mirrored) return undefined;
      return (text === this.question?.text ? this.question.utterance : text) || undefined;
    }
  }
}
