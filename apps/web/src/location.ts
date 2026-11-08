import { GpsSchema, type Gps } from '@voila/shared';

export function phoneLocation(send: (requestId: string, gps: Gps | null) => void, geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation) {
  const requests = new Map<string, Promise<Gps | null>>();
  return (requestId: string) => {
    let request = requests.get(requestId);
    if (!request) {
      request = new Promise<Gps | null>((resolve) => {
        if (!geolocation) { resolve(null); return; }
        try {
          geolocation.getCurrentPosition(({ coords }) => resolve(GpsSchema.safeParse({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }).data ?? null), () => resolve(null), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
        } catch { resolve(null); }
      });
      requests.set(requestId, request);
    }
    void request.then((gps) => send(requestId, gps));
  };
}
