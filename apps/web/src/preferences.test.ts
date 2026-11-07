import { describe, expect, it } from 'vitest';
import { clientProfile, deviceLanguage } from './preferences.js';
describe('device language and saved voice profile', () => {
  it.each([['fr-FR', 'fr'], ['fr-CA', 'fr'], ['en-US', 'en'], ['de-DE', 'en']])('uses navigator language %s', (device, language) => expect(deviceLanguage(device)).toBe(language));
  it('starts without contacts or an onboarding form and accepts a partly confirmed profile', () => {
    expect(clientProfile(null, 'fr-FR')).toEqual({ language: 'fr' });
    expect(clientProfile({ language: 'en', name: 'Marie' }, 'fr-FR')).toEqual({ language: 'fr', name: 'Marie' });
  });
  it('loads confirmed contacts but drops obsolete preferences and uses current device language', () => {
    const contacts = { name: 'Marie', phone: '0612345678', email: 'marie@example.com', guide_dog: false };
    expect(clientProfile(JSON.parse(JSON.stringify({ ...contacts, language: 'fr', mic_mode: 'hold', tts_enabled: false })), 'en-GB')).toEqual({ ...contacts, language: 'en' });
  });
  it('ignores corrupt or invalid saved profile data', () => expect(clientProfile({ language: 'en', email: 'invalid' }, 'en')).toEqual({ language: 'en' }));
});
