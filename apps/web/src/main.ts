import { ProfileSchema, ScenarioSchema, ServerEventSchema, type WebEvent } from '@voila/shared';
import { canStop, initialState, optionEvent, reduce, transcriptEvent, type Stage } from './state.js';
import { SpeechQueue } from './speech.js';
import { Recorder, type Credentials } from './recorder.js';
import { clientProfile, type ClientProfile } from './preferences.js';
import { labels, optionNames, stages } from './labels.js';
import { bindMicControls } from './mic-controls.js';
import { recordingDiagnostic, recordingErrorKeys } from './recording-error.js';
import { ConnectionAttempt, replaceOnForeground } from './connection.js';
import { SessionStorage } from './session-storage.js';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('profile-form');
let language: 'fr' | 'en' = navigator.language.startsWith('fr') ? 'fr' : 'en';
let profile: ClientProfile | undefined;
try { profile = clientProfile(JSON.parse(localStorage.getItem('voila.profile') ?? 'null')); } catch { /* Storage may be unavailable. */ }
if (profile) language = profile.language.startsWith('fr') ? 'fr' : 'en';
let state = initialState(); let credentials: Credentials | undefined; let socket: WebSocket | undefined;
let helloSent = false; let connecting = false; let retry: ReturnType<typeof setTimeout> | undefined; let pendingStop = false; let connected = false;
let queuedTranscript: string | undefined;
const sessionStorage = new SessionStorage();
const savedSession = sessionStorage.load();
if (savedSession) { credentials = { id: savedSession.id, resume_token: savedSession.resume_token }; helloSent = savedSession.helloSent; }
let attempt: ConnectionAttempt | undefined;
let recorder: Recorder | undefined; let releasing = false; let audio: AudioContext | undefined;
let lastSay = ''; let pendingFocus: Stage | undefined;
const t = () => labels[language];

