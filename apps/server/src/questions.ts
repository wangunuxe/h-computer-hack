import type { Option, ServerEvent } from '@voila/shared';
import { say } from './narrate.js';

export function fallbackQuestion({ stage, language, missing, options, now, attempt, variant = 0 }: {
  stage: Extract<ServerEvent, { type: 'stage' }>['stage']; language: string; missing: string[]; options: Option[]; now: Date; attempt: number; variant?: number;
}): string {
  const fr = language === 'fr', index = (attempt + variant) % 3;
  if (stage === 'CLARIFY' || stage === 'UNDERSTAND') {
    const names: Record<string, string> = fr ? { origin: 'votre lieu de départ', destination: 'votre destination', deadline: 'votre heure limite d’arrivée' } : { origin: 'your starting point', destination: 'your destination', deadline: 'your arrival cutoff' };
    const fields = missing.map((key) => names[key]).join(fr ? ' et ' : ' and ');
    const questions = fr ? [`Pouvez-vous préciser ${fields} ?`, `Il me manque ${fields}. Que pouvez-vous m’indiquer ?`, `Pour organiser le trajet, dites-moi ${fields}.`] : [`Could you provide ${fields}?`, `I still need ${fields}. What can you tell me?`, `To plan the journey, please tell me ${fields}.`];
    if (attempt < 2) return questions[index]!;
    return fr ? [`Il me manque ${fields}. Par exemple : gare du Nord, CDG, arrivée demain avant 10 heures.`, `Essayons avec un exemple : gare du Nord vers CDG, avant 10 heures demain. Quels sont ${fields} ?`, `Pour avancer, précisez ${fields}, comme dans « gare du Nord, CDG, demain avant 10 heures ».`][index]! : [`I still need ${fields}. For example: Gare du Nord to CDG, arriving before 10 tomorrow.`, `Try an example: Gare du Nord, CDG, before 10 tomorrow. What are ${fields}?`, `To continue, tell me ${fields}, as in “Gare du Nord, CDG, before 10 tomorrow”.`][index]!;
  }
  if (stage === 'CHOOSE') {
    if (!options.length) return fr ? ['Aucun trajet disponible. Souhaitez-vous modifier la destination ou l’heure limite ?', 'Je n’ai pas de trajet adapté. Pouvez-vous proposer une autre destination ou un autre horaire ?', 'Pour chercher autrement, dites par exemple « plutôt CDG demain ». Que souhaitez-vous modifier ?'][index]! : ['No journeys are available. Would you like to change the destination or cutoff?', 'I have no suitable journey. Could you suggest another destination or time?', 'To try another search, say for example “CDG tomorrow instead”. What would you like to change?'][index]!;
    if (attempt < 2) return fr ? ['Quel trajet choisissez-vous ? Dites son numéro ou son nom.', 'Quelle option préférez-vous parmi les trajets proposés ?', 'Indiquez le numéro du trajet qui vous convient.'][index]! : ['Which journey would you like? Say its number or name.', 'Which of the offered options do you prefer?', 'Tell me the number of the journey you want.'][index]!;
    const numbered = options.length ? say('present-options', { options, now }, language) : (fr ? 'Aucun trajet disponible pour le moment.' : 'No journeys are available right now.');
    return fr ? [`Reprenons les choix numérotés. ${numbered} Quel numéro préférez-vous ?`, `Vous pouvez utiliser les boutons à l’écran. Voici les choix : ${numbered}`, `Dites par exemple « le moins cher », ou le numéro d’un trajet. ${numbered}`][index]! : [`Let’s read the numbered choices again. ${numbered} Which number do you prefer?`, `You can use the on-screen buttons. Here are the choices: ${numbered}`, `For example, say “the cheapest” or a journey number. ${numbered}`][index]!;
  }
  if (stage === 'CONFIRM') {
    if (attempt < 2) return fr ? ['Dites oui pour confirmer, ou non pour modifier.', 'Souhaitez-vous approuver cette réservation, oui ou non ?', 'Puis-je confirmer ce trajet ? Un oui ou un non suffit.'][index]! : ['Please say yes to approve, or no to decline.', 'Would you like to approve this booking, yes or no?', 'May I confirm this journey? A yes or no is enough.'][index]!;
    return fr ? ['Sans accord clair, je ne réserve pas. Utilisez les boutons Oui ou Non à l’écran.', 'Pour continuer, appuyez sur Oui pour réserver ou Non pour modifier.', 'La réservation attend votre décision. Les boutons Oui et Non peuvent vous aider.'][index]! : ['I will not book without clear approval. Use the on-screen Yes or No buttons.', 'To continue, press Yes to book or No to make changes.', 'The booking is waiting for your decision. The Yes and No buttons may help.'][index]!;
  }
  return fr ? ['Votre demande est toujours en cours. Vous pouvez dire arrêter.', 'Je poursuis votre demande. Dites arrêter si vous voulez annuler.', 'Le traitement continue ; vous pouvez me demander d’arrêter.'][index]! : ['Your request is still in progress. You can say stop.', 'I am continuing your request. Say stop if you want to cancel.', 'Processing is continuing; you can ask me to stop.'][index]!;
}
