import { describe, expect, it } from 'vitest';
import { statedOrigin } from './stated-origin.js';

describe('explicit pickup clauses', () => {
  it.each([
    ['Je suis à La Défense, je veux aller à Bercy', 'La Défense'],
    ['Je pars de La Défense pour aller à Bercy.', 'La Défense'],
    ['I am at La Défense and want to go to Bercy.', 'La Défense'],
    ['À La Défense, je voudrais aller à Bercy.', 'La Défense'],
    ["I'm at Châtelet, I need a taxi to Bercy", 'Châtelet'],
    ['From Gare de Lyon to Bercy', 'Gare de Lyon'],
    ['Je suis au 12 rue de la Paix, Paris, je veux aller à Bercy', '12 rue de la Paix, Paris'],
    ['I am at 5 Rue Bercy, Paris with my guide dog', '5 Rue Bercy, Paris'],
    ['Non, je pars de Châtelet vers Bercy', 'Châtelet'],
    ['Je suis à Étoile mon avion part dans deux heures', 'Étoile'],
  ])('retains the stated place in %s', (text, origin) => expect(statedOrigin(text)).toBe(origin));

  it.each(['', 'Je veux aller à Bercy', 'I want to go to La Défense', 'Je ne suis pas à La Défense', 'I am not at La Défense', 'Je suis à', 'At what time is pickup?', 'Je suis ici', 'Je suis à [position GPS]', 'Je suis à 10h'])('does not invent a pickup from %s', (text) => expect(statedOrigin(text)).toBeUndefined());
});
