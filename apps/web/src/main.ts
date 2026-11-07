import { ProfileSchema, ScenarioSchema, ServerEventSchema, type Profile, type WebEvent } from '@voila/shared';
import { initialState, reduce, transcriptEvent } from './state.js';
import { SpeechQueue } from './speech.js';
import { Recorder, type Credentials } from './recorder.js';
import { labels, optionNames, stages } from './labels.js';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let language: 'fr' | 'en' = navigator.language.startsWith('fr') ? 'fr' : 'en';
let profile: Profile | undefined;
try { profile = ProfileSchema.safeParse(JSON.parse(localStorage.getItem('voila.profile') ?? 'null')).data; } catch { /* Storage may be unavailable. */ }
if (profile) language = profile.language.startsWith('fr') ? 'fr' : 'en';
let state = initialState(); let credentials: Credentials | undefined; let socket: WebSocket | undefined;
let helloSent = false; let connecting = false; let retry: ReturnType<typeof setTimeout> | undefined; let pendingStop = false;
let recorder: Recorder | undefined; let releasing = false; let audio: AudioContext | undefined;
const t = () => labels[language];
const announce = (text: string, assertive = false) => { const region = $(assertive ? 'errors' : 'announcements'); const line = document.createElement('p'); line.textContent = text; region.append(line); while (region.children.length > 10) region.firstElementChild?.remove(); };
function speech() {
  return new SpeechQueue({ speak(text, lang, done) {
    if (!window.speechSynthesis) { done(); return; }
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang; utterance.onend = done; utterance.onerror = done; speechSynthesis.speak(utterance);
  }, cancel: () => window.speechSynthesis?.cancel() }, language === 'fr' ? 'fr-FR' : 'en-GB');
}
let voice = speech();
function unlock() {
  voice.bargeIn();
  if (window.speechSynthesis) { const silence = new SpeechSynthesisUtterance(' '); silence.lang = language; speechSynthesis.speak(silence); }
  voice.unlock();
}
function cue() {
  navigator.vibrate?.(35);
  try {
    audio ??= new AudioContext(); void audio.resume();
    const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.08;
    oscillator.frequency.value = 660; oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.08);
  } catch { /* Haptics and earcons are optional. */ }
}
function send(event: WebEvent) {
  if (socket?.readyState !== WebSocket.OPEN) { announce(t().disconnected, true); return false; }
  socket.send(JSON.stringify(event)); return true;
}
function sendText(text: string) { const event = transcriptEvent(state.stage, text); if (event) send(event); else announce(t().empty, true); }
function connection(ready: boolean) {
  $('connection').textContent = ready ? t().ready : t().connecting;
  $<HTMLButtonElement>('talk').disabled = !ready; $<HTMLButtonElement>('send').disabled = !ready;
}
async function connect() {
  if (!profile || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true; connection(false);
  try {
    if (!credentials) {
      const response = await fetch('/session', { method: 'POST' }); if (!response.ok) throw new Error('Session unavailable');
      credentials = await response.json(); helloSent = false;
    }
    const ws = socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/session/${credentials!.id}?token=${encodeURIComponent(credentials!.resume_token)}`);
    ws.onopen = () => {
      if (ws !== socket) return;
      connection(true);
      if (!helloSent) { send({ type: 'hello', profile: profile!, gps: null, scenario: ScenarioSchema.safeParse(new URLSearchParams(location.search).get('scenario')).data }); helloSent = true; }
      if (pendingStop) { send({ type: 'stop' }); pendingStop = false; }
    };
    ws.onmessage = (message) => {
      if (ws !== socket) return;
      try {
        const event = ServerEventSchema.parse(JSON.parse(String(message.data))); state = reduce(state, event);
        if (event.type === 'say') { announce(event.text); voice.enqueue(event.text); }
        if (event.type === 'error') announce(event.message, true);
        if (event.type === 'clarify') announce(event.question);
        if (!['say', 'clarify', 'error', 'feed'].includes(event.type)) render();
        if (event.type === 'feed') renderFeed();
      } catch { announce(t().error, true); }
    };
    ws.onclose = (event) => {
      if (ws !== socket) return;
      recorder?.cancel(); connection(false); $('connection').textContent = t().disconnected;
      if (event.code === 4401) { credentials = undefined; helloSent = false; }
      clearTimeout(retry); retry = setTimeout(() => void connect(), 1500);
    };
    ws.onerror = () => { $('connection').textContent = t().disconnected; };
  } catch { announce(t().disconnected, true); clearTimeout(retry); retry = setTimeout(() => void connect(), 3000); }
  finally { connecting = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearTimeout(retry);
    if (socket?.readyState === WebSocket.OPEN) { socket.close(); socket = undefined; }
    void connect();
  } else recorder?.cancel();
});
function recordingLabel() {
  const talk = $<HTMLButtonElement>('talk'); talk.textContent = recorder ? (releasing ? t().processing : t().recording) : t().hold;
  talk.setAttribute('aria-pressed', String(!!recorder));
}
function start() {
  if (recorder || !credentials || socket?.readyState !== WebSocket.OPEN) return;
  unlock(); cue(); releasing = false;
  const current = new Recorder(sendText, () => announce(t().microphone, true), () => { if (recorder === current) { recorder = undefined; releasing = false; recordingLabel(); } });
  recorder = current; recordingLabel(); void current.start(credentials);
}
function release() { if (!recorder || releasing) return; releasing = true; cue(); recordingLabel(); recorder.stop(); }
const talk = $<HTMLButtonElement>('talk');
talk.onpointerdown = (event) => { if (event.button !== 0) return; event.preventDefault(); talk.setPointerCapture(event.pointerId); start(); };
talk.onpointerup = (event) => { event.preventDefault(); release(); };
talk.onpointercancel = () => recorder?.cancel();
talk.onkeydown = (event) => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) start(); } };
talk.onkeyup = (event) => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); release(); } };
talk.onclick = (event) => { if (event.detail === 0) { if (recorder) release(); else start(); } };
$('stop').onclick = () => { unlock(); recorder?.cancel(); pendingStop = !send({ type: 'stop' }); if (pendingStop) void connect(); state = initialState(); render(); cue(); };
$('text-form').onsubmit = (event) => { event.preventDefault(); unlock(); const field = $<HTMLInputElement>('text'); if (field.value.trim()) { const outgoing = transcriptEvent(state.stage, field.value); if (outgoing && send(outgoing)) field.value = ''; } else announce(t().empty, true); };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
function button(text: string, action: () => void) { const node = element('button', text); node.type = 'button'; node.onclick = () => { unlock(); action(); }; return node; }
function safeLink(url: string, text: string) { try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return undefined; const link = element('a', text); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; } catch { return undefined; } }
const money = (amount: number) => new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(amount);
function renderFeed() {
  const list = $('feed-items'); list.replaceChildren();
  for (const item of state.feed) { const row = element('li', item.text); const link = item.source && safeLink(item.source, t().source); if (link) row.append(' ', link); list.append(row); }
}
function render() {
  $('stage').textContent = stages[language][state.stage];
  const actions = $('actions'); actions.replaceChildren();
  if (['PRESENT', 'CHOOSE'].includes(state.stage)) {
    actions.append(element('h2', t().options)); const list = element('ul');
    for (const option of state.options) { const row = element('li'); row.append(button(`${optionNames[option.id]?.[language] ?? option.name} — ${money(option.price)} — ${t().arrival} ${option.pickup_wait_minutes} / ${option.journey_minutes} ${t().minutes} — ${t().dogStatus} : ${t()[option.guide_dog_status]}`, () => send({ type: 'user_reply', text: option.name }))); list.append(row); }
    actions.append(list);
  }
  if (state.stage === 'CONFIRM' && state.summary) { actions.append(element('h2', t().confirm), element('p', state.summary), button(t().yes, () => send({ type: 'user_reply', text: 'oui' })), button(t().no, () => send({ type: 'user_reply', text: 'non' }))); }
  if (['HANDOFF', 'AWAIT_PAYMENT'].includes(state.stage) && state.payment) {
    const link = safeLink(state.payment.url, `${t().payment} — ${money(state.payment.amount)} — ${state.payment.merchant}`);
    actions.append(element('h2', t().payment)); if (link) { link.className = 'payment'; actions.append(link, element('p', t().secure)); }
    actions.append(button(t().paid, () => send({ type: 'paid' })));
  }
  if (state.stage === 'DONE' && state.booking) {
    const booking = state.booking; actions.append(element('h2', t().booking)); const card = element('dl');
    for (const [label, value] of [[t().ref, booking.ref], [t().pickup, `${new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(booking.pickup_time))} — ${booking.pickup_point}`], [t().price, money(booking.price)], [t().operator, booking.operator_phone], [t().dogStatus, t()[booking.guide_dog_status]]]) card.append(element('dt', label), element('dd', value));
    actions.append(card);
  }
  renderFeed();
}
function localize() {
  document.documentElement.lang = language; document.title = t().title;
  document.querySelectorAll<HTMLElement>('[data-label]').forEach((node) => { const key = node.dataset.label as keyof typeof labels.fr; node.textContent = t()[key]; });
  recordingLabel(); render();
}
const form = $<HTMLFormElement>('profile-form');
if (profile) { for (const key of ['name', 'phone', 'email', 'language'] as const) (form.elements.namedItem(key) as HTMLInputElement).value = profile[key]; (form.elements.namedItem('guide_dog') as HTMLInputElement).checked = profile.guide_dog; }
else (form.elements.namedItem('language') as HTMLSelectElement).value = language;
(form.elements.namedItem('language') as HTMLSelectElement).onchange = (event) => { language = (event.target as HTMLSelectElement).value === 'fr' ? 'fr' : 'en'; localize(); };
form.hidden = !!profile;
$('edit').onclick = () => { form.hidden = false; $<HTMLInputElement>('name').focus(); };
form.onsubmit = (event) => {
  event.preventDefault(); const data = new FormData(form);
  const parsed = ProfileSchema.safeParse({ name: data.get('name'), phone: data.get('phone'), email: data.get('email'), guide_dog: data.has('guide_dog'), language: data.get('language') });
  if (!parsed.success) { announce(t().invalid, true); return; }
  profile = parsed.data; language = profile.language === 'fr' ? 'fr' : 'en'; voice.bargeIn(); voice = speech(); unlock();
  try { localStorage.setItem('voila.profile', JSON.stringify(profile)); } catch { announce(t().error, true); }
  if (helloSent) { recorder?.cancel(); send({ type: 'stop' }); socket?.close(); socket = undefined; credentials = undefined; helloSent = false; state = initialState(); }
  form.hidden = true; localize(); announce(t().saved); void connect();
};
localize(); connection(false); if (profile) void connect();
