import { ScenarioSchema, type TravelerProfile, type WebEvent } from '@voila/shared';
export function phoneHello(profile: TravelerProfile, search: string): Extract<WebEvent, { type: 'hello' }> {
  const params = new URLSearchParams(search);
  return { type: 'hello', profile, gps: null, scenario: ScenarioSchema.safeParse(params.get('scenario')).data, watch: params.get('watch') || undefined };
}
