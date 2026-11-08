import { describe, expect, it } from 'vitest';
import { DecisionSpeech } from './decision-speech.js';

describe('decision speech', () => {
  it('does not decorate free-form questions or empty prompts', () => {
    const speech = new DecisionSpeech('en');
    expect(speech.utterance({ type: 'clarify', question: 'Where are you?' }, 'CLARIFY')).toBe('Where are you?');
    expect(speech.utterance({ type: 'say', text: 'Where are you?' }, 'CLARIFY')).toBeUndefined();
    expect(speech.utterance({ type: 'profile_request', question: 'Your name?' }, 'CHOOSE')).toBe('Your name?');
    expect(speech.utterance({ type: 'clarify', question: ' ', yes_no: true }, 'CLARIFY')).toBeUndefined();
  });
  it('only repeats the hint when a reminder actually re-reads the question', () => {
    const speech = new DecisionSpeech('fr');
    const event = { type: 'clarify', question: 'Est-ce correct ?', yes_no: true } as const;
    const utterance = 'Est-ce correct ? Oui à gauche, non à droite.';
    expect(speech.utterance(event, 'CLARIFY')).toBe(utterance);
    expect(speech.utterance({ type: 'say', text: event.question }, 'CLARIFY')).toBeUndefined();
    expect(speech.utterance({ type: 'say', text: 'Je reste en attente.' }, 'CLARIFY')).toBe('Je reste en attente.');
    expect(speech.utterance({ type: 'say', text: event.question }, 'CLARIFY')).toBe(utterance);
    speech.utterance({ type: 'stage', stage: 'EXECUTE' }, 'EXECUTE');
    expect(speech.utterance({ type: 'say', text: event.question }, 'EXECUTE')).toBe(event.question);
  });
  it('does not suppress a different narration after a question', () => {
    const speech = new DecisionSpeech('en');
    speech.utterance({ type: 'confirm', summary: 'Book taxi' }, 'CONFIRM');
    expect(speech.utterance({ type: 'say', text: 'Stopped.' }, 'LISTEN')).toBe('Stopped.');
  });
});
