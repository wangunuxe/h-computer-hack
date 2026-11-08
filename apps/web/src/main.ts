import { ServerEventSchema, type WebEvent } from '@voila/shared';
import { phoneHello } from './pairing.js';
import { canStop, initialState, optionEvent, reduce, transcriptEvent, type Stage } from './state.js';
import { BrowserSpeech, SpeechQueue } from './speech.js';
import { Recorder, type Credentials } from './recorder.js';
import { clientProfile, deviceLanguage } from './preferences.js';
import { decisionLabels, labels, optionLabel, stages } from './labels.js';
import { bindMicControls, micControlState } from './mic-controls.js';
import { phoneLocation } from './location.js';
import { recordingDiagnostic, recordingErrorKeys } from './recording-error.js';
import { ConnectionAttempt, replaceOnForeground, requiresFreshSession } from './connection.js';
import { SessionStorage } from './session-storage.js';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const language = deviceLanguage(navigator.language);
let profile = clientProfile(undefined, language);
try { profile = clientProfile(JSON.parse(localStorage.getItem('voila.profile') ?? 'null'), language); } catch { /* Storage may be unavailable. */ }
let collectingProfile = false;
let state = initialState(); let credentials: Credentials | undefined; let socket: WebSocket | undefined;
let helloSent = false; let connecting = false; let retry: ReturnType<typeof setTimeout> | undefined; let pendingStop = false; let connected = false;
let connectionFailed = false;
let queuedTranscript: string | undefined;
const sessionStorage = new SessionStorage();
const savedSession = sessionStorage.load();
if (savedSession) { credentials = { id: savedSession.id, resume_token: savedSession.resume_token }; helloSent = savedSession.helloSent; }
let attempt: ConnectionAttempt | undefined;
let recorder: Recorder | undefined; let releasing = false;
let lastSay = ''; let pendingFocus: Stage | undefined;
let lastCards = ''; let lastNarrated = Date.now(); let speechNeedsGesture = true; let progressCue = 0;
const t = () => labels[language];

