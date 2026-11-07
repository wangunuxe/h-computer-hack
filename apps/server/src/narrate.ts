import type { Option, Trip } from '@voila/shared';
import type { BookingPage } from './booking.js';
import { sanitizeConfirmationFields, type ConfirmationFields } from './confirmation.js';

type Empty = Record<string, never>;
const optionNames: Record<string, { fr: string; en: string }> = {
  'paris-airport-shuttle': { fr: 'Taxi vers l’aéroport', en: 'Airport taxi' },
  'rer-b-replacement-bus': { fr: 'Bus de remplacement du RER B', en: 'RER B replacement bus' },
};
export function spokenOptionName(option: { id?: string; name: string }, language: string): string {
  const locale = language.toLowerCase().split('-')[0] === 'fr' ? 'fr' : 'en';
  const separator = option.name.indexOf(' — ');
  const base = separator < 0 ? option.name : option.name.slice(0, separator);
  const name = option.id === 'paris-airport-shuttle' && base.startsWith('Taxi to ') ? `${locale === 'fr' ? 'Taxi vers' : 'Taxi to'} ${base.slice(8)}` : (option.id ? optionNames[option.id]?.[locale] : undefined) ?? base;
  return separator < 0 ? name : `${name}, ${locale === 'fr' ? 'prise en charge à' : 'pickup at'} ${option.name.slice(separator + 3)}`;
}
export interface NarrationParams {
  acknowledgement: Empty;
  'clarify-deadline': Empty;
  'research-started': Empty;
  disruption: { cause: string; recorded: boolean; mode?: 'demo' | 'live'; status?: 'normal' | 'disrupted' | 'unknown'; origin?: string };
  'traffic-line': { line?: string; mode: 'demo' | 'live'; status: 'normal' | 'disrupted' | 'unknown'; summary: string };
  'present-options': { options: readonly Option[]; now: Date };
  'still-working': Empty;
  confirm: { trip: Trip; option: Option; details?: ConfirmationFields; now: Date };
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

export function say<K extends keyof NarrationParams>(key: K, params: NarrationParams[K], language: string): string {
  const fr = language.toLowerCase().split('-')[0] === 'fr';
  const locale = fr ? 'fr-FR' : 'en-GB';
  const optionName = (option: { id?: string; name: string }) => spokenOptionName(option, language);
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
  const templates: { [P in keyof NarrationParams]: (p: NarrationParams[P]) => string } = {
    acknowledgement: () => fr ? 'Je vous aide à organiser votre trajet.' : 'I’ll help you plan your journey.',
    'clarify-deadline': () => fr ? 'À quelle heure ferme l’enregistrement ?' : 'What time does check-in close?',
    'research-started': () => fr ? 'Je vérifie le trafic et les alternatives.' : 'I’m checking traffic and alternatives.',
    'traffic-line': ({ line, mode, status, summary }) => {
      const label = line ? `${line} : ` : '';
      if (mode === 'demo') return fr ? `Mode démonstration. ${label}Aucune donnée enregistrée pour ${line ? 'cette ligne' : 'les lignes de ce trajet'}. Le trafic est inconnu.` : `Demo mode. ${label}No recorded data for ${line ? 'this line' : 'the lines on this route'}. Traffic is unknown.`;
      if (status === 'unknown') return fr ? `${label}Je n’ai pas pu lire le trafic actuel. Son état est inconnu.` : `${label}I could not read current traffic. Its status is unknown.`;
      return `${label}${summary}`;
    },
    disruption: ({ cause, recorded, mode, status, origin: pickup }) => {
      const origin = mode === 'demo' ? (fr ? 'Mode démonstration. ' : 'Demo mode. ') : mode === 'live' ? (status === 'unknown' ? (fr ? 'Mode direct. Vérification par H indisponible. ' : 'Live mode. H traffic check unavailable. ') : (fr ? 'Trafic en direct, pages officielles lues par H. ' : 'Live traffic, official pages read by H. ')) : '';
      const body = status === 'normal' ? (fr ? 'Le RER B circule normalement. Je vous propose aussi des alternatives.' : 'The RER B is running normally. I’ll still offer alternatives.') : status === 'unknown' ? (fr ? 'Je ne peux pas vérifier l’état du RER B. Statut inconnu. Voici les alternatives.' : 'I can’t verify the RER B status. Its status is unknown. Here are the alternatives.') : cause;
      const route = pickup && status === 'disrupted' ? (fr ? `Le RER B vers l’aéroport est perturbé. Les alternatives partent de ${pickup}.` : `The airport RER B service is disrupted. Alternatives pick up at ${pickup}.`) : body;
      return `${origin}${recorded ? (fr ? 'Données enregistrées, pas en direct : ' : 'Recorded data, not live: ') : ''}${route}`;
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
    confirm: ({ trip, option, details, now }) => {
      const { pickup_date: date, pickup_time: time, total_price: price, currency } = sanitizeConfirmationFields(details);
      const parts = [`${optionName(option)}, ${fr ? 'vers' : 'to'} ${trip.destination}`];
      let when = '';
      if (date) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        when = date === today ? (fr ? 'aujourd’hui' : 'today') : date === tomorrow ? (fr ? 'demain' : 'tomorrow') :
          `${fr ? 'le ' : 'on '}${new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))}`;
      }
      if (time) {
        const [hour, minute] = time.split(':').map(Number);
        when += `${when ? ' ' : ''}${fr ? `à ${hour} h${minute ? ` ${minute.toString().padStart(2, '0')}` : ''}` : `at ${time}`}`;
      }
      if (when) parts.push(when);
      if (price !== undefined && currency === 'EUR') parts.push(new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price));
      if (trip.guide_dog) parts.push(fr ? 'avec votre chien guide' : 'with your guide dog');
      return `${parts.join(', ')}. ${fr ? 'Je confirme ?' : 'Shall I confirm?'}`;
    },
    'payment-handoff': ({ merchant, amount }) => fr ? `${money(amount)} chez ${merchant}. Ouvrez le paiement sur votre téléphone.` : `${money(amount)} with ${merchant}. Open payment on your phone.`,
    'booking-done': ({ ref }) => fr ? `Réservation ${ref}. Voici votre fiche.` : `Booking ${ref}. Here are your details.`,
    stopped: () => fr ? 'J’arrête. Aucune autre action.' : 'Stopped. No further actions.',
    'booking-failed': ({ reason }) => `${fr ? 'Cette tentative de réservation a échoué. Voulez-vous réessayer le taxi ?' : 'This booking attempt failed. Would you like to retry the taxi?'}${reason ? ` ${reason}` : ''}`,
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
      'rer-b-replacement-bus': 'Demandez aux agents si un bus de remplacement dessert CDG et où monter. Confirmez le terminal, l’accessibilité et le départ.',
    } as Record<string, string>)[id] ?? instructions) : instructions,
    'no-feasible-options': ({ rejected }) => [fr ? 'Aucune option réalisable.' : 'No feasible options.', ...rejected.map((option) => `${optionName(option)}: ${option.reason === 'too_late' ? (fr ? 'arrivée trop tardive' : 'arrival too late') : (fr ? 'chien guide refusé' : 'guide dog refused')}.`)].join(' '),
    'no-known-options': () => fr ? 'Je peux réserver un taxi. Quelle est votre destination et d’où partez-vous ?' : 'I can book a taxi. What is your destination and where should the taxi pick you up?',
  };
  return templates[key](params);
}
