import { describe, expect, it } from 'vitest';
import { parsePhone, parseEmail, VoiceProfile, forgetDetails, redactContactText } from './voice-profile.js';
describe('local spoken contact parsers', () => {
  it.each(['anna at gmail.com', 'anna arobase gmail.com', 'anna.smith at gmail.com', 'anna point smith arobase gmail.com', 'anna@gmail dot com', 'anna at example dot co.uk'])('redacts mixed spoken/literal email %s', (email) => {
    const text = `my email is ${email}, from Gare du Nord to CDG 2E`;
    const safe = redactContactText(text); expect(safe).toContain('[email]'); expect(safe).not.toContain('anna'); expect(safe).not.toContain('gmail'); expect(safe).toContain('Gare du Nord to CDG 2E');
  });
  it.each([
    ['Call me on zero six twelve thirty four fifty six seventy eight, take me from Gare du Nord to CDG 2E', 'zero six twelve'],
    ['Call me on zero six twelve, take me from Gare du Nord to CDG 2E', 'zero six twelve'],
    ['Call me on zero 6 twelve 34 five six seventy eight, take me from Gare du Nord to CDG 2E', 'zero 6 twelve'],
    ['Call me on zero six twelve thirty four fifty six seventy eight nine, take me from Gare du Nord to CDG 2E', 'zero six twelve'],
    ["mon numéro c'est zéro six douze trente-quatre cinquante-six soixante-dix-huit, de Gare du Nord à CDG 2E", 'zéro six douze'],
    ['mon téléphone est zéro six, douze, trente quatre, cinquante six, soixante dix huit, de Gare du Nord à CDG 2E', 'zéro six'],
    ["I'm Marie, take me from Gare du Nord to CDG 2E", 'Marie'],
    ["c'est Marie, emmenez-moi de Gare du Nord à CDG 2E", 'Marie'],
    ['my email is marie at gmail dot com, from Gare du Nord to CDG 2E', 'marie'],
    ['mon mail est marie arobase gmail point com, de Gare du Nord à CDG 2E', 'marie'],
  ])('removes spoken contacts, including incomplete numbers, without removing the route: %s', (text, secret) => {
    const safe = redactContactText(text); expect(safe.toLowerCase()).not.toContain(secret.toLowerCase()); expect(safe).toContain('Gare du Nord'); expect(safe).toContain('CDG 2E');
  });
  it('redacts every saved contact verbatim and leaves ordinary travel statements unchanged', () => {
    const safe = redactContactText('Marie Dupont, 0612345678, marie@example.com: Gare du Nord to CDG 2E', { language: 'fr', name: 'Marie Dupont', phone: '0612345678', email: 'marie@example.com' });
    expect(safe).not.toMatch(/Marie|0612345678|marie@example/); expect(safe).toContain('Gare du Nord to CDG 2E');
    for (const text of ['', 'I am at Gare du Nord', "I'm travelling with a guide dog to CDG 2E", "c'est la navette pour CDG 2E", 'two passengers and one bag to CDG 2E']) expect(redactContactText(text)).toBe(text);
  });
  it.each([
    ["je m'appelle Karim Benali, je suis à gare du Nord et je vais à CDG 2E", ['gare du Nord', 'CDG 2E']],
    ["je m'appelle Karim Benali je suis à gare du Nord et je vais à CDG 2E", ['gare du Nord', 'CDG 2E']],
    ['my name is Anna Lee and I need a taxi from Gare du Nord to CDG 2E', ['Gare du Nord', 'CDG 2E']],
    ['my name is Anna Lee and my email is anna@example.com and I need a taxi to CDG 2E', ['taxi', 'CDG 2E']],
    ["je m'appelle Karim Benali avec un chien guide pour rejoindre CDG 2E", ['avec un chien guide', 'CDG 2E']],
    ['mon téléphone est 0612345678, je suis à gare du Nord et je vais à CDG 2E', ['gare du Nord', 'CDG 2E']],
    ['my email is karim@example.com and I need a taxi to CDG 2E', ['taxi', 'CDG 2E']],
    ['mon email est karim point benali arobase example point fr, je vais à CDG 2E', ['CDG 2E']],
    ['mon numéro est zéro six douze trente quatre cinquante six soixante dix huit, je vais à CDG 2E', ['CDG 2E']],
  ])('redacts contact spans without discarding the route: %s', (speech, route) => {
    const redacted = redactContactText(speech, { language: 'fr', name: 'Karim' });
    for (const value of route) expect(redacted).toContain(value);
    for (const value of ['Karim', 'Benali', 'Anna Lee', '0612345678', 'karim@example.com', 'arobase', 'zéro six douze']) expect(redacted.toLowerCase()).not.toContain(value.toLowerCase());
  });
  it.each([
    ['zéro six douze trente-quatre cinquante-six soixante-dix-huit', '0612345678'],
    ['zero six one two three four five six seven eight', '0612345678'],
    ['plus trente-trois six douze trente-quatre cinquante-six soixante-dix-huit', '+33612345678'],
    ['06 12 34 56 78', '0612345678'], ['+33 (6) 12-34-56-78', '+33612345678'],
    ['zero seven ninety one eighty two seventy three sixty four', '0791827364'],
  ])('parses %s deterministically', (speech, expected) => expect(parsePhone(speech)).toBe(expected));
  it.each(['', '2', 'tomorrow at two', 'zero six twelve', '0612345678901234567'])('rejects ambiguous or invalid phone %s', (speech) => expect(parsePhone(speech)).toBeUndefined());
  it.each([
    ['marie point dupont arobase gmail point com', 'marie.dupont@gmail.com'],
    ['john dot smith at example dot com', 'john.smith@example.com'],
    ['Mon adresse e-mail est marie tiret bas test arobase example point fr.', 'marie_test@example.fr'],
    ['USER@EXAMPLE.COM', 'user@example.com'],
  ])('parses spoken email %s', (speech, expected) => expect(parseEmail(speech)).toBe(expected));
  it.each(['', 'example dot com', 'name at', 'a@@example.com'])('rejects invalid email %s', (speech) => expect(parseEmail(speech)).toBeUndefined());
  it('recognizes forget commands and redacts known or explicit contacts', () => {
    expect(forgetDetails('Efface mes informations.')).toBe(true); expect(forgetDetails('forget my details')).toBe(true); expect(forgetDetails('go to CDG')).toBe(false);
    expect(redactContactText('Call 0612345678 or marie@example.com')).not.toMatch(/0612345678|marie@example/);
    expect(redactContactText('Marie goes to CDG', { language: 'fr', name: 'Marie' })).not.toContain('Marie');
    expect(redactContactText('I can get there tomorrow', { language: 'en', name: 'Can' })).toBe('I [contact] get there tomorrow');
    expect(redactContactText('Cancel the journey to Cannes', { language: 'en', name: 'Ann' })).toBe('Cancel the journey to Cannes');
  });
});
describe('one-field-at-a-time voice profile confirmation', () => {
  it('does not save until confirmed, reads phone digits individually, and accepts corrections', () => {
    const flow = new VoiceProfile({ language: 'fr' }, ['phone', 'email']);
    expect(flow.question).toContain('téléphone');
    expect(flow.reply('zéro six douze trente quatre cinquante six soixante dix huit').text).toContain('zero, six, un, deux');
    expect(flow.profile.phone).toBeUndefined();
    expect(flow.reply('non').changed).toBe(false); expect(flow.question).toContain('téléphone');
    flow.reply('0712345678'); expect(flow.reply('oui').changed).toBe(true); expect(flow.profile.phone).toBe('0712345678');
    expect(flow.question).toContain('e-mail'); flow.reply('marie at example dot com');
    expect(flow.reply('yes').complete).toBe(true); expect(flow.profile.email).toBe('marie@example.com');
  });
  it('handles empty or invalid responses without inventing profile data', () => {
    const flow = new VoiceProfile({ language: 'en' }, ['email']);
    expect(flow.reply('').changed).toBe(false); expect(flow.reply('not an address').complete).toBe(false); expect(flow.profile.email).toBeUndefined();
  });
  it('retains a confirmed no-dog answer and skips saved fields', () => {
    const flow = new VoiceProfile({ language: 'en', name: 'Marie' }, ['name', 'guide_dog']);
    expect(flow.field).toBe('guide_dog'); flow.reply('no'); expect(flow.profile.guide_dog).toBeUndefined();
    expect(flow.reply('yes').complete).toBe(true); expect(flow.profile.guide_dog).toBe(false);
  });
});
