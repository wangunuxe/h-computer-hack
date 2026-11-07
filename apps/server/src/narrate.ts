import type { Option, Trip } from '@voila/shared';
import type { BookingPage } from './booking.js';

type Empty = Record<string, never>;
const optionNames: Record<string, { fr: string; en: string }> = {
  'gare-du-nord-taxi': { fr: 'Taxi de la gare du Nord', en: 'Gare du Nord taxi rank' },
  'g7-phone': { fr: 'Taxi G7 par téléphone', en: 'G7 by phone' },
  'paris-airport-shuttle': { fr: 'Navette Paris Airport Shuttle', en: 'Paris Airport Shuttle' },
  'rer-b-replacement-bus': { fr: 'Bus de remplacement du RER B', en: 'RER B replacement bus' },
};
export interface NarrationParams {
  acknowledgement: Empty;
  'clarify-deadline': Empty;
  'research-started': Empty;
  disruption: { cause: string; recorded: boolean; mode?: 'demo' | 'live-prim' | 'live-h'; status?: 'normal' | 'disrupted' | 'unknown' };
  'present-options': { options: readonly Option[]; now: Date };
  'still-working': Empty;
  confirm: { trip: Trip; option: Option; summary: string; now: Date };
  'payment-handoff': { merchant: string; amount: number };
  'booking-done': { ref: string };
  stopped: Empty;
  'booking-failed': { reason?: string };
  'clarify-origin': Empty;
  'clarify-destination': Empty;
  'choose-again': Empty;
  'confirm-again': Empty;
  'booking-page': { page: BookingPage };
  'manual-instructions': { id: string; instructions: string };
  'no-feasible-options': { rejected: { id?: string; name: string; reason: 'too_late' | 'guide_dog_refused' }[] };
  'no-known-options': Empty;
}

