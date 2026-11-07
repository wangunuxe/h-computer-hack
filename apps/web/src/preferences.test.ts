import { describe, expect, it } from 'vitest';
import { clientProfile } from './preferences.js';

const profile = { name: 'Karim', phone: '+33612345678', email: 'karim@example.com', guide_dog: true, language: 'fr' };
describe('client-only profile preferences', () => {
  it('migrates stored profiles to toggle mode with Voilà speech enabled', () => {
    expect(clientProfile(profile)).toEqual({ ...profile, mic_mode: 'toggle', tts_enabled: true });
  });
  it('persists hold mode and screen-reader-only speech through storage', () => {
    const stored = { ...profile, mic_mode: 'hold', tts_enabled: false };
    expect(clientProfile(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
  it('defaults unsupported preferences without accepting an invalid profile', () => {
    expect(clientProfile({ ...profile, mic_mode: 'invalid', tts_enabled: 'false' })).toEqual({ ...profile, mic_mode: 'toggle', tts_enabled: true });
    expect(clientProfile(null)).toBeUndefined(); expect(clientProfile({})).toBeUndefined(); expect(clientProfile({ ...profile, email: 'invalid' })).toBeUndefined();
  });
});
