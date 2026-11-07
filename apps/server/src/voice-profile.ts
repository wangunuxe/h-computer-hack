import { ProfileSchema, type TravelerProfile } from '@voila/shared';

const normal = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’-]/g, ' ').replace(/[.,!?;:()]/g, ' ').replace(/\s+/g, ' ').trim();
const french = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const english = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
function frNumber(n: number): string {
  if (n < 17) return french[n]!;
  if (n < 20) return `dix ${french[n - 10]}`;
  if (n < 70) return `${['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'][Math.floor(n / 10)]}${n % 10 === 1 ? ' et un' : n % 10 ? ` ${french[n % 10]}` : ''}`;
  if (n < 80) return `soixante${n === 71 ? ' et' : ''} ${frNumber(n - 60)}`;
  return `quatre vingt${n === 80 ? '' : ` ${frNumber(n - 80)}`}`;
}
const numbers = new Map<string, string>([['une', '1'], ['oh', '0'], ['o', '0'], ['nought', '0']]);
for (let n = 0; n < 100; n++) {
  const fr = frNumber(n); numbers.set(fr, String(n)); numbers.set(fr.replace(' et ', ' '), String(n));
  numbers.set(n < 20 ? english[n]! : `${['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10)]}${n % 10 ? ` ${english[n % 10]}` : ''}`, String(n));
}
function phoneDigits(text: string): { digits: string; international: boolean } | undefined {
  let value = normal(text).replace(/\bvingts\b/g, 'vingt');
  const international = value.startsWith('+') || value.startsWith('plus ');
  value = value.replace(/^(?:\+|plus\s+)/, '').trim();
  const tokens = value.split(' '); let digits = '';
  for (let i = 0; i < tokens.length;) {
    let repeat = 1;
    if (tokens[i] === 'double' || tokens[i] === 'triple') { repeat = tokens[i] === 'double' ? 2 : 3; i++; }
    let part: string | undefined, count = 1;
    if (/^\d+$/.test(tokens[i] ?? '')) part = tokens[i];
    else for (let length = Math.min(5, tokens.length - i); length > 0; length--) {
      const found = numbers.get(tokens.slice(i, i + length).join(' '));
      if (found !== undefined) { part = found; count = length; break; }
    }
    if (part === undefined || (repeat > 1 && part.length !== 1)) return;
    digits += part.repeat(repeat); i += count;
  }
  return { digits, international };
}
export function parsePhone(text: string): string | undefined {
  const value = phoneDigits(normal(text).replace(/^(?:(?:mon )?(?:numero(?: de telephone)?|telephone)(?: est| c est)?|(?:my )?(?:phone(?: number)?|number)(?: is)?|c est|it is)\s+/, ''));
  if (!value) return;
  const { digits, international } = value;
  if (!international && digits.startsWith('00')) return digits.length >= 10 && digits.length <= 17 ? '+' + digits.slice(2) : undefined;
  if (international) return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : undefined;
  return /^\d{10}$/.test(digits) ? digits : undefined;
}
export function parseEmail(text: string): string | undefined {
  const value = text.trim().toLowerCase().replace(/^(?:(?:mon )?(?:adresse (?:e[ -]?mail|mail)|e[ -]?mail|mail)(?: est)?|(?:my )?(?:email(?: address)?)(?: is)?|c['’]est|it is)\s+/i, '')
    .replace(/\b(?:tiret bas|underscore|souligne)\b/g, '_').replace(/\b(?:arobase|at)\b/g, '@').replace(/\b(?:point|dot)\b/g, '.').replace(/\b(?:tiret|dash|hyphen)\b/g, '-').replace(/\s+/g, '').replace(/[.,!?]+$/, '');
  return ProfileSchema.shape.email.safeParse(value).success ? value : undefined;
}
export function forgetDetails(text: string): boolean {
  return /^(?:please )?(?:efface mes informations|oublie mes informations|forget my details|delete my details)(?: s il vous plait| please)?$/.test(normal(text));
}
export function redactContactText(text: string, profile?: TravelerProfile): string {
  let safe = text.replace(/\b(je m['’]appelle|mon nom (?:est|c['’]est)|my name is|i['’]m|i am|call me)\s+(?:(?:dr|m|mme|mr|mrs|ms|monsieur|madame|mademoiselle)\.?\s+)*(?!(?:on|at|in|from|to|going|travelling|traveling|with|without|blind|late|lost|looking|trying|ready|not|le|la|les|un|une|bien|bon|à|a|en|dans|au|aux|avec|sans|gare|airport|station|terminal|CDG|Orly|Paris)\b)[\p{L}\p{M}'’-]+(?:[ \t]+[\p{L}\p{M}'’-]+)*?(?=[,;.!?]|\s+(?:(?:et|and|avec|with|pour|for|from|at|to|depuis|vers|take|emmenez|amenez)\b|je (?:suis|vais|dois|pars|veux)\b|j['’]ai\b|i (?:am|need|want|have)\b|i['’]m\b|à\s)|$)/giu, '$1 [name]');
  for (const value of [profile?.name, profile?.phone, profile?.email]) if (value) safe = safe.replace(new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '[contact]');
  safe = safe.replace(/[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b[\p{L}\d_+-]+(?:(?:\.|\s+(?:point|dot|tiret bas|tiret|dash|underscore)\s+)[\p{L}\d_+-]+)*\s*(?:@|\b(?:arobase|at)\b)\s*[\p{L}\d-]+(?:(?:\s*\.\s*|\s+(?:point|dot)\s+)[\p{L}\d-]+)+\b/giu, (value) => parseEmail(value) ? '[email]' : value);
  let result = '', cursor = 0;
  for (const match of safe.matchAll(contactSpan)) {
    const offset = match.index!;
    if (offset < cursor) continue;
    let value = match[0], joined = false;
    const groups = match.groups!;
    const introduced = /\b(?:call me(?: on| at)?|reach me(?: on| at)?|(?:my )?(?:phone(?: number)?|number)(?: is| s)?|(?:mon )?(?:numero(?: de telephone)?|telephone)(?: est| c est)?|(?:appelez|contactez)(?: moi)?(?: au)?)$/.test(normal(safe.slice(0, offset)));
    const commaRun = introduced ? commaPhoneSpan.exec(safe.slice(offset))?.[0] : undefined;
    if (commaRun) {
      const fragments = commaRun.split(',');
      if (/^[ \t]+(?:personnes?|passagers?|passengers?|people|bags?|bagages?|valises?)\b/iu.test(safe.slice(offset + commaRun.length))) fragments.pop();
      value = '';
      for (const fragment of fragments) {
        if (temporalFragment.test(fragment.trim())) break;
        const candidate = value + (value ? ',' : '') + fragment;
        const current = phoneDigits(candidate);
        const limit = current && (current.international || current.digits.startsWith('00')) ? 15 : 10;
        if (!current || current.digits.length > limit) break;
        value = candidate;
      }
      joined = !!phoneDigits(value);
    }
    const digits = groups.spoken ? phoneDigits(value)?.digits : undefined;
    const redact = groups.phone || joined || (digits && ((/\p{L}/u.test(value) && digits.length >= 9) || introduced));
    result += safe.slice(cursor, offset) + (redact ? '[phone]' : value); cursor = offset + value.length;
  }
  return result + safe.slice(cursor);
}
const dateSpan = /(?<![\p{L}\d])(?<!\d[./:-])(?:\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.]\d{4})(?!\d|[./:-]\d)/gu;
const timeSpan = /(?<![\p{L}\d])(?<!\d[./:-])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?!\d|[./:-]\d)/gu;
const numberWords = [...numbers.keys(), 'plus', 'double', 'triple'].sort((a, b) => b.length - a.length).map((word) => word.replace(/zero/g, 'z[eé]ro').replace(/ /g, '[ \\t-]+')).join('|');
const separator = '(?:[ \\t]+|[.:-](?!\\s))?';
const internationalSeparator = '(?:[ \\t]+|[.-](?!\\s))?';
const temporalToken = `(?:${dateSpan.source}|\\d{1,2}[:h]\\d{2})`;
const temporalFragment = new RegExp(`^${temporalToken}`, 'iu');
const internationalDigit = `(?!${temporalToken})\\d`;
const numericPhone = `(?<![\\p{L}\\d])(?:\\+${internationalDigit}(?:${internationalSeparator}${internationalDigit}){7,14}|(?:\\+33|0033)${separator}\\(?[1-9]\\)?(?:${separator}\\d){8}|0${separator}[1-9](?:${separator}\\d){8}|\\d{10})(?![\\p{L}\\d])`;
const spokenToken = `(?:\\d{1,2}(?!\\d)|${numberWords})`;
const spokenRun = `${spokenToken}(?:(?:[ \\t:-]+|\\.(?!\\s))${spokenToken})*`;
const spokenPhoneSpan = `(?<![\\p{L}\\d])\\+?${spokenRun}(?![\\p{L}\\d])`;
const commaPhoneSpan = new RegExp(`^\\+?${spokenRun}(?:,[ \\t]*${spokenRun})+(?![\\p{L}\\d])`, 'iu');
const contactSpan = new RegExp(`(?<date>${dateSpan.source})|(?<beforePhone>${timeSpan.source})(?=[ \\t]+${numericPhone})|(?<phone>${numericPhone})|(?<time>${timeSpan.source})|(?<spoken>${spokenPhoneSpan})`, 'giu');
type Field = 'name' | 'phone' | 'email' | 'guide_dog';
const yes = (text: string) => /^(oui|yes|correct|exactement|c est correct|c est ca|oui c est ca|c est bon|that s right)$/.test(normal(text));
const no = (text: string) => /^(non|no|non merci|no thanks)$/.test(normal(text));
export class VoiceProfile {
  private candidate?: string | boolean;
  constructor(public profile: TravelerProfile, private required: Field[]) {}
  get field() { return this.required.find((field) => this.profile[field] === undefined); }
  get question(): string {
    if (this.candidate !== undefined) return this.readback();
    const fr = this.profile.language.startsWith('fr');
    return this.field ? ({ name: fr ? 'Pour réserver, quel est votre nom ?' : 'For the booking, what is your name?', phone: fr ? 'Quel est votre numéro de téléphone ?' : 'What is your phone number?', email: fr ? 'Quelle est votre adresse e-mail ? Dites arobase et point.' : 'What is your email address? Say at and dot.', guide_dog: fr ? 'Voyagez-vous avec un chien guide ? Dites oui ou non.' : 'Are you travelling with a guide dog? Say yes or no.' })[this.field] : fr ? 'Merci. Je prépare votre trajet.' : 'Thank you. I’m preparing your trip.';
  }
  private parse(text: string): string | boolean | undefined {
    if (this.field === 'phone') return parsePhone(text);
    if (this.field === 'email') return parseEmail(text);
    if (this.field === 'guide_dog') return yes(text) || /^(oui|yes)\b/.test(normal(text)) ? true : no(text) || /^(non|no)\b/.test(normal(text)) ? false : undefined;
    const name = text.replace(/^(?:je m['’]appelle|mon nom (?:est|c['’]est)|my name is|c['’]est)\s+/i, '').replace(/[.!?,]+$/, '').trim();
    return !yes(name) && !no(name) && /^[\p{L}\p{M}][\p{L}\p{M} '\u2019-]{0,79}$/u.test(name) ? name : undefined;
  }
  private readback() {
    const fr = this.profile.language.startsWith('fr');
    const digitNames = fr ? french.slice(0, 10) : english.slice(0, 10);
    const value = this.field === 'phone' ? String(this.candidate).split('').map((digit) => digit === '+' ? 'plus' : digitNames[Number(digit)]).join(', ') : this.field === 'email' ? String(this.candidate).replace(/@/g, fr ? ' arobase ' : ' at ').replace(/\./g, fr ? ' point ' : ' dot ') : typeof this.candidate === 'boolean' ? this.candidate ? (fr ? 'avec un chien guide' : 'with a guide dog') : (fr ? 'sans chien guide' : 'without a guide dog') : this.candidate;
    return `${value}. ${fr ? 'Est-ce correct ? Dites oui pour confirmer ou non pour corriger.' : 'Is that correct? Say yes to confirm or no to correct.'}`;
  }
  reply(text: string): { text: string; changed: boolean; complete: boolean } {
    if (this.candidate !== undefined && yes(text)) {
      this.profile = { ...this.profile, [this.field!]: this.candidate }; this.candidate = undefined;
      return { text: this.question, changed: true, complete: !this.field };
    }
    if (this.candidate !== undefined && no(text)) { this.candidate = undefined; return { text: this.question, changed: false, complete: false }; }
    const value = this.parse(text.replace(/^(?:non|no)[, ]+(?:c['’]est |it is )?/i, ''));
    if (value !== undefined) this.candidate = value;
    return { text: value !== undefined ? this.readback() : this.question, changed: false, complete: false };
  }
}
