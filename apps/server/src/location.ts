import type { Gps } from '@voila/shared';
import { distanceMeters, stations } from './stations.js';

export function originFromGps(gps: Gps): string {
  const nearest = stations.map((station) => ({ station, distance: distanceMeters(gps, station) })).sort((a, b) => a.distance - b.distance)[0]!;
  return nearest.distance <= 800 && (gps.accuracy ?? 0) <= 800 ? nearest.station.name : `Position GPS (${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)})`;
}
export function redactGpsCoordinates(text: string): string {
  const decimal = String.raw`[+-]?(?:0|[1-9]\d{0,2})\s*(?:[.,]|point|virgule)\s*\d{2,}`;
  const pair = new RegExp(String.raw`(?<![\p{L}\d.,])(${decimal})(\s*°?\s*[NS]\b)?((?:\s*[,;]\s*|\s+)(?:(?:longitude|lon|lng)\s*[:=]?\s*)?)(${decimal})(\s*°?\s*[EWO]\b)?(?![\d.,])`, 'giu');
  return text.replace(/(?:position\s+gps|gps\s+position)\s*\([^)]*\)/gi, 'Position GPS')
    .replace(pair, (match, latitude: string, north: string | undefined, _separator: string, longitude: string, east: string | undefined, offset: number, source: string) => {
      const number = (value: string) => Number(value.replace(/\s*(?:[.,]|point|virgule)\s*/i, '.'));
      if (Math.abs(number(latitude)) > 90 || Math.abs(number(longitude)) > 180) return match;
      const before = source.slice(Math.max(0, offset - 80), offset), after = source.slice(offset + match.length);
      if (/(?:prices?|prix|costs?|fares?|tarifs?|phone|telephone|num[eé]ro|number|EUR|USD|€|\$)\s*(?:(?:are|is|est|sont)\s*)?[:=]?\s*$/iu.test(before) || /^\s*(?:EUR\b|USD\b|€|\$)/iu.test(after)) return match;
      const clock = (value: string) => /^\d{1,2}[.,]\d{2}$/.test(value) && Number(value.split(/[.,]/)[0]) <= 23 && Number(value.split(/[.,]/)[1]) < 60;
      if (!north && !east && !/(?:gps|coordonn[eé]es|coordinates|latitude|position)\s*[:=]?\s*$/iu.test(before) && clock(latitude) && clock(longitude)) return match;
      return '[position GPS]';
    });
}