function announce(text: string, assertive = false) {
  if (assertive) $('errors').replaceChildren(element('p', text));
  else { lastSay = text; $('caption').replaceChildren(document.createTextNode(text)); }
}
function speech() {
  return new SpeechQueue({ speak(text, lang, done) {
    if (!profile?.tts_enabled || !window.speechSynthesis) { done(); return; }
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang; utterance.onend = done; utterance.onerror = done; speechSynthesis.speak(utterance);
  }, cancel: () => window.speechSynthesis?.cancel() }, language === 'fr' ? 'fr-FR' : 'en-GB');
}
let voice = speech();
function unlock() {
  voice.bargeIn();
  if (!profile?.tts_enabled) return;
  if (window.speechSynthesis) { const silence = new SpeechSynthesisUtterance(' '); silence.lang = language; speechSynthesis.speak(silence); }
  voice.unlock();
}
function cue(stopping = false) {
  navigator.vibrate?.(stopping ? [20, 30, 20] : 35);
  try {
    audio ??= new AudioContext(); void audio.resume();
    const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.08;
    oscillator.frequency.value = stopping ? 440 : 660; oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.08);
  } catch { /* Haptics and earcons are optional. */ }
}
function send(event: WebEvent) {
  if (socket?.readyState !== WebSocket.OPEN) { announce(t().disconnected, true); return false; }
  socket.send(JSON.stringify(event)); return true;
}
function sendTranscript(text: string) {
  const event = transcriptEvent(state.stage, text);
  if (event?.type === 'final_transcript' && state.stage === 'DONE') {
    sessionStorage.clear(); queuedTranscript = text;
    attempt?.cancel(); attempt = undefined; connecting = false;
    const stale = socket; socket = undefined; stale?.close();
    credentials = undefined; helloSent = false; state = initialState();
    render(); void connect(); return;
  }
  if (event && send(event)) { if (credentials) sessionStorage.save(credentials, helloSent); $('last-transcript').textContent = text.trim(); $('user-bubble').hidden = false; }
}
function connection(ready: boolean) {
  connected = ready; document.body.dataset.connected = String(ready);
  $('connection').textContent = !profile ? t().profileRequired : ready ? t().ready : t().connecting;
  recordingLabel();
}
async function connect() {
  if (!profile || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true; connection(false);
  const current = attempt = new ConnectionAttempt(() => {
    if (attempt !== current) return;
    attempt = undefined; connecting = false;
    const stale = socket; socket = undefined; stale?.close();
    connection(false); clearTimeout(retry); retry = setTimeout(() => void connect(), 1500);
  });
  try {
    if (!credentials) {
      const response = await fetch('/session', { method: 'POST', signal: current.controller.signal }); if (!response.ok) throw new Error('Session unavailable');
      const issued: Credentials = await response.json();
      if (attempt !== current) return;
      credentials = issued; helloSent = false;
      sessionStorage.save(credentials, false);
    }
    const ws = socket = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/session/' + credentials!.id + '?token=' + encodeURIComponent(credentials!.resume_token));
    ws.onopen = () => {
      if (ws !== socket) return;
      current.clear();
      connection(true);
      if (!helloSent) { send({ type: 'hello', profile: ProfileSchema.parse(profile), gps: null, scenario: ScenarioSchema.safeParse(new URLSearchParams(location.search).get('scenario')).data }); helloSent = true; }
      sessionStorage.save(credentials!, helloSent);
      if (queuedTranscript) { const text = queuedTranscript; queuedTranscript = undefined; sendTranscript(text); }
      if (pendingStop) { send({ type: 'stop' }); pendingStop = false; recordingLabel(); }
    };
    ws.onmessage = (message) => {
      if (ws !== socket) return;
      try {
        const event = ServerEventSchema.parse(JSON.parse(String(message.data)));
        const previous = state.stage; state = reduce(state, event);
        if (event.type === 'stage' && state.stage !== previous) pendingFocus = ['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(state.stage) ? undefined : state.stage;
        if (event.type === 'say') { announce(event.text); if (profile?.tts_enabled) voice.enqueue(event.text); }
        if (event.type === 'error') announce(event.message, true);
        if (event.type === 'clarify') announce(event.question);
        if (!['say', 'clarify', 'error', 'feed'].includes(event.type)) render();
        if (event.type === 'feed') renderFeed();
      } catch { announce(t().error, true); }
    };
    ws.onclose = (event) => {
      if (ws !== socket) return;
      current.clear();
      recorder?.cancel(); connection(false); $('connection').textContent = t().disconnected;
      if (event.code === 4401) { credentials = undefined; helloSent = false; sessionStorage.clear(); }
      clearTimeout(retry); retry = setTimeout(() => void connect(), 1500);
    };
    ws.onerror = () => { if (ws === socket) $('connection').textContent = t().disconnected; };
  } catch { if (attempt === current) { current.clear(); announce(t().disconnected, true); clearTimeout(retry); retry = setTimeout(() => void connect(), 3000); } }
  finally { if (attempt === current) connecting = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearTimeout(retry);
    attempt?.cancel(); attempt = undefined; connecting = false;
    if (replaceOnForeground(socket?.readyState)) { const stale = socket; socket = undefined; stale?.close(); }
    void connect();
  } else { if (credentials) sessionStorage.save(credentials, helloSent); recorder?.cancel(); }
});
window.addEventListener('pagehide', () => { if (credentials) sessionStorage.save(credentials, helloSent); });
setInterval(() => { if (connected && credentials) sessionStorage.save(credentials, helloSent); }, 60_000);
function recordingLabel() {
  const active = !!recorder && !releasing;
  const busy = releasing || ['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(state.stage);
  const label = active ? t().listening : releasing ? t().processing : busy ? t().busy : profile?.mic_mode === 'hold' ? t().hold : t().tap;
  $('mic-control').dataset.mode = active ? 'listening' : busy ? 'busy' : 'idle';
  $('mic-label').textContent = label;
  const talk = $<HTMLButtonElement>('talk');
  talk.setAttribute('aria-pressed', String(active));
  talk.setAttribute('aria-label', active ? t().stopListening : releasing ? t().processing : profile?.mic_mode === 'hold' ? t().hold : t().tap);
  talk.disabled = !connected || releasing;
  $('talk-help').textContent = profile?.mic_mode === 'hold' ? t().holdHelp : t().toggleHelp;
  $('stop').hidden = !!recorder || !canStop(state.stage);
}
function start() {
  if (recorder || !credentials || socket?.readyState !== WebSocket.OPEN) return;
  unlock(); cue(); releasing = false;
  $('errors').replaceChildren();
  const current = new Recorder(sendTranscript, (failure) => { console.warn('Speech recording failed', recordingDiagnostic(failure)); announce(t()[recordingErrorKeys[failure.kind]], true); }, () => { if (recorder === current) { recorder = undefined; releasing = false; $('elapsed').hidden = true; recordingLabel(); } }, () => {
    releasing = true; cue(true); recordingLabel();
    const text = language === 'fr' ? 'Trois minutes atteintes. Je termine la transcription.' : 'Three-minute limit reached. Finishing the transcript.';
    announce(text); if (profile?.tts_enabled) voice.enqueue(text);
  }, (seconds) => { $('elapsed').hidden = false; $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; });
  recorder = current; recordingLabel(); void current.start(credentials);
}
function release() { if (!recorder || releasing) return; releasing = true; cue(true); recordingLabel(); recorder.stop(); }
const talk = $<HTMLButtonElement>('talk');
bindMicControls(talk, $('dock'), { mode: () => profile?.mic_mode ?? 'toggle', active: () => !!recorder, start, release });
$('stop').onclick = () => { unlock(); recorder?.cancel(); pendingStop = !send({ type: 'stop' }); if (pendingStop) void connect(); state = initialState(); render(); cue(true); talk.focus(); };
$('repeat').onclick = () => { unlock(); if (!lastSay) return; if (profile?.tts_enabled) voice.enqueue(lastSay); else announce(lastSay); };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
function button(text: string, action: () => void) { const node = element('button', text); node.type = 'button'; node.onclick = () => { unlock(); action(); }; return node; }
function safeLink(url: string, text: string) { try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return undefined; const link = element('a', text); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; } catch { return undefined; } }
function primary<T extends HTMLElement>(node: T) { node.id = 'primary-content'; if (node.tagName !== 'A') node.tabIndex = -1; return node; }
const money = (amount: number) => new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(amount);
function renderFeed() {
  const list = $('feed-items'); list.replaceChildren();
  for (const item of state.feed) { const row = element('li', item.text); const link = item.source && safeLink(item.source, t().source); if (link) row.append(' ', link); list.append(row); }
}
function render() {
  $('journey').hidden = !profile || !form.hidden; $('dock').hidden = !profile || !form.hidden;
  $('stage').textContent = stages[language][state.stage]; recordingLabel();
  const actions = $('actions'); const focused = document.activeElement as HTMLElement | null;
  const restore = focused && actions.contains(focused) ? focused.id : undefined;
  actions.replaceChildren();
  if (['PRESENT', 'CHOOSE'].includes(state.stage)) {
    actions.append(primary(element('h2', t().options))); const list = element('ul'); list.className = 'option-list';
    for (const option of state.options) {
      const row = element('li'); const choice = button('', () => { const event = optionEvent(state.options, option.id); if (event) send(event); });
      choice.id = 'option-' + option.id; choice.className = 'option-card';
      const top = element('span'); top.className = 'option-top';
      const name = element('span', optionNames[option.id]?.[language] ?? option.name); name.className = 'option-name';
      const price = element('span', money(option.price)); price.className = 'option-price'; top.append(name, price);
      const meta = element('span', option.pickup_wait_minutes + ' ' + t().minutes + ' ' + t().wait + ' · ' + option.journey_minutes + ' ' + t().minutes + ' ' + t().journey); meta.className = 'option-meta';
      const badge = element('span', t().dogStatus + ' : ' + t()[option.guide_dog_status]); badge.className = 'badge';
      choice.append(top, meta, badge); row.append(choice); list.append(row);
    }
    actions.append(list);
  }
  if (state.stage === 'CONFIRM' && state.summary) {
    const card = element('article'); card.className = 'context-card';
    const decisions = element('div'); decisions.className = 'decision';
    const yes = button(t().yes, () => send({ type: 'user_reply', text: 'oui' })); yes.id = 'confirm-yes';
    const no = button(t().no, () => send({ type: 'user_reply', text: 'non' })); no.id = 'confirm-no'; no.className = 'secondary';
    decisions.append(yes, no); card.append(primary(element('h2', t().confirm)), element('p', state.summary), decisions); actions.append(card);
  }
  if (['HANDOFF', 'AWAIT_PAYMENT'].includes(state.stage) && state.payment) {
    const card = element('article'); card.className = 'context-card';
    card.append(element('h2', t().payment), element('p', state.payment.merchant));
    const amount = element('p', money(state.payment.amount)); amount.className = 'payment-amount'; card.append(amount);
    const link = safeLink(state.payment.url, t().payment + ' — ' + money(state.payment.amount) + ' — ' + state.payment.merchant);
    if (link) { link.className = 'payment'; card.append(primary(link), element('p', t().secure)); }
    const paid = button(t().paid, () => send({ type: 'paid' })); paid.id = 'paid'; paid.className = 'secondary wide'; card.append(paid); actions.append(card);
  }
  if (state.stage === 'DONE' && state.booking) {
    const booking = state.booking; const card = primary(element('article')); card.className = 'context-card'; card.setAttribute('aria-labelledby', 'booking-heading');
    const heading = element('h2', t().booking); heading.id = 'booking-heading'; const details = element('dl');
    const pickup = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(booking.pickup_time)) + ' — ' + booking.pickup_point;
    for (const [label, value] of [[t().ref, booking.ref], [t().pickup, pickup], [t().price, money(booking.price)], [t().operator, booking.operator_phone], [t().dogStatus, t()[booking.guide_dog_status]]]) details.append(element('dt', label), element('dd', value));
    card.append(heading, details); actions.append(card);
  }
  if (form.hidden) {
    const target = document.getElementById('primary-content');
    if (pendingFocus && target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center' }); pendingFocus = undefined; }
    else if (pendingFocus && !['PRESENT', 'CHOOSE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT', 'DONE'].includes(state.stage)) { $('stage').focus(); pendingFocus = undefined; }
    else if (restore) document.getElementById(restore)?.focus({ preventScroll: true });
  }
  renderFeed();
}
function localize() {
  document.documentElement.lang = language; document.title = t().title; document.body.dataset.micMode = profile?.mic_mode ?? 'toggle';
  document.querySelectorAll<HTMLElement>('[data-label]').forEach((node) => { const key = node.dataset.label as keyof typeof labels.fr; node.textContent = t()[key]; });
  if (!lastSay) { lastSay = t().welcome; $('caption').textContent = lastSay; }
  render();
}
if (profile) {
  for (const key of ['name', 'phone', 'email', 'language', 'mic_mode'] as const) (form.elements.namedItem(key) as HTMLInputElement).value = profile[key];
  (form.elements.namedItem('guide_dog') as HTMLInputElement).checked = profile.guide_dog;
  (form.elements.namedItem('voice_mode') as HTMLSelectElement).value = profile.tts_enabled ? 'voila' : 'screen_reader';
} else (form.elements.namedItem('language') as HTMLSelectElement).value = language;
(form.elements.namedItem('language') as HTMLSelectElement).onchange = (event) => { language = (event.target as HTMLSelectElement).value === 'fr' ? 'fr' : 'en'; localize(); };
form.hidden = !!profile;
$('edit').onclick = () => { recorder?.cancel(); voice.bargeIn(); form.hidden = false; render(); $<HTMLInputElement>('name').focus(); };
form.onsubmit = (event) => {
  event.preventDefault(); const data = new FormData(form);
  const parsed = clientProfile({ name: data.get('name'), phone: data.get('phone'), email: data.get('email'), guide_dog: data.has('guide_dog'), language: data.get('language'), mic_mode: data.get('mic_mode'), tts_enabled: data.get('voice_mode') !== 'screen_reader' });
  if (!parsed) { announce(t().invalid, true); return; }
  profile = parsed; language = profile.language === 'fr' ? 'fr' : 'en'; voice.bargeIn(); voice = speech(); unlock();
  try { localStorage.setItem('voila.profile', JSON.stringify(profile)); } catch { announce(t().error, true); }
  if (helloSent) { sessionStorage.clear(); recorder?.cancel(); send({ type: 'stop' }); socket?.close(); socket = undefined; credentials = undefined; helloSent = false; state = initialState(); $('user-bubble').hidden = true; }
  form.hidden = true; localize(); announce(t().saved); void connect();
};
localize(); connection(false); if (profile) void connect();
