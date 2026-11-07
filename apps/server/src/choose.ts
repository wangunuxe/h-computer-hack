import type { Option } from '@voila/shared';
import { spokenOptionName } from './narrate.js';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const ordinals: Record<string, number> = {
  un: 1, une: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4,
  premier: 1, premiere: 1, first: 1, '1er': 1, '1ere': 1, '1st': 1,
  deuxieme: 2, second: 2, seconde: 2, '2e': 2, '2eme': 2, '2nd': 2,
  troisieme: 3, third: 3, '3e': 3, '3eme': 3, '3rd': 3,
  quatrieme: 4, fourth: 4, '4e': 4, '4eme': 4, '4th': 4,
};
const words = (text: string) => (normalize(text).match(/[a-z0-9]+/g) ?? []).join(' ');
const prefix = '(?:(?:please|oui|yes|ok|okay|merci) )?(?:(?:je prends|je choisis|i choose|i select|i will take|i ll take) )?(?:(?:le|la|l|les|the|option|numero|number) )?';
const suffix = '(?: (?:s il vous plait|s il te plait|please|merci|thanks|thank you|c est bien|is fine))?';

export function chooseOption(reply: string, options: readonly Option[]): string | null {
  const text = normalize(reply).trim();
  if (/\?|\bsavoir si\b|\best[ -]ce\b|\bdo you know\b|\bwhether\b|\bsi\b.*\baccepte[a-z]*\b|\bcan i\b/.test(text)) return null;
  if (/\?/.test(text) || /^(?:est[ -]ce\b|qu['’]est[ -]ce\b|combien\b|quel[a-z]*\b|quand\b|comment\b|pourquoi\b|ou\b|is\b|are\b|does\b|do\b|can\b|how\b|what\b|which\b|when\b|where\b|why\b|[a-z]+(?:-t)?-(?:il|elle|on|ils|elles|vous|tu|nous)\b)/.test(text)) return null;
  if (/\b(?:demain|tomorrow|instead|moins|plus|cheapest|fastest|cher|rapide|stop[a-z]*|arret[a-z]*|annul[a-z]*|cancel[a-z]*|no|non|pas|not)\b/.test(text)) return null;
  const selection = words(text);
  if (!selection) return null;
  const matches = new Set<string>();
  for (const [index, option] of options.entries()) {
    const aliases = new Set([option.name, spokenOptionName(option, 'fr'), spokenOptionName(option, 'en'), String(index + 1), ...Object.keys(ordinals).filter((ordinal) => ordinals[ordinal] === index + 1)]);
    const tokens = normalize(`${option.name} ${option.id}`).split(/[^a-z0-9]+/);
    if (tokens.some((token) => ['taxi', 'g7'].includes(token))) aliases.add('taxi');
    if (tokens.some((token) => ['shuttle', 'navette'].includes(token))) { aliases.add('shuttle'); aliases.add('navette'); }
    for (const keyword of ['g7', 'bus']) if (tokens.includes(keyword)) aliases.add(keyword);
    if ([...aliases].some((alias) => {
      const name = words(alias);
      return name && new RegExp(`^${prefix}${name}${suffix}$`).test(selection);
    })) matches.add(option.id);
  }
  return matches.size === 1 ? [...matches][0]! : null;
}
