import { ProfileSchema, type Profile } from '@voila/shared';

export type ClientProfile = Profile & { mic_mode: 'toggle' | 'hold'; tts_enabled: boolean };
export function clientProfile(value: unknown): ClientProfile | undefined {
  const parsed = ProfileSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const preferences = value as Record<string, unknown>;
  return { ...parsed.data, mic_mode: preferences.mic_mode === 'hold' ? 'hold' : 'toggle', tts_enabled: preferences.tts_enabled !== false };
}