function announce(text: string, assertive = false) {
  if (assertive) { $('errors').replaceChildren(element('p', text)); }
  else { lastSay = text; $('caption').replaceChildren(document.createTextNode(text)); }
  lastNarrated = Date.now(); voice.enqueue(text);
}
const voice = new SpeechQueue(new BrowserSpeech(() => {
  voice.hold(); speechNeedsGesture = true;
  $('errors').textContent = language === 'fr' ? 'La voix est indisponible. Touchez le micro pour réessayer.' : 'Speech is unavailable. Tap the microphone to retry.';
  $('errors').setAttribute('role', 'alert'); $('errors').setAttribute('aria-live', 'assertive');
}), language === 'fr' ? 'fr-FR' : 'en-GB');
function unlock() {
  $('errors').setAttribute('aria-live', 'off'); $('errors').setAttribute('role', 'none');
  speechNeedsGesture = false; voice.unlock();
}
function cue(stopping = false) {
  navigator.vibrate?.(stopping ? [20, 30, 20] : 35);
  try {
    const audio = new AudioContext(); void audio.resume();
    const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.08;
    oscillator.frequency.value = stopping ? 440 : 660; oscillator.connect(gain).connect(audio.destination); oscillator.onended = () => { void audio.close(); }; oscillator.start(); oscillator.stop(audio.currentTime + 0.08);
  } catch { /* Haptics and earcons are optional. */ }
}
function send(event: WebEvent) {
  if (socket?.readyState !== WebSocket.OPEN) { announce(t().connectionRetry, true); return false; }
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
  if (event && send(event)) { state = { ...state, yesNo: false }; render(); if (credentials) sessionStorage.save(credentials, helloSent); }
}
const requestPhoneLocation = phoneLocation((request_id, gps) => { send({ type: 'location_result', request_id, gps }); });
function connection(ready: boolean) {
  connected = ready; document.body.dataset.connected = String(ready);
  if (ready && connectionFailed) { connectionFailed = false; $('errors').replaceChildren(); }
  $('connection').textContent = ready ? t().ready : connectionFailed ? t().connectionRetry : t().connecting;
  recordingLabel();
}
function connectionFailure() {
  const first = !connectionFailed; connectionFailed = true; connection(false);
  if (first) announce(t().connectionRetry, true);
}
function retryConnection() {
  voice.resume(); unlock(); clearTimeout(retry); attempt?.cancel(); attempt = undefined; connecting = false;
  const stale = socket; socket = undefined; stale?.close(); void connect();
}
async function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true; connection(false);
  const current = attempt = new ConnectionAttempt(() => {
    if (attempt !== current) return;
    attempt = undefined; connecting = false;
    const stale = socket; socket = undefined; stale?.close();
    connectionFailure(); clearTimeout(retry); retry = setTimeout(() => void connect(), 1500);
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
      if (!helloSent || new URLSearchParams(location.search).get('watch')) { send(phoneHello(profile, location.search)); helloSent = true; }
      else send({ type: 'language', language });
      sessionStorage.save(credentials!, helloSent);
      if (queuedTranscript) { const text = queuedTranscript; queuedTranscript = undefined; sendTranscript(text); }
      if (pendingStop) { send({ type: 'stop' }); pendingStop = false; recordingLabel(); }
    };
    ws.onmessage = (message) => {
      if (ws !== socket) return;
      try {
        const event = ServerEventSchema.parse(JSON.parse(String(message.data)));
        const previous = state.stage; state = reduce(state, event);
        if (event.type === 'profile') {
          profile = clientProfile(event.profile, language);
          try { if (Object.keys(profile).length === 1) localStorage.removeItem('voila.profile'); else localStorage.setItem('voila.profile', JSON.stringify(profile)); } catch { /* Storage may be unavailable. */ }
        }
        if (event.type === 'profile_request') collectingProfile = true;
        if (event.type === 'stage' && state.stage !== previous) collectingProfile = false;
        if (event.type === 'stage' && state.stage !== previous) pendingFocus = ['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(state.stage) ? undefined : state.stage;
        if (event.type === 'say') announce(event.text);
        if (event.type === 'confirm') announce(event.summary);
        if (event.type === 'error') announce(event.message, true);
        if (event.type === 'clarify') announce(event.question);
        if (event.type === 'location_request') requestPhoneLocation(event.request_id);
        if (!['say', 'error', 'feed'].includes(event.type)) render();
        if (event.type === 'feed') renderFeed();
      } catch { announce(t().error, true); }
    };
    ws.onclose = (event) => {
      if (ws !== socket) return;
      current.clear();
      recorder?.cancel(); connectionFailure();
      if (requiresFreshSession(event.code)) { credentials = undefined; helloSent = false; sessionStorage.clear(); queuedTranscript = undefined; pendingStop = false; state = initialState(); render(); }
      clearTimeout(retry); retry = setTimeout(() => void connect(), 1500);
    };
    ws.onerror = () => { if (ws === socket) connectionFailure(); };
  } catch { if (attempt === current) { current.clear(); connectionFailure(); clearTimeout(retry); retry = setTimeout(() => void connect(), 3000); } }
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
setInterval(() => {
  if (!recorder && state.cancellable && voice.idle && Date.now() - lastNarrated >= 30_000) {
    const cues = language === 'fr' ? ['Je reste en attente du serveur. Vous pouvez dire stop.', 'Votre demande est toujours en cours. Je vous informe dès que le serveur répond.'] : ['I am waiting for the server. You can say stop.', 'Your request is still in progress. I will tell you when the server responds.'];
    announce(cues[progressCue++ % cues.length]!);
  }
}, 5000);
function recordingLabel() {
  const active = !!recorder && !releasing;
  const control = micControlState({ connected, failed: connectionFailed, active, releasing }, t());
  $('mic-label').textContent = control.caption;
  const talk = $<HTMLButtonElement>('talk');
  talk.setAttribute('aria-pressed', String(control.pressed));
  talk.setAttribute('aria-label', control.label);
  talk.disabled = control.disabled;
  $('stop').hidden = !!recorder || !canStop(state);
}
function start() {
  if (!connected) { retryConnection(); return; }
  if (recorder || !credentials || socket?.readyState !== WebSocket.OPEN) return;
  voice.bargeIn(); voice.resume();
  if (speechNeedsGesture) voice.enqueue(lastSay || t().welcome);
  unlock(); voice.hold(); cue(); releasing = false;
  $('errors').replaceChildren();
  const current = new Recorder(sendTranscript, (failure) => { console.warn('Speech recording failed', recordingDiagnostic(failure)); announce(t()[recordingErrorKeys[failure.kind]], true); }, () => { if (recorder === current) { recorder = undefined; releasing = false; $('elapsed').hidden = true; recordingLabel(); } }, () => {
    releasing = true; cue(true); recordingLabel();
    const text = language === 'fr' ? 'Trois minutes atteintes. Je termine la transcription.' : 'Three-minute limit reached. Finishing the transcript.';
    announce(text);
  }, (seconds) => { $('elapsed').hidden = false; $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }, () => voice.resume());
  recorder = current; recordingLabel(); void current.start(credentials);
}
function release() { if (!recorder || releasing) return; releasing = true; unlock(); cue(true); recordingLabel(); recorder.stop(); }
const talk = $<HTMLButtonElement>('talk');
bindMicControls(talk, $('dock'), { active: () => !!recorder, start, release });
$('stop').onclick = () => { voice.bargeIn(); voice.resume(); unlock(); recorder?.cancel(); pendingStop = !send({ type: 'stop' }); if (pendingStop) void connect(); state = initialState(); render(); cue(true); talk.focus(); };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
function button(text: string, action: () => void) { const node = element('button', text); node.type = 'button'; node.onclick = () => { if (!node.isConnected || node.disabled) return; unlock(); action(); }; return node; }
function safeLink(url: string, text: string) { try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return undefined; const link = element('a', text); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; } catch { return undefined; } }
function primary<T extends HTMLElement>(node: T) { node.id = 'primary-content'; if (!['A', 'BUTTON'].includes(node.tagName)) node.tabIndex = -1; return node; }
const money = (amount: number) => new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(amount);
function renderFeed() {
  $('feed').hidden = new URLSearchParams(location.search).get('debug') !== '1';
  if ($('feed').hidden) return;
  const list = $('feed-items'); list.replaceChildren();
  for (const item of state.feed) { const row = element('li', item.text); const link = item.source && safeLink(item.source, t().source); if (link) row.append(' ', link); list.append(row); }
}
function render() {
  $('stage').textContent = stages[language][state.stage]; recordingLabel();
  const actions = $('actions'); const focused = document.activeElement as HTMLElement | null;
  const restore = focused && actions.contains(focused) ? focused.id : undefined;
  actions.replaceChildren();
  if (!collectingProfile && ['PRESENT', 'CHOOSE'].includes(state.stage)) {
    for (const [index, option] of state.options.entries()) {
      const choice = button('', () => { const event = optionEvent(state.options, option.id); if (event && send(event)) for (const button of actions.querySelectorAll<HTMLButtonElement>('.option-card')) button.disabled = true; });
      choice.id = 'option-' + option.id; choice.className = 'option-card';
      const name = `${index + 1}. ${optionLabel(option, language)}`;
      const arrival = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(Date.now() + (option.pickup_wait_minutes + option.journey_minutes) * 60_000));
      const details = `${t().arrival} ${arrival} · ${language === 'fr' ? 'environ' : 'about'} ${money(option.price)}`;
      choice.setAttribute('aria-label', `${name}. ${details}`);
      const meta = element('span', details); meta.className = 'detail'; choice.append(element('span', name), meta);
      actions.append(index === 0 ? primary(choice) : choice);
    }
  }
  if (state.yesNo) {
    const decisions = element('div'); decisions.className = 'decision';
    decisions.setAttribute('aria-label', t().confirm);
    const decision = decisionLabels(language, state.stage);
    const answer = (text: string) => { recorder?.cancel(); voice.bargeIn(); voice.resume(); sendTranscript(text); };
    const yes = button(decision.yes, () => answer(language === 'fr' ? 'oui' : 'yes')); yes.id = 'confirm-yes'; yes.setAttribute('aria-label', decision.yes);
    const no = button(decision.no, () => answer(language === 'fr' ? 'non' : 'no')); no.id = 'confirm-no'; no.className = 'secondary'; no.setAttribute('aria-label', decision.no);
    decisions.append(yes, no); actions.append(primary(decisions));
  }
  if (['HANDOFF', 'AWAIT_PAYMENT'].includes(state.stage) && state.payment) {
    const link = safeLink(state.payment.url, t().payment + ' — ' + money(state.payment.amount) + ' — ' + state.payment.merchant);
    if (link) { link.className = 'payment'; link.setAttribute('aria-label', link.textContent!); link.textContent = t().payment; actions.append(primary(link)); }
  }
  if (state.stage === 'DONE' && state.booking) {
    const booking = state.booking; const card = primary(element('article')); card.className = 'booking-card'; card.setAttribute('aria-labelledby', 'booking-heading');
    const heading = element('h2', t().booking); heading.id = 'booking-heading';
    const pickup = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(booking.pickup_time));
    card.append(heading, element('p', `${pickup} · ${booking.pickup_point}`), element('p', `${t().ref} ${booking.ref} · ${money(booking.price)}`)); actions.append(card);
  }
  document.body.dataset.cards = String(actions.children.length > 0);
  const cards = Array.from(actions.children).filter((node) => node.className !== 'decision').map((node) => node.tagName === 'A' || node.tagName === 'BUTTON' ? node.getAttribute('aria-label') ?? node.textContent : node.textContent).join('. ');
  if (cards !== lastCards) { lastCards = cards; if (cards) { voice.enqueue(cards, 'cards'); lastNarrated = Date.now(); } }
  {
    const target = document.getElementById('primary-content');
    if (pendingFocus && target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center' }); pendingFocus = undefined; }
    else if (pendingFocus && !['PRESENT', 'CHOOSE', 'CONFIRM', 'HANDOFF', 'AWAIT_PAYMENT', 'DONE'].includes(state.stage)) pendingFocus = undefined;
    else if (restore) document.getElementById(restore)?.focus({ preventScroll: true });
  }
  renderFeed();
}
function localize() {
  document.documentElement.lang = language; document.title = t().title;
  $('stop').textContent = t().stop;
  if (!lastSay) announce(t().welcome);
  render();
}
localize(); connection(false); void connect();
