import { describe, expect, it } from 'vitest';
import { phoneHello } from './pairing.js';
describe('silent phone pairing', () => {
  it('includes the URL code and scenario in hello and leaves ordinary phones unchanged', () => {
    expect(phoneHello({ language: 'fr' }, '?client=phone&scenario=live&watch=ABC234')).toMatchObject({ type: 'hello', watch: 'ABC234', scenario: 'live', gps: null });
    expect(JSON.stringify(phoneHello({ language: 'en' }, '?client=phone'))).not.toContain('watch');
  });
});
