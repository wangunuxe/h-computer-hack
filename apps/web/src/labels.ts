import type { Stage } from './state.js';
export const labels = {
  fr: {
    connectionRetry: 'Connexion impossible, touchez pour réessayer.',
    microphonePermission: 'L’accès au micro est refusé. Autorisez le micro dans les réglages du navigateur.', microphoneMissing: 'Aucun micro détecté. Connectez un micro, puis réessayez.', microphoneCapture: 'La capture audio a été interrompue. Réessayez de parler.', speechUnavailable: 'La connexion au service de transcription a échoué. Réessayez dans un instant.', nothingHeard: 'Je n’ai rien entendu. Appuyez sur le micro, parlez, puis appuyez à nouveau pour terminer.', speechProvider: 'Le service de transcription a rencontré une erreur. Veuillez réessayer.',
    title: 'Voilà — votre trajet, votre voix', welcome: 'Où souhaitez-vous aller ?', tap: 'Appuyez pour parler', listening: 'J’écoute…', stopListening: 'Terminer le message', processing: 'Transcription…', stop: 'Arrêter', yes: 'Confirmer', no: 'Annuler', ready: 'Connecté', connecting: 'Connexion…', disconnected: 'Reconnexion…', error: 'Une erreur est survenue. Veuillez réessayer.',
    options: 'Votre trajet', confirm: 'Confirmer la réservation', payment: 'Payer', booking: 'Trajet réservé', ref: 'Réf.', arrival: 'Arrivée', source: 'Source',
  },
  en: {
    connectionRetry: 'Cannot connect. Tap to retry.',
    microphonePermission: 'Microphone access was denied. Allow microphone access in your browser settings.', microphoneMissing: 'No microphone was found. Connect a microphone and try again.', microphoneCapture: 'Audio capture was interrupted. Please try speaking again.', speechUnavailable: 'Could not connect to the speech service. Please try again shortly.', nothingHeard: 'I didn’t hear anything. Tap the microphone, speak, then tap again to finish.', speechProvider: 'The speech service encountered an error. Please try again.',
    title: 'Voilà — your journey, your voice', welcome: 'Where would you like to go?', tap: 'Tap to speak', listening: 'Listening…', stopListening: 'Finish message', processing: 'Transcribing…', stop: 'Stop', yes: 'Confirm', no: 'Cancel', ready: 'Connected', connecting: 'Connecting…', disconnected: 'Reconnecting…', error: 'Something went wrong. Please try again.',
    options: 'Your route', confirm: 'Confirm booking', payment: 'Pay', booking: 'Journey booked', ref: 'Ref.', arrival: 'Arrival', source: 'Source',
  },
};
export const stages: Record<'fr' | 'en', Record<Stage, string>> = {
  fr: { LISTEN: 'À votre écoute', UNDERSTAND: 'Compréhension de votre demande', CLARIFY: 'Une précision', RESEARCH: 'Recherche des trajets', PRESENT: 'Présentation des options', CHOOSE: 'Choisissez votre trajet', EXECUTE: 'Réservation en cours', CONFIRM: 'Votre confirmation', HANDOFF: 'Paiement sur votre appareil', AWAIT_PAYMENT: 'En attente du paiement', DONE: 'Réservation terminée' },
  en: { LISTEN: 'Ready to listen', UNDERSTAND: 'Understanding your request', CLARIFY: 'One more detail', RESEARCH: 'Finding routes', PRESENT: 'Your travel options', CHOOSE: 'Choose your route', EXECUTE: 'Booking in progress', CONFIRM: 'Your confirmation', HANDOFF: 'Pay on your device', AWAIT_PAYMENT: 'Awaiting payment', DONE: 'Booking complete' },
};
export const optionNames: Record<string, { fr: string; en: string }> = {
  'paris-airport-shuttle': { fr: 'Taxi vers l’aéroport', en: 'Airport taxi' },
  'rer-b-replacement-bus': { fr: 'Bus de remplacement du RER B', en: 'RER B replacement bus' },
};
export function optionLabel(option: { id: string; name: string }, language: 'fr' | 'en'): string {
  const separator = option.name.indexOf(' — ');
  const name = optionNames[option.id]?.[language] ?? (separator < 0 ? option.name : option.name.slice(0, separator));
  return separator < 0 ? name : `${name}, ${language === 'fr' ? 'prise en charge à' : 'pickup at'} ${option.name.slice(separator + 3)}`;
}
