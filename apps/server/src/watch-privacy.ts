import { WatchPayloadSchema, type AgentStep, type ServerEvent, type TravelerProfile, type WatchPayload } from '@voila/shared';
import { redactContactText } from './voice-profile.js';
import { redactGpsCoordinates } from './location.js';

export function sanitizeWatchEvent(event: ServerEvent | AgentStep | { type: 'final_transcript' | 'user_reply'; text: string } | { type: 'agent_metrics'; steps: number; cost_usd: number | null } | { type: 'agent_view'; url: string }, profile?: TravelerProfile, { collecting = false, payment = false }: { collecting?: boolean; payment?: boolean } = {}): WatchPayload | undefined {
  if (event.type === 'profile') return { type: 'traveler', ...(event.profile.name ? { name: event.profile.name } : {}) };
  if (event.type === 'agent_metrics' || event.type === 'agent_view') {
    const parsed = WatchPayloadSchema.safeParse(event);
    return parsed.success ? parsed.data : undefined;
  }
  if (payment && (event.type === 'agent_step' || event.type === 'feed' && event.kind === 'agent')) return;
  let value: unknown = event;
  if (event.type === 'payment_handoff') value = { type: event.type, amount: event.amount, merchant: event.merchant };
  if (event.type === 'booking_card') { const { operator_phone: _phone, payment_url: _url, ...booking } = event.booking; value = { type: event.type, booking }; }
  if (collecting && ['say', 'profile_request', 'clarify', 'final_transcript', 'user_reply'].includes(event.type)) {
    value = { ...event, ...('text' in event ? { text: '[Contact details stay on the phone]' } : { question: '[Contact details stay on the phone]' }) };
  }
  const clean = (text: string) => {
    let safe = redactGpsCoordinates(redactContactText(text.replace(/https?:\/\/[^\s<>]+/gi, (url) => safeUrl(url) ?? '[link]'), profile)).replace(/\b(?:latitude|longitude|lat|lng|lon)\s*[:=]?\s*[+-]?\d{1,3}[.,]\d+/giu, '[position GPS]');
    for (const name of profile?.name?.split(/\s+/).filter((part) => part.length > 1 && !/^(de|du|des|le|la|van|von)$/i.test(part)) ?? []) safe = safe.replace(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '[contact]');
    const unit = /(?:[€$£¥%°]|\b(?:EUR|USD|GBP|euros?|dollars?|km|cm|mm|m|kg|g|ml|l|h|min|minutes?|s|sec|seconds?))\s*$/iu;
    const afterUnit = /^\s*(?:[€$£¥%°]|(?:EUR|USD|GBP|euros?|dollars?|km|cm|mm|m|kg|g|ml|l|h|min|minutes?|s|sec|seconds?)\b)/iu;
    safe = safe.replace(/(?<![\p{L}\d.,])[+-]?\d{1,3}[.,]\d{4,}(?![\d.,])/gu, (match, offset: number, source: string) => unit.test(source.slice(0, offset)) || afterUnit.test(source.slice(offset + match.length)) ? match : '[position GPS]');
    return safe;
  };
  const safeUrl = (text: string) => {
    try {
      const url = new URL(text); if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
      const page = /^\/fr\/reservation\/[^/]+\/(route|vehicle|info)\/?$/.exec(url.pathname)?.[1];
      return url.origin + (page ? '/fr/reservation/…/' + page : '');
    } catch { return; }
  };
  const safe = JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (typeof item !== 'string') return item;
    if (!['url', 'source'].includes(key)) return clean(item);
    const url = safeUrl(item);
    return url && clean(url) === url ? url : undefined;
  }));
  const parsed = WatchPayloadSchema.safeParse(safe);
  return parsed.success ? parsed.data : undefined;
}
