import type { Option } from '@voila/shared';
import type { BookingPage } from './booking.js';

type Empty = Record<string, never>;
export interface NarrationParams {
  acknowledgement: Empty;
  'clarify-deadline': Empty;
  'research-started': Empty;
  disruption: { cause: string; recorded: boolean };
  'present-options': { options: readonly Option[]; now: Date };
  'still-working': Empty;
  confirm: { summary: string };
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
  'no-feasible-options': { rejected: { name: string; reason: 'too_late' | 'guide_dog_refused' }[] };
}

export function say<K extends keyof NarrationParams>(key: K, params: NarrationParams[K], language: string): string {
  const fr = language.toLowerCase().split('-')[0] === 'fr';
  const locale = fr ? 'fr-FR' : 'en-GB';
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
  const templates: { [P in keyof NarrationParams]: (p: NarrationParams[P]) => string } = {
    acknowledgement: () => fr ? 'Je vous aide à rejoindre l’aéroport.' : 'I’ll help you reach the airport.',
    'clarify-deadline': () => fr ? 'À quelle heure ferme l’enregistrement ?' : 'What time does check-in close?',
    'research-started': () => fr ? 'Je vérifie le trafic et les alternatives.' : 'I’m checking traffic and alternatives.',
    disruption: ({ cause, recorded }) => `${recorded ? (fr ? 'Données de démonstration enregistrées. ' : 'Recorded demo information. ') : ''}${cause}`,
    'present-options': ({ options, now }) => {
      if (!options.length) return fr ? 'Aucune option réalisable pour cet horaire.' : 'No feasible options for this deadline.';
      return options.slice(0, 3).map((option, index) => {
        const arrival = new Date(now.getTime() + (option.pickup_wait_minutes + option.journey_minutes) * 60_000);
        const time = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(arrival);
        return `${index + 1}. ${option.name}, ${fr ? 'arrivée estimée' : 'estimated arrival'} ${time}, ${money(option.price)}.`;
      }).join(' ');
    },
    'still-working': () => fr ? 'Je continue, un instant.' : 'Still working. One moment.',
    confirm: ({ summary }) => fr ? `${summary} Confirmez-vous cette réservation ?` : `${summary} Shall I make this booking?`,
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
    'no-feasible-options': ({ rejected }) => [fr ? 'Aucune option réalisable.' : 'No feasible options.', ...rejected.map(({ name, reason }) => `${name}: ${reason === 'too_late' ? (fr ? 'arrivée trop tardive' : 'arrival too late') : (fr ? 'chien guide refusé' : 'guide dog refused')}.`)].join(' '),
  };
  return templates[key](params);
}
