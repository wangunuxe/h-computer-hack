import { TravelerProfileSchema, type TravelerProfile } from '@voila/shared';

export const deviceLanguage = (language: string): 'fr' | 'en' => language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
export function clientProfile(value: unknown, language: string): TravelerProfile {
  const parsed = TravelerProfileSchema.safeParse(value);
  return { ...(parsed.success ? parsed.data : {}), language: deviceLanguage(language) };
}
