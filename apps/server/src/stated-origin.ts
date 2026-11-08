export function statedOrigin(transcript: string): string | undefined {
  const introduced = /(?:^|[,;.!?]\s*|\b(?:et|and|mais|but)\s+)(?:je\s+(?:suis|me trouve)\s+(?:à|a|au|aux)|je\s+pars\s+(?:de|du|des)|i(?:['’]m|\s+am)\s+(?:at|in)|i\s+(?:start|leave|depart)\s+from)\s+(.+)/iu.exec(transcript.trim());
  const leading = /^(?:à|a|au|aux|at|from)\s+(.+)/iu.exec(transcript.trim());
  const rest = introduced?.[1] ?? leading?.[1];
  if (!rest) return;
  const origin = rest.split(/[,;.!?]?\s+(?:(?:et|and)\s+)?(?=(?:je\b|j['’]|i\b|i['’]m\b|my\b|mon\b|ma\b|mes\b|want\b|need\b|going\b|destination\b|avec\b|with\b))|\s+(?:pour\s+(?:aller|rejoindre|me rendre)\b|vers\b|to\b|en direction de\b)/iu)[0]!.replace(/[,;.!?\s]+$/, '').trim();
  if (!origin || /[?\[\]]/.test(origin) || /^\d{1,2}(?:[:h]\d{0,2})?(?:\s*(?:heures?|am|pm))?$/iu.test(origin) || /^(?:quelle?|quel|what|which|home|here|ici|ailleurs|somewhere|position gps)\b/iu.test(origin) || !/\p{L}/u.test(origin) || origin.length > 200) return;
  return origin;
}
