import { describe, expect, it, vi } from 'vitest';
import { phoneLocation } from './location.js';

describe('one-shot phone location', () => {
  it('requests high accuracy with a ten-second timeout and sends accuracy', async () => {
    const send = vi.fn(), getCurrentPosition = vi.fn((done: PositionCallback) => done({ coords: { latitude: 48.8919, longitude: 2.2387, accuracy: 12 } } as GeolocationPosition));
    const request = phoneLocation(send, { getCurrentPosition }); request('first'); await Promise.resolve();
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
    expect(send).toHaveBeenCalledWith('first', { latitude: 48.8919, longitude: 2.2387, accuracy: 12 });
    request('first'); await Promise.resolve(); expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([1, 2, 3])('falls back on permission denial, unavailable position or timeout (%s), without reprompting', async (code) => {
    const send = vi.fn(), getCurrentPosition = vi.fn((_done: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code } as GeolocationPositionError));
    const request = phoneLocation(send, { getCurrentPosition }); request('same'); request('same'); await Promise.resolve();
    expect(getCurrentPosition).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledWith('same', null);
  });
  it('handles unsupported location and thrown browser errors', async () => {
    const send = vi.fn(); phoneLocation(send, undefined)('unsupported');
    phoneLocation(send, { getCurrentPosition: () => { throw new Error('Security policy'); } })('blocked'); await Promise.resolve();
    expect(send).toHaveBeenCalledWith('unsupported', null); expect(send).toHaveBeenCalledWith('blocked', null);
  });
  it.each([{ latitude: 91, longitude: 2, accuracy: 1 }, { latitude: 48, longitude: 181, accuracy: 1 }, { latitude: 48, longitude: 2, accuracy: -1 }])('falls back for invalid coordinates or accuracy: %j', async (coords) => {
    const send = vi.fn(); phoneLocation(send, { getCurrentPosition: (done) => done({ coords } as GeolocationPosition) })('invalid'); await Promise.resolve();
    expect(send).toHaveBeenCalledWith('invalid', null);
  });
});