function confirmationDetails(summary: string) {
  const text = summary.replace(/[*_`#]/g, '');
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\s*[-•]\s*/, '').trim());
  const pickupLines = lines.filter((line) => /^(?:pickup\b|pick-up\b|prise en charge\b|time\s*:|heure\b|date\s*:.*\b(?:time|heure)\s*:)/i.test(line));
  const pickup = pickupLines.map((line) => line.split(/\b(?:flight|vol)\b/i)[0]).join('\n');
  const iso = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/.exec(pickup)?.[0];
  const instant = iso ? new Date(iso) : undefined;
  let date = /\b\d{4}-\d{2}-\d{2}\b/.exec(pickup)?.[0];
  const labelledTime = /\b(\d{1,2})\s*(?::(\d{2})|h(?:\s*(\d{2}))?)(?!\d)/i.exec(pickup.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/g, ''));
  let hour = labelledTime ? Number(labelledTime[1]) : undefined;
  let minute = labelledTime ? Number(labelledTime[2] ?? labelledTime[3] ?? 0) : undefined;
  if (!labelledTime && instant && Number.isFinite(instant.getTime())) {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    hour = Number(parts.find((p) => p.type === 'hour')!.value);
    minute = Number(parts.find((p) => p.type === 'minute')!.value);
  }
  if (date) {
    const value = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) date = undefined;
  }
  if (hour === undefined || hour > 23 || minute === undefined || minute > 59) { hour = undefined; minute = undefined; }
  const currency = /(?:EUR\b|€)\s*(\d+(?:[.,]\d{1,2})?)(?![\d.,])|(?<![\d.,+-])(\d+(?:[.,]\d{1,2})?)\s*(?:EUR\b|€)/gi;
  const priceLines = lines.filter((line) => /^(?:total|prix|price|montant)\b/i.test(line) || pickupLines.includes(line)).join('\n');
  const total = /\b(?:total|prix|price|montant)\s*:?\s*((?:EUR\b|€)\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:EUR\b|€))/i.exec(priceLines)?.[1];
  const amounts = [...new Set([...(total ?? '').matchAll(currency)].map((match) => Number((match[1] ?? match[2])!.replace(',', '.'))))];
  const price = amounts.length === 1 && Number.isFinite(amounts[0]) ? amounts[0] : undefined;
  return { date, hour, minute, price };
}

export function say<K extends keyof NarrationParams>(key: K, params: NarrationParams[K], language: string): string {
  const fr = language.toLowerCase().split('-')[0] === 'fr';
  const locale = fr ? 'fr-FR' : 'en-GB';
  const optionName = (option: { id?: string; name: string }) => (option.id ? optionNames[option.id]?.[fr ? 'fr' : 'en'] : undefined) ?? option.name;
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
  const templates: { [P in keyof NarrationParams]: (p: NarrationParams[P]) => string } = {
    acknowledgement: () => fr ? 'Je vous aide à rejoindre l’aéroport.' : 'I’ll help you reach the airport.',
    'clarify-deadline': () => fr ? 'À quelle heure ferme l’enregistrement ?' : 'What time does check-in close?',
    'research-started': () => fr ? 'Je vérifie le trafic et les alternatives.' : 'I’m checking traffic and alternatives.',
    disruption: ({ cause, recorded, mode, status }) => {
      const origin = mode === 'demo' ? (fr ? 'Mode démonstration. ' : 'Demo mode. ') : mode === 'live-prim' ? (fr ? 'Trafic en direct, source PRIM. ' : 'Live traffic, PRIM source. ') : mode === 'live-h' ? (status === 'unknown' ? (fr ? 'Mode direct. Vérifications PRIM et H indisponibles. ' : 'Live mode. PRIM and H checks unavailable. ') : (fr ? 'Trafic en direct, pages officielles lues par H. ' : 'Live traffic, official pages read by H. ')) : '';
      const body = status === 'normal' ? (fr ? 'Le RER B circule normalement. Je vous propose aussi des alternatives.' : 'The RER B is running normally. I’ll still offer alternatives.') : status === 'unknown' ? (fr ? 'Je ne peux pas vérifier l’état du RER B. Statut inconnu. Voici les alternatives.' : 'I can’t verify the RER B status. Its status is unknown. Here are the alternatives.') : cause;
      return `${origin}${recorded ? (fr ? 'Données enregistrées, pas en direct : ' : 'Recorded data, not live: ') : ''}${body}`;
    },
    'present-options': ({ options, now }) => {
      if (!options.length) return fr ? 'Aucune option réalisable pour cet horaire.' : 'No feasible options for this deadline.';
      return options.slice(0, 3).map((option, index) => {
        const arrival = new Date(now.getTime() + (option.pickup_wait_minutes + option.journey_minutes) * 60_000);
        const time = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(arrival);
        return `${index + 1}. ${optionName(option)}, ${fr ? 'arrivée estimée' : 'estimated arrival'} ${time}, ${money(option.price)}.`;
      }).join(' ');
    },
    'still-working': () => fr ? 'Je continue, un instant.' : 'Still working. One moment.',
    confirm: ({ trip, option, summary, now }) => {
      const { date, hour, minute, price } = confirmationDetails(summary);
      const parts = [`${optionName(option)}, ${fr ? 'vers' : 'to'} ${trip.destination}`];
      if (hour !== undefined && minute !== undefined) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        const day = !date ? '' : date === today ? (fr ? 'aujourd’hui ' : 'today ') : date === tomorrow ? (fr ? 'demain ' : 'tomorrow ') :
          `${fr ? 'le ' : 'on '}${new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))} `;
        parts.push(fr ? `${day}à ${hour} h${minute ? ` ${minute.toString().padStart(2, '0')}` : ''}` : `${day}at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
      }
      if (price !== undefined) parts.push(new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price));
      if (trip.guide_dog) parts.push(fr ? 'avec votre chien guide' : 'with your guide dog');
      return `${parts.join(', ')}. ${fr ? 'Je confirme ?' : 'Shall I confirm?'}`;
    },
    'payment-handoff': ({ merchant, amount }) => fr ? `${money(amount)} chez ${merchant}. Ouvrez le paiement sur votre téléphone.` : `${money(amount)} with ${merchant}. Open payment on your phone.`,
    'booking-done': ({ ref }) => fr ? `Réservation ${ref}. Voici votre fiche.` : `Booking ${ref}. Here are your details.`,
    stopped: () => fr ? 'J’arrête. Aucune autre action.' : 'Stopped. No further actions.',
    'booking-failed': ({ reason }) => `${fr ? 'La réservation a échoué.' : 'Booking failed.'}${reason ? ` ${reason}` : ''}`,
    'clarify-origin': () => fr ? 'Où êtes-vous actuellement ?' : 'Where are you now?',
    'clarify-destination': () => fr ? 'Quel aéroport et quel terminal ?' : 'Which airport and terminal?',
    'choose-again': () => fr ? 'Quelle option choisissez-vous ? Dites son numéro ou son nom.' : 'Which option? Say its number or name.',
    'confirm-again': () => fr ? 'Confirmez par oui, ou refusez par non.' : 'Please say yes to approve, or no to decline.',
    'booking-page': ({ page }) => ({
      route: fr ? 'Je remplis l’itinéraire.' : 'I’m filling in the route.',
      vehicle: fr ? 'Je choisis le véhicule.' : 'I’m choosing the vehicle.',
      info: fr ? 'Je remplis vos coordonnées.' : 'I’m filling in your contact details.',
      payment: fr ? 'La réservation est prête pour le paiement.' : 'The booking is ready for payment.',
    })[page],
    'manual-instructions': ({ id, instructions }) => fr ? (({
      'gare-du-nord-taxi': 'Rejoignez la station officielle de taxis de Gare du Nord. Demandez de l’aide pour la file, signalez le chien guide et confirmez le tarif.',
      'g7-phone': 'Appelez G7 au 3607. Indiquez le point de départ, le terminal, les passagers et le chien guide. Confirmez la disponibilité et le tarif.',
      'rer-b-replacement-bus': 'Demandez aux agents si un bus de remplacement dessert CDG et où monter. Confirmez le terminal, l’accessibilité et le départ.',
    } as Record<string, string>)[id] ?? instructions) : instructions,
    'no-feasible-options': ({ rejected }) => [fr ? 'Aucune option réalisable.' : 'No feasible options.', ...rejected.map((option) => `${optionName(option)}: ${option.reason === 'too_late' ? (fr ? 'arrivée trop tardive' : 'arrival too late') : (fr ? 'chien guide refusé' : 'guide dog refused')}.`)].join(' '),
    'no-known-options': () => fr ? 'Je ne connais pas d’option pour ce trajet. Demandez de l’aide aux agents de la gare ou appelez un taxi.' : 'No known options for this route. Ask station staff for help or call a taxi.',
  };
  return templates[key](params);
}
