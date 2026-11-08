import { describe, expect, it } from 'vitest';
import { confirmationAnswer } from './confirmation-answer.js';
import { VoiceProfile } from './voice-profile.js';
describe('short spoken confirmation answers', () => {
  it.each(["oui c'est ça", 'ouais', 'exact', 'yes', 'Oui.'])('recognizes %s and applies it to profile readbacks', (text) => {
    expect(confirmationAnswer(text)).toBe('yes');
    const profile = new VoiceProfile({ language: 'fr' }, ['name']);
    expect(profile.yesNo).toBe(false); profile.reply('Camille'); expect(profile.yesNo).toBe(true);
    expect(profile.reply(text).complete).toBe(true); expect(profile.profile.name).toBe('Camille');
  });
  it.each(['Non.', 'nan', "non c'est pas ça", 'no'])('rejects %s without committing a profile candidate', (text) => {
    const profile = new VoiceProfile({ language: 'fr' }, ['name']); profile.reply('Camille'); profile.reply(text);
    expect(profile.profile.name).toBeUndefined(); expect(profile.yesNo).toBe(false);
  });
  it.each(['', 'oui mais demain', 'Non, je pars de Châtelet', 'maybe', 'yes? no'])('leaves ambiguous replies and corrections for interpretation: %s', (text) => expect(confirmationAnswer(text)).toBeUndefined());
});
