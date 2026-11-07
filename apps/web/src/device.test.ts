import { describe, expect, it } from 'vitest';
import { shouldShowcase } from './device.js';

const desktop = { pathname: '/', search: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', coarsePointer: false };
describe('desktop showcase routing', () => {
  it('routes desktops with no query to the showcase', () => {
    expect(shouldShowcase(desktop)).toBe(true);
    expect(shouldShowcase({ ...desktop, userAgent: '' })).toBe(true);
  });
  it.each(['iPhone', 'Android', 'iPad', 'iPod', 'Mobile'])('keeps %s on the phone client even without pointer detection', (userAgent) => {
    expect(shouldShowcase({ ...desktop, userAgent })).toBe(false);
  });
  it('keeps touch devices and explicit phone overrides on the voice client', () => {
    expect(shouldShowcase({ ...desktop, coarsePointer: true })).toBe(false);
    expect(shouldShowcase({ ...desktop, search: '?scenario=demo&client=phone' })).toBe(false);
  });
  it('only routes the root and ignores unrelated overrides', () => {
    expect(shouldShowcase({ ...desktop, pathname: '/showcase.html' })).toBe(false);
    expect(shouldShowcase({ ...desktop, pathname: '/unknown' })).toBe(false);
    expect(shouldShowcase({ ...desktop, search: '?client=other' })).toBe(true);
  });
});
