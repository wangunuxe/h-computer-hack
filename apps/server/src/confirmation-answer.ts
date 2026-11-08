const filler = /^(?:(?:euh|heu|hum|hmm|um|uh|ben|bah|alors|ah|oh|well) )+|(?: (?:merci|merci beaucoup|s il vous plait|s il te plait|please|thanks|thank you))+$/g;
const yesAnswers = new Set(['oui', 'ouais', 'ouai', 'ouaip', 'we', 'wee', 'si', 'exact', 'exactement', 'correct', 'tout a fait', 'bien sur', 'd accord', 'ok', 'okay', 'ok d accord', 'c est ca', 'c est correct', 'c est bon', 'c est exact', 'c est juste', 'c est bien ca', 'yes', 'yeah', 'yep', 'yup', 'yea', 'sure', 'of course', 'right', 'absolutely', 'that s right', 'that s correct', 'that is correct', 'it s correct', 'it is', 'it is correct', 'yes it is', 'confirm', 'confirmed', 'je confirme', 'i confirm']);
const yesLead = new Set(['oui', 'ouais', 'yes', 'yeah', 'yep', 'ok', 'okay', 'exact', 'correct', 'tout a fait', 'd accord']);
const noAnswers = new Set(['non', 'nan', 'none', 'no', 'nope', 'nah', 'pas du tout', 'absolument pas', 'incorrect', 'faux', 'c est faux', 'c est pas ca', 'ce n est pas ca', 'pas ca', 'c est pas bon', 'c est incorrect', 'wrong', 'that s wrong', 'that s not right', 'that s not correct', 'not correct', 'it s not', 'it isn t', 'no it s not', 'no it isn t']);
export function confirmationAnswer(text: string): 'yes' | 'no' | undefined {
  const value = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
    .split(' ').filter((word, index, words) => word !== words[index - 1]).join(' ').replace(filler, '').trim();
  if (yesAnswers.has(value)) return 'yes';
  if (noAnswers.has(value)) return 'no';
  const [lead, rest] = [...yesLead, ...noAnswers].map((word) => value.startsWith(word + ' ') ? [word, value.slice(word.length + 1)] : undefined).find(Boolean) ?? [];
  if (lead && yesLead.has(lead) && (yesAnswers.has(rest!) || yesLead.has(rest!))) return 'yes';
  if (lead && noAnswers.has(lead) && (noAnswers.has(rest!) || ['merci', 'thanks'].includes(rest!))) return 'no';
}
