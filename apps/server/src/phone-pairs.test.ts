import { describe, expect, it } from 'vitest';
import { parsePhone, redactContactText, VoiceProfile } from './voice-profile.js';
const cases = [
  ['06 12 34 56 78', '0612345678'],
  ['07 91 82 43 97', '0791824397'],
  ['06 80 93 71 90', '0680937190'],
  ['0, 6, 1, 2, 3, 4  5, 6, 7, 8', '0612345678'],
  ['zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit', '0612345678'],
  ['zéro sept, quatre-vingt-onze, quatre-vingt-deux, quarante-trois, quatre-vingt-dix-sept', '0791824397'],
  ['zéro six, quatre-vingts, quatre-vingt-treize, soixante et onze, quatre-vingt-dix', '0680937190'],
  ['06 douze trente 4 cinquante 6 soixante 18', '0612345678'],
  ['06 80 quatre vingt 13 soixante et 11 90', '0680937190'],
  ['0612345678', '0612345678'], ['06-12-34-56-78', '0612345678'],
  ['le 06 12 34 56 78', '0612345678'],
  ['+33 6 douze 34 56 78', '+33612345678'], ['+33 (0)6 12 34 56 78', '+33612345678'],
  ["oui, mon numéro c'est le zéro six douze trente-quatre cinquante-six soixante-dix-huit", '0612345678'],
];
describe('French phone pairs and real Gladia transcripts', () => {
  it.each(cases)('parses %s on the first profile reply', (text, expected) => {
    expect(parsePhone(text!)).toBe(expected);
    const profile = new VoiceProfile({ language: 'fr' }, ['phone']);
    const result = profile.reply(text!); expect(result.text).toContain('Est-ce correct');
    const digits = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
    expect(result.text).toContain(expected!.split('').map((digit) => digit === '+' ? 'plus' : digits[Number(digit)]).join(', ')); profile.reply('oui'); expect(profile.profile.phone).toBe(expected);
  });
  it.each(cases)('redacts %s without losing trip quantities', (text) => {
    const safe = redactContactText(`mon téléphone est ${text}, 2 personnes à CDG à 20:45 le 2027-01-15`);
    expect(safe).toContain('[phone]'); expect(safe).toContain('2 personnes à CDG à 20:45 le 2027-01-15');
  });
  it.each(cases)('also redacts bare phone forms without an introduction: %s', (text) => {
    const safe = redactContactText(`${text}, 2 personnes à 20:45 le 2027-01-15`);
    expect(safe).toContain('[phone]'); expect(safe).toContain('2 personnes à 20:45 le 2027-01-15');
  });
  it('explains failed parsing with fresh guidance instead of repeating the original question', () => {
    const profile = new VoiceProfile({ language: 'fr' }, ['phone']);
    const prompts = ['', '06 douze', 'du bruit'].map((text) => profile.reply(text).text);
    expect(new Set(prompts).size).toBe(3);
    for (const prompt of prompts) { expect(prompt).toContain('dix chiffres'); expect(prompt).toContain('deux par deux'); expect(prompt).toContain('zéro six, douze'); }
    expect(profile.profile.phone).toBeUndefined();
  });
  it('does not split explicit pairs to manufacture a missing final pair', () => {
    expect(parsePhone('zéro six, douze, trente-quatre, cinquante-six')).toBeUndefined();
  });
});
