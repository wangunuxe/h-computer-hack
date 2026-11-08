export interface Station { name: string; aliases: readonly string[]; latitude: number; longitude: number; lines: readonly string[] }
export const normalizePlace = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const stations: readonly Station[] = [
  { name: 'La Défense', aliases: ['la defense'], latitude: 48.8919, longitude: 2.2387, lines: ['RER A', 'M1', 'T2'] },
  { name: 'Bercy', aliases: ['bercy'], latitude: 48.8404, longitude: 2.3795, lines: ['M6', 'M14'] },
  { name: 'Gare de Lyon', aliases: ['gare de lyon'], latitude: 48.8449, longitude: 2.3735, lines: ['RER A', 'RER D', 'M1', 'M14'] },
  { name: 'Gare du Nord', aliases: ['gare du nord', 'gar du nor'], latitude: 48.8809, longitude: 2.3553, lines: ['RER B', 'RER D', 'M4', 'M5'] },
  { name: 'Châtelet–Les Halles', aliases: ['chatelet', 'les halles'], latitude: 48.8619, longitude: 2.3470, lines: ['RER A', 'RER B', 'RER D', 'M1', 'M4', 'M7', 'M11', 'M14'] },
  { name: 'Charles de Gaulle–Étoile', aliases: ['etoile', 'arc de triomphe'], latitude: 48.8738, longitude: 2.2950, lines: ['RER A', 'M1', 'M2', 'M6'] },
  { name: 'Gare Montparnasse', aliases: ['montparnasse'], latitude: 48.8412, longitude: 2.3205, lines: ['M4', 'M6', 'M12', 'M13'] },
  { name: 'Gare de l’Est', aliases: ['gare de l est'], latitude: 48.8769, longitude: 2.3591, lines: ['M4', 'M5', 'M7'] },
  { name: 'Saint-Michel–Notre-Dame', aliases: ['saint michel'], latitude: 48.8534, longitude: 2.3445, lines: ['RER B', 'RER C', 'M4'] },
  { name: 'Luxembourg', aliases: ['luxembourg'], latitude: 48.8467, longitude: 2.3398, lines: ['RER B'] },
  { name: 'Port-Royal', aliases: ['port royal'], latitude: 48.8399, longitude: 2.3370, lines: ['RER B'] },
  { name: 'Denfert-Rochereau', aliases: ['denfert'], latitude: 48.8338, longitude: 2.3325, lines: ['RER B', 'M4', 'M6'] },
  { name: 'Cité Universitaire', aliases: ['cite universitaire'], latitude: 48.8201, longitude: 2.3390, lines: ['RER B', 'T3a'] },
  { name: 'CDG', aliases: ['cdg', 'roissy', 'charles de gaulle'], latitude: 49.0038, longitude: 2.5795, lines: ['RER B'] },
  { name: 'Orly', aliases: ['orly'], latitude: 48.7284, longitude: 2.3659, lines: ['M14'] },
];
export function stationForPlace(place: string): Station | undefined {
  const text = ` ${normalizePlace(place)} `;
  return stations.find((station) => station.aliases.some((alias) => text.includes(` ${alias} `)));
}
export function relevantLines(origin: string, destination: string): string[] {
  const from = stationForPlace(origin)?.lines ?? [], to = stationForPlace(destination)?.lines ?? [];
  const shared = from.filter((line) => to.includes(line));
  if (shared.length) return shared.slice(0, 3);
  const priority = (line: string) => line.startsWith('RER ') ? 0 : line === 'M1' ? 1 : line === 'M14' ? 2 : line.startsWith('M') ? 3 : 4;
  const queue = [...from].sort((a, b) => priority(a) - priority(b)).map((line) => [line]);
  const visited = new Set(from);
  while (queue.length) {
    const path = queue.shift()!, last = path.at(-1)!;
    if (to.includes(last)) return path;
    if (path.length >= 3) continue;
    const connections = [...new Set(stations.filter((station) => station.lines.includes(last)).flatMap((station) => station.lines))].sort((a, b) => priority(a) - priority(b));
    for (const line of connections) if (!visited.has(line)) { visited.add(line); queue.push([...path, line]); }
  }
  return [];
}
export function distanceMeters(a: Pick<Station, 'latitude' | 'longitude'>, b: Pick<Station, 'latitude' | 'longitude'>): number {
  const radians = (n: number) => n * Math.PI / 180;
  const d = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(1 - d));
}
export function trafficPage(line: string): string {
  if (/^RER [A-E]$/.test(line)) return `https://www.ratp.fr/infos-trafic/rer-transilien/${line.slice(-1).toLowerCase()}`;
  if (/^M(?:[1-9]|1[0-4])$/.test(line)) return `https://www.ratp.fr/infos-trafic/metro/${line.slice(1)}`;
  if (/^T(?:2|3a)$/.test(line)) return `https://www.ratp.fr/infos-trafic/tram/${line.slice(1)}`;
  throw new Error('Unsupported traffic line');
}
