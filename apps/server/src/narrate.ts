import type { Option } from '@voila/shared';

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
  };
  return templates[key](params);
}
