import type { Gps } from '@voila/shared';
import { distanceMeters, stations } from './stations.js';

export function originFromGps(gps: Gps): string {
  const nearest = stations.map((station) => ({ station, distance: distanceMeters(gps, station) })).sort((a, b) => a.distance - b.distance)[0]!;
  return nearest.distance <= 800 && (gps.accuracy ?? 0) <= 800 ? nearest.station.name : `Position GPS (${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)})`;
}
export function redactGpsCoordinates(text: string): string {
  return text.replace(/(?:position\s+gps|gps\s+position)\s*\([^)]*\)/gi, 'Position GPS')
    .replace(/(?<![\d.])[+-]?\d{1,2}\.\d+\s*[,;]\s*[+-]?\d{1,3}\.\d+(?![\d.])/g, '[position GPS]');
}
