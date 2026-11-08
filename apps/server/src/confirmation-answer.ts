export function confirmationAnswer(text: string): 'yes' | 'no' | undefined {
  const value = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/^(oui|oui c est ca|oui c est correct|ouais|exact|exactement|c est correct|c est ca|c est bon|yes|yes please|yes that s right|that s right|correct)$/.test(value)) return 'yes';
  if (/^(non|nan|non merci|non c est pas ca|non ce n est pas ca|non pas ca|no|no thanks|no that s not right)$/.test(value)) return 'no';
}
