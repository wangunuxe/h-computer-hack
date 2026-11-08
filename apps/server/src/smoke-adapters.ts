import { understand } from './understand.js';
import { searchDisruptionAndAlternatives } from './adapters/linkup.js';

const profile = { name: 'Nicolas Demo', email: 'karim@example.com', phone: '+33612345678', guide_dog: true, language: 'fr' };
const now = new Date();
if (process.argv.includes('gemini')) {
  for (const transcript of [
    "Je suis à Gare du Nord, mon vol part de CDG terminal 2E à 21h, j'ai un chien guide et une valise",
    'I need to get to the airport, RER B is down',
    'chui a gar du nor, mon vole charle de gol terminal deux E demain a vingt et une heure, chien gid et une valiz',
  ]) {
    const started = performance.now();
    try { console.log(JSON.stringify({ transcript, result: await understand({ transcript, profile, now }), latencyMs: Math.round(performance.now() - started) }, null, 2)); }
    catch (error) { console.log(JSON.stringify({ transcript, error: error instanceof Error ? error.message : 'Understanding failed', latencyMs: Math.round(performance.now() - started) })); process.exitCode = 1; }
  }
} else if (process.argv.includes('linkup')) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const query = `RER B Gare du Nord vers Aéroport Charles de Gaulle : y a-t-il une interruption aujourd'hui ${day} ? Chercher les informations officielles datées, préciser les incertitudes, et les alternatives taxi G7, Paris Airport Shuttle ou bus de remplacement.`;
  const started = performance.now();
  try {
    const result = await searchDisruptionAndAlternatives({ query, timeoutMs: 15000 });
    console.log(JSON.stringify({ query, latencyMs: Math.round(performance.now() - started), corroboration: result.corroboration.slice(0, 3).map((c) => ({ ...c, text: c.text.slice(0, 400) })), extraOptions: result.extraOptions }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Search failed'); process.exitCode = 1; }
} else { console.error('Usage: tsx apps/server/src/smoke-adapters.ts gemini|linkup'); process.exitCode = 1; }
