import type { Option } from '@voila/shared';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const ordinals: Record<string, number> = {
  premier: 1, premiere: 1, first: 1, '1er': 1, '1ere': 1, '1st': 1,
  deuxieme: 2, second: 2, seconde: 2, '2e': 2, '2eme': 2, '2nd': 2,
  troisieme: 3, third: 3, '3e': 3, '3eme': 3, '3rd': 3,
  quatrieme: 4, fourth: 4, '4e': 4, '4eme': 4, '4th': 4,
};

export function chooseOption(reply: string, options: readonly Option[]): string | null {
  const text = normalize(reply).trim();
  if (/\?/.test(text) || /^(?:est[ -]ce\b|qu['’]est[ -]ce\b|combien\b|quel[a-z]*\b|quand\b|comment\b|pourquoi\b|ou\b|is\b|are\b|does\b|do\b|can\b|how\b|what\b|which\b|when\b|where\b|why\b|[a-z]+(?:-t)?-(?:il|elle|on|ils|elles|vous|tu|nous)\b)/.test(text)) return null;
  if (/\b(?:demain|tomorrow|instead|moins|plus|cheapest|fastest|cher|rapide|stop[a-z]*|arret[a-z]*|annul[a-z]*|cancel[a-z]*|no|non|pas|not)\b/.test(text)) return null;
  const words = text.match(/[a-z0-9]+/g) ?? [];
  const matches = new Set<string>();
  for (const word of words) {
    const index = ordinals[word] ?? (/^\d+$/.test(word) ? Number(word) : undefined);
    if (index !== undefined) {
      const option = options[index - 1];
      if (!option) return null;
      matches.add(option.id);
    }
    const keyword = word === 'navette' ? 'shuttle' : word;
    if (['shuttle', 'taxi', 'g7', 'bus'].includes(keyword)) {
      const candidates = options.filter((option) => {
        const name = normalize(`${option.name} ${option.id}`);
        if (keyword === 'taxi') return /\b(taxi|g7)\b/.test(name);
        if (keyword === 'shuttle') return /\b(shuttle|navette)\b/.test(name);
        return name.split(/[^a-z0-9]+/).includes(keyword);
      });
      for (const option of candidates) matches.add(option.id);
    }
  }
  return matches.size === 1 ? [...matches][0]! : null;
}
