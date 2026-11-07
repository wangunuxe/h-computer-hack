import type { TurnInput, TurnResult } from './converse.js';
import { fallbackQuestion } from './questions.js';
import { say } from './narrate.js';
import { matchesPresetRoute } from './options.js';

const words = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const request = /^(?:(?:please|bonjour|oui|yes) )?(?:(?:je veux|je voudrais|je souhaite|je prends|i want|i need|call me|book me|(?:can|could|would) you (?:please )?(?:call|book|order|reserve)(?: me)?|(?:pouvez|pourriez|peux) (?:vous|tu) (?:m |me )?(?:appeler|reserver|commander)) )?(?:(?:un|une|le|la|a|an|the) )?(?:taxi(?: vers l aeroport)?|airport taxi|cab|navette|shuttle|paris airport shuttle)(?: (?:s il vous plait|s il te plait|please|merci|thanks))?$/;
export function requestsTaxi(text: string): boolean { return request.test(words(text)); }
export function mentionsTaxiRequest(text: string): boolean {
  const value = words(text);
  return requestsTaxi(text) || /\b(?:taxi|cab|navette|shuttle)\b/.test(value) && /\b(?:je veux|je voudrais|je souhaite|i want|i need|call|book|order|reserve|appeler|reserver|commander)\b/.test(value) && !/\b(?:do not|don t|ne.{0,30}pas)\b/.test(value);
}

export function refusesTaxi(text: string): boolean {
  const value = words(text);
  return /\b(?:cannot|can t|can not|unable to|not able to|ne peux pas|ne peut pas|ne pouvons pas|pas en mesure de|impossible de)\b.{0,80}\b(?:book|call|reserve|arrange|reserver|appeler|commander)\b/.test(value) ||
    /\b(?:taxis?|cabs?|shuttles?|navettes?)\b.{0,80}\b(?:cannot|can t|impossible|not possible|pas possible)\b/.test(value) ||
    /\b(?:ask station staff|ask staff|demandez.{0,30}agents|call.{0,30}yourself|appelez.{0,30}vous meme)\b.{0,80}\b(?:taxi|cab|shuttle|navette)\b/.test(value);
}

type TaxiContext = Pick<TurnInput, 'transcript' | 'stage' | 'language' | 'trip' | 'options' | 'now' | 'attempt'>;
export function taxiTurn(input: TaxiContext, result: TurnResult): TurnResult {
  const requested = requestsTaxi(input.transcript);
  const mentioned = mentionsTaxiRequest(input.transcript);
  if (!requested && !refusesTaxi(result.reply) && !(mentioned && result.intent === 'unclear')) return result;
  const fr = input.language.startsWith('fr');
  const capability = fr ? 'Je peux réserver un taxi, avec votre confirmation puis votre paiement.' : 'I can book a taxi, with your confirmation and then your own payment.';
  const patch = ['provide_info', 'correct'].includes(result.intent) && result.confidence >= .65 ? result.trip_patch : undefined;
  const trip = { ...input.trip, ...patch };
  const missing = (['origin', 'destination'] as const).filter((key) => !trip[key]);
  let reply = capability;
  if (missing.length) reply += ' ' + fallbackQuestion({ ...input, stage: 'CLARIFY', missing });
  else if (patch && Object.keys(patch).length) reply += fr ? ' Je vérifie les options pour ce trajet.' : ' I will check the options for this trip.';
  else if (input.stage === 'CONFIRM') reply += fr ? ' Approuvez-vous les détails de prise en charge annoncés ? Dites oui ou non.' : ' Do you approve the pickup details just given? Say yes or no.';
  else if (['HANDOFF', 'AWAIT_PAYMENT'].includes(input.stage)) reply = fr ? 'Votre taxi attend votre paiement. Ouvrez le lien de paiement sur votre appareil ; je ne paie pas à votre place.' : 'Your taxi is awaiting your payment. Open the payment link on your device; I do not pay for you.';
  else if (['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(input.stage)) reply += fr ? ' Je travaille toujours sur votre demande.' : ' I am still working on your request.';
  else if (mentioned && !requested) reply = say('no-known-options', {}, input.language);
  else {
    const taxi = input.options.find((option) => option.id === 'paris-airport-shuttle');
    if (taxi && requested) return { intent: 'choose', option_id: taxi.id, reply: capability, confidence: 1 };
    if (taxi) reply += fr ? ' Souhaitez-vous choisir le taxi proposé ?' : ' Would you like the offered airport taxi?';
    else if (trip.origin && trip.destination && !matchesPresetRoute({ origin: trip.origin, destination: trip.destination })) reply = say('no-known-options', {}, input.language);
    else reply += ' ' + fallbackQuestion({ ...input, stage: 'CHOOSE', missing, options: [] });
  }
  return patch && Object.keys(patch).length ? { ...result, reply } : { intent: 'question', reply, confidence: 1 };
}
