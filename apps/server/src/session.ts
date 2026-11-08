import { ProfileSchema, ScenarioSchema, TripSchema, WebEventSchema, resolveTaxiQuote, type WatchPayload, type TaxiQuote, type Booking, type Gps, type Option, type TravelerProfile, type Scenario, type ServerEvent, type Trip } from '@voila/shared';
import { randomUUID } from 'node:crypto';
import { understand } from './understand.js';
import { getDemoDisruption, type Disruption } from './adapters/disruption.js';
import { readRerBTraffic } from './adapters/traffic-h.js';
import { searchDisruptionAndAlternatives } from './adapters/linkup.js';
import { bookingErrorMessage, runBooking, type BookingAction } from './booking.js';
import { publicShuttleUrl } from './booking-cli.js';
import { assessOptions } from './feasibility.js';
import { bookingMethods, isAirport, mergeOptions, optionsForTrip } from './options.js';
import { chooseOption } from './choose.js';
import { say, type NarrationParams } from './narrate.js';
import { converse, type ConfirmationContext, type Turn, type TurnInput, type TurnResult } from './converse.js';
import { sanitizeConfirmationFields } from './confirmation.js';
import { fallbackQuestion } from './questions.js';
import { VoiceProfile, forgetDetails, redactContactText } from './voice-profile.js';
import { mentionsTaxiRequest, requestsTaxi, taxiTurn } from './taxi.js';
import { relevantLines, trafficPage } from './stations.js';
import { resolveGpsOrigin, redactGpsCoordinates } from './location.js';
import { confirmationAnswer } from './confirmation-answer.js';
import { sanitizeWatchEvent } from './watch-privacy.js';

type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
type Research = { traffic: Disruption[]; extraOptions: Option[] };
const userPayment = Symbol('user-payment');
export interface SessionPorts {
  understand: typeof understand;
  converse: typeof converse;
  trafficH: typeof readRerBTraffic;
  linkup: typeof searchDisruptionAndAlternatives;
  runBooking: typeof runBooking;
  clock: () => Date;
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>;
  logger: Pick<Console, 'error'>;
  shuttlePublicUrl: () => string | undefined;
  resolveOrigin: typeof resolveGpsOrigin;
  resolveFare: typeof resolveTaxiQuote;
}

export class VoilaSession {
  private stepSink?: (event: WatchPayload) => void;
  watchSteps(sink: (event: WatchPayload) => void) { this.stepSink = sink; }
  watchEvent(event: Parameters<typeof sanitizeWatchEvent>[0]) { return sanitizeWatchEvent(event, this.profile && { ...this.profile, name: this.bookingName || this.profile.name }, { collecting: !!this.profileCollector, payment: this.agentPaymentPage || ['HANDOFF', 'AWAIT_PAYMENT'].includes(this.stage) }); }
  private agentPaymentPage = false;
  get language() { return this.profile?.language ?? 'fr'; }
  stage: Stage = 'LISTEN';
  private profile?: TravelerProfile;
  private bookingName?: string;
  private profileCollector?: VoiceProfile;
  private pendingProfileOption?: string;
  private retryOption?: string;
  private scenario: Scenario = 'demo';
  private gps?: Gps;
  private locationAttempted = false;
  private locationRequest?: string;
  private locationTimer?: ReturnType<typeof setTimeout>;
  private locationTranscript = '';
  private pendingOrigin?: string;
  private pendingGps?: Gps;
  private pickupGps?: Gps;
  private taxiQuote?: TaxiQuote;
  private locationResolving = false;
  private trip: Partial<Trip> = {};
  private options: Option[] = [];
  private booking?: Booking;
  private payment?: Extract<ServerEvent, { type: 'payment_handoff' }>;
  private paidRefs = new Set<string | symbol>();
  private generation = 0;
  private flow = new AbortController();
  private bookingController?: AbortController;
  private research?: Promise<Research>;
  private confirmation?: { summary: string; details: ConfirmationContext; resolve: (decision: { approved: boolean; reply: string }) => void };
  private history: Turn[] = [];
  private turnVersion = 0;
  private turnController?: AbortController;
  private attempt = 0;
  private lastText?: string;
  private questionReplies: string[] = [];
  private questionAsked = false;
  private lastSay: number;
  private lastHeartbeat = -Infinity;
  private progressVariant = 0;
  private pendingBookingAction?: BookingAction;
  private heartbeat: ReturnType<typeof setInterval>;
  private readonly ports: SessionPorts;
  private operations = new Set<symbol>();
  private lastActivity?: boolean;

  constructor(private emit: (event: ServerEvent) => void, ports: Partial<SessionPorts> = {}) {
    this.ports = { understand, converse, trafficH: readRerBTraffic, linkup: searchDisruptionAndAlternatives, runBooking,
      clock: () => new Date(), timers: globalThis, logger: console, shuttlePublicUrl: () => process.env.SHUTTLE_PUBLIC_URL, resolveOrigin: resolveGpsOrigin, resolveFare: resolveTaxiQuote, ...ports };
    this.lastSay = this.ports.clock().getTime();
    this.heartbeat = this.ports.timers.setInterval(() => {
      const now = this.ports.clock().getTime();
      if (['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(this.stage) && now - this.lastSay >= 25_000 && now - this.lastHeartbeat >= 25_000) {
        this.lastHeartbeat = now;
        let text = this.pendingBookingAction ? say('booking-action', { action: this.pendingBookingAction }, this.language) : say('still-working', { variant: this.progressVariant++ }, this.language);
        this.pendingBookingAction = undefined;
        if (text === this.lastText) text = say('still-working', { variant: this.progressVariant++ }, this.language);
        if (text === this.lastText) text = say('still-working', { variant: this.progressVariant++ }, this.language);
        this.answer(text, true);
      }
    }, 1000);
    this.heartbeat.unref?.();
  }

  attach(emit: (event: ServerEvent) => void) {
    this.emit = emit;
    this.send({ type: 'stage', stage: this.stage });
    if (this.stage === 'CONFIRM' && this.confirmation) this.send({ type: 'confirm', summary: this.confirmation.summary });
    if (['HANDOFF', 'AWAIT_PAYMENT'].includes(this.stage) && this.payment) this.send(this.payment);
    if (this.stage === 'CHOOSE') this.send({ type: 'options', items: this.options });
    if (this.stage === 'DONE' && this.booking) this.send({ type: 'booking_card', booking: this.booking });
    if (this.profile) this.send({ type: 'profile', profile: this.profile });
    if (this.profileCollector) this.profilePrompt(this.profileCollector.question);
    if (this.locationRequest) this.send({ type: 'location_request', request_id: this.locationRequest });
    if (this.pendingOrigin) this.confirmOrigin();
    this.reportActivity(true);
    return () => { if (this.emit === emit) this.emit = () => {}; };
  }

  handle(input: unknown): void {
    const parsed = WebEventSchema.safeParse(input);
    if (!parsed.success) { this.error('Invalid web event.'); return; }
    const event = parsed.data;
    if (event.type === 'stop') { this.stop(); return; }
    if (event.type === 'language') {
      if (this.profile) this.profile.language = event.language;
      if (this.profileCollector) this.profileCollector.profile.language = event.language;
      return;
    }
    if (event.type === 'hello') {
      if (this.profile) { if (!event.watch) this.error('Profile already set; reconnect without restarting the trip.'); return; }
      this.profile = event.profile;
      this.scenario = event.scenario ?? (ScenarioSchema.safeParse(process.env.VOILA_SCENARIO).data ?? 'demo');
      this.gps = event.gps ?? undefined;
      this.transition('LISTEN');
      return;
    }
    if (!this.profile) { this.error('Send hello first.'); return; }
    if (event.type === 'location_result') { this.locationResult(event.request_id, event.gps); return; }
    if ((event.type === 'final_transcript' || event.type === 'user_reply') && forgetDetails(event.text)) {
      this.resetTrip(); this.profile = { language: this.language };
      this.send({ type: 'profile', profile: this.profile }); this.transition('LISTEN');
      this.send({ type: 'say', text: this.language.startsWith('fr') ? 'Vos informations sont effacées de cet appareil et de cette session.' : 'Your details are cleared from this device and session.' }); return;
    }
    if ((event.type === 'final_transcript' || event.type === 'user_reply') && /^(stop|arrete|arretez|annule|cancel)[.!? ]*$/.test(event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim())) { this.stop(); return; }
    if (event.type === 'user_reply' && this.pendingOrigin) {
      const reply = event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      if (confirmationAnswer(event.text) === 'yes') {
        this.remember('user', event.text);
        this.trip.origin = this.pendingOrigin; this.pendingOrigin = undefined;
        this.pickupGps = this.pendingGps; this.pendingGps = undefined;
        this.speak('origin-confirmed', { origin: this.trip.origin });
        void this.plan('', ++this.generation);
        return;
      } else if (confirmationAnswer(event.text) === 'no') {
        this.remember('user', event.text);
        this.pendingOrigin = undefined; this.pendingGps = undefined; this.pickupGps = undefined; this.gps = undefined;
        this.ask(say('clarify-origin', {}, this.language));
        return;
      } else if (/^(non|nan|no)\b/.test(reply)) {
        this.pendingOrigin = undefined; this.pendingGps = undefined; this.pickupGps = undefined; this.gps = undefined;
      } else { this.remember('user', event.text); this.confirmOrigin(); return; }
    }
    if (event.type === 'user_reply' && ['HANDOFF', 'AWAIT_PAYMENT'].includes(this.stage) && this.payment && /^\/stub-payment\/[^/]+$/.test(new URL(this.payment.url).pathname) && /^(j ai paye|jai paye|i ve paid|i have paid|i paid)$/.test(event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim())) { this.handle({ type: 'paid' }); return; }
    if (event.type === 'user_reply' && this.profileCollector) {
      const field = this.profileCollector.field;
      const response = this.profileCollector.reply(event.text);
      this.profile = this.profileCollector.profile;
      if (response.changed && field === 'guide_dog') this.trip.guide_dog = this.profile.guide_dog;
      if (response.changed) this.send({ type: 'profile', profile: this.profile });
      if (response.complete) {
        const id = this.pendingProfileOption!; this.profileCollector = undefined; this.pendingProfileOption = undefined;
        this.send({ type: 'say', text: this.language.startsWith('fr') ? 'Vos informations sont enregistrées sur cet appareil. Pour les effacer, dites « efface mes informations ».' : 'Your details are saved on this device. To clear them, say “forget my details”.' });
        this.trip.guide_dog ??= this.profile.guide_dog ?? false; this.select(id);
      } else this.profilePrompt(response.text);
      return;
    }
    if (event.type === 'final_transcript' && ['LISTEN', 'DONE'].includes(this.stage)) {
      if (!event.text.trim()) { this.error('Transcript must not be empty.'); return; }
      const restarting = this.stage === 'DONE';
      this.resetTrip();
      if (restarting) this.transition('LISTEN');
      this.flow = new AbortController();
      const generation = ++this.generation;
      this.lastHeartbeat = -Infinity;
      this.trip = {};
      this.remember('user', event.text);
      this.transition('UNDERSTAND');
      this.speak('acknowledgement', {});
      this.speak('research-started', {});
      void this.interpret(event.text, generation);
    } else if (event.type === 'user_reply') {
      if (!event.text.trim()) { this.error('Reply must not be empty.'); return; }
      this.turnController?.abort(); ++this.turnVersion;
      this.remember('user', event.text);
      const normalized = event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      if (this.stage === 'CHOOSE') {
        if (this.retryOption && (confirmationAnswer(event.text) === 'yes' || /^(retry|reessaye|reessayez|try again)$/.test(normalized))) { this.select(this.retryOption); return; }
        const id = chooseOption(event.text, this.options);
        if (id) { this.select(id); return; }
      }
      if (this.stage === 'CONFIRM' && this.confirmation) {
        const yes = confirmationAnswer(event.text) === 'yes' || /^(y|vas y|go ahead)$/.test(normalized);
        const no = confirmationAnswer(event.text) === 'no' || /^(n|attends|attendez|wait|not yet|pas encore)$/.test(normalized);
        if (yes || no) { this.decide(yes, event.text); return; }
      }
      if (['CLARIFY', 'CHOOSE', 'CONFIRM', 'UNDERSTAND', 'PRESENT', 'RESEARCH', 'EXECUTE', 'HANDOFF', 'AWAIT_PAYMENT'].includes(this.stage)) void this.interpretTurn(event.text);
      else this.error(`Event ${event.type} is not allowed in ${this.stage}.`);
    } else if (event.type === 'paid' && this.stage === 'HANDOFF' && this.payment) {
      this.paidRefs.add(userPayment);
    } else if (event.type === 'paid' && this.stage === 'AWAIT_PAYMENT' && this.booking) {
      this.markPaid(this.booking.ref);
    } else this.error(`Event ${event.type} is not allowed in ${this.stage}.`);
  }

  markPaid(orderRef: string): boolean {
    if (!this.booking && ['EXECUTE', 'CONFIRM', 'HANDOFF'].includes(this.stage)) {
      this.paidRefs.add(orderRef);
      return true;
    }
    if (this.booking?.ref !== orderRef) return false;
    if (this.stage === 'DONE') return true;
    if (this.stage !== 'AWAIT_PAYMENT') return false;
    this.finishPayment();
    return true;
  }

  private finishPayment() {
    this.transition('DONE');
    this.send({ type: 'booking_card', booking: this.booking! });
    this.speak('booking-done', { ref: this.booking!.ref });
  }

  dispose() { this.cancel(); this.ports.timers.clearInterval(this.heartbeat); this.emit = () => {}; }
  private send(event: ServerEvent) {
    try {
      const safe = JSON.stringify(event, (_key, value: unknown) => {
        if (typeof value !== 'string') return value;
        let text = redactGpsCoordinates(value);
        const unit = String.raw`(?:[€$£¥%°]|EUR|USD|GBP|CHF|CAD|euros?|dollars?|pounds?|km|cm|mm|m|mètres?|metres?|meters?|kilomètres?|kilometres?|kilometers?|kg|g|ml|l|h|min|minutes?|s|sec|secondes?|seconds?)(?!\p{L})`;
        for (const gps of [this.pendingGps, this.pickupGps]) if (gps) for (const coordinate of [gps.latitude, gps.longitude]) {
          const forms = [String(coordinate), ...[4, 5, 6, 7, 8].map((digits) => coordinate.toFixed(digits))].filter((form) => /\.\d{4,}$/.test(form)).flatMap((form) => [form, form.replace('.', ',')]);
          for (const form of [...new Set(forms)].sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(`(?<![\\d.,])${form.replace(/[.,]/g, '\\$&')}(?!\\d|[.,]\\d)`, 'g'), (match, offset: number, source: string) => {
            const before = source.slice(0, offset), after = source.slice(offset + match.length);
            return new RegExp(`(?<!\\p{L})${unit}\\s*$`, 'iu').test(before) || new RegExp(`^\\s*${unit}`, 'iu').test(after) ? match : '[position]';
          });
        }
        return text;
      });
      this.emit(JSON.parse(safe));
    } catch { this.ports.logger.error('Session event delivery failed.'); }
  }
  private error(message: string) { this.send({ type: 'error', message }); }
  private transition(stage: Stage) {
    if (this.stage === 'EXECUTE' && stage !== 'EXECUTE') this.pendingBookingAction = undefined;
    if (stage !== this.stage) { this.attempt = 0; this.questionReplies = []; this.questionAsked = ['CHOOSE', 'CONFIRM'].includes(stage); }
    this.lastHeartbeat = -Infinity; this.stage = stage; this.send({ type: 'stage', stage });
    this.reportActivity();
  }
  private reportActivity(force = false) {
    const cancellable = !['LISTEN', 'DONE'].includes(this.stage) && (this.operations.size > 0 || !!this.confirmation || (!!this.payment && ['HANDOFF', 'AWAIT_PAYMENT'].includes(this.stage)));
    if (force || cancellable !== this.lastActivity) { this.lastActivity = cancellable; this.send({ type: 'activity', cancellable }); }
  }
  private beginOperation() {
    const id = Symbol(); this.operations.add(id); this.reportActivity();
    return () => { if (this.operations.delete(id)) this.reportActivity(); };
  }
  private speak<K extends keyof NarrationParams>(key: K, params: NarrationParams[K]) {
    const text = say(key, params, this.profile?.language ?? 'en');
    const progress = ['still-working', 'booking-page', 'research-started', 'booking-retry'].includes(key);
    if (progress && text === this.lastText) return;
    this.answer(text, progress);
  }
  private active(generation: number) { return generation === this.generation && !this.flow.signal.aborted; }
  private cancel() {
    this.ports.timers.clearTimeout(this.locationTimer); this.locationTimer = undefined;
    this.locationRequest = undefined; this.pendingOrigin = undefined;
    this.pendingGps = undefined; this.pickupGps = undefined; this.locationResolving = false;
    this.taxiQuote = undefined;
    this.pendingBookingAction = undefined;
    this.profileCollector = undefined; this.pendingProfileOption = undefined;
    this.operations.clear();
    this.turnController?.abort(); ++this.turnVersion;
    ++this.generation;
    this.flow.abort();
    this.bookingController?.abort();
    this.confirmation?.resolve({ approved: false, reply: 'Stopped' });
    this.confirmation = undefined;
    this.paidRefs.clear();
  }
  private resetTrip() {
    this.pendingBookingAction = undefined;
    this.cancel();
    this.bookingName = undefined;
    this.history = []; this.attempt = 0; this.questionReplies = []; this.questionAsked = false;
    this.research = undefined; this.booking = undefined; this.payment = undefined; this.options = []; this.trip = {};
    this.retryOption = undefined;
    this.locationAttempted = false; this.locationTranscript = '';
  }
  private stop() {
    this.resetTrip();
    this.speak('stopped', {});
    this.transition('LISTEN');
  }
  private async limited<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, parent: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => { reject(new Error('Operation cancelled.')); controller.abort(); };
      parent.addEventListener('abort', abort, { once: true });
      timer = this.ports.timers.setTimeout(() => { reject(new Error('Operation timed out.')); controller.abort(); }, ms);
      if (parent.aborted) abort();
    });
    try { return await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); }), interrupted]); }
    finally { this.ports.timers.clearTimeout(timer); parent.removeEventListener('abort', abort); controller.abort(); }
  }
  private async startResearch(transcript: string, generation: number): Promise<Research> {
    const finish = this.beginOperation();
    try {
    const parent = this.flow.signal;
    const lines = relevantLines(this.trip.origin ?? '', this.trip.destination ?? '');
    const traffic = async (line: string): Promise<Disruption> => {
      if (this.scenario === 'demo') return { ...await getDemoDisruption(line), line };
      try { return { ...await this.limited((signal) => this.ports.trafficH({ signal, now: this.ports.clock(), line }), 46_000, parent), line }; }
      catch {
        parent.throwIfAborted();
        return { line, status: 'unknown', mode: 'live', summary: `${line}: current traffic unknown.`, cause: '', source: trafficPage(line), recorded: false };
      }
    };
    const trafficResult = Promise.all(lines.map((line) => traffic(line).then((disruption) => {
      if (this.active(generation)) this.send({ type: 'feed', kind: 'traffic', text: `${disruption.mode}${disruption.recorded ? ' — recorded data' : ''} — ${disruption.summary}`, source: disruption.source, mode: disruption.mode, status: disruption.status });
      return disruption;
    })));
    const linkup = this.scenario === 'demo' ? Promise.resolve([] as Option[]) : this.limited((signal) => this.ports.linkup({
      query: redactGpsCoordinates(`Transport disruption and alternatives for this request today ${this.ports.clock().toISOString()}. From ${this.trip.origin} to ${this.trip.destination}. ${redactContactText(transcript, this.profile)}`), signal,
    }), 9000, parent).then((result) => {
      if (this.active(generation)) for (const item of result.corroboration) {
        for (const source of item.sources) this.send({ type: 'feed', kind: 'research', text: item.text, source });
      }
      return result.extraOptions;
    }).catch(() => { if (this.active(generation)) this.ports.logger.error('Linkup research unavailable; retaining preset options.'); return []; });
    const [reports, extraOptions] = await Promise.all([trafficResult, linkup]);
    return { traffic: reports, extraOptions };
    } finally { finish(); }
  }
  private async interpret(transcript: string, generation: number) {
    const finish = this.beginOperation();
    try {
      const result = await this.limited((signal) => this.ports.understand({ transcript: redactGpsCoordinates(redactContactText(transcript, this.profile)), profile: this.profile!, now: this.ports.clock(), previous: this.trip, signal }), 20_500, this.flow.signal);
      if (!this.active(generation)) return;
      this.trip = { passengers: 1, luggage: 0, guide_dog: this.profile!.guide_dog ?? false, ...this.trip, ...result.trip };
      await this.plan(transcript, generation);
    } catch {
      if (!this.active(generation)) return;
      this.ports.logger.error('Trip understanding failed.');
      if (mentionsTaxiRequest(transcript)) { this.transition('CLARIFY'); this.ask(taxiTurn({ transcript, stage: this.stage, language: this.language, trip: this.trip, options: this.options, now: this.ports.clock(), attempt: this.attempt }, { intent: 'unclear', confidence: 0, reply: '' }).reply); return; }
      this.error('Could not understand the trip. Please try again.');
      this.answer(this.fallback());
      this.cancel(); this.transition('LISTEN');
    } finally { finish(); }
  }
  private missing() { return (['origin', 'destination'] as const).filter((key) => !this.trip[key]); }
  private remember(role: Turn['role'], text: string) { this.history = [...this.history, { role, text: redactGpsCoordinates(redactContactText(text, this.profile)) }].slice(-10); }
  private confirmOrigin() {
    const question = say('confirm-origin', { origin: this.pendingOrigin! }, this.language);
    this.lastSay = this.ports.clock().getTime();
    this.send({ type: 'clarify', question, yes_no: true }); this.send({ type: 'say', text: question });
  }
  private async locate(gps: Gps, generation: number) {
    const version = this.turnVersion, finish = this.beginOperation();
    this.locationResolving = true;
    try {
      const label = await this.ports.resolveOrigin(gps, { signal: this.flow.signal });
      if (!this.active(generation) || this.turnVersion !== version || this.trip.origin || this.stage !== 'CLARIFY') return;
      if (label) { this.pendingOrigin = label; this.pendingGps = gps; this.confirmOrigin(); }
      else this.ask(say('clarify-origin', {}, this.language));
    } catch { if (this.active(generation) && this.turnVersion === version && !this.trip.origin) this.ask(say('clarify-origin', {}, this.language)); }
    finally { if (this.active(generation)) this.locationResolving = false; finish(); }
  }
  private locationResult(requestId: string, gps: Gps | null) {
    if (requestId !== this.locationRequest || this.stage !== 'CLARIFY' || this.trip.origin) return;
    this.ports.timers.clearTimeout(this.locationTimer); this.locationTimer = undefined; this.locationRequest = undefined;
    if (gps) void this.locate(gps, this.generation);
    else void this.plan(this.locationTranscript, this.generation);
  }
  private profilePrompt(question: string) {
    this.lastSay = this.ports.clock().getTime();
    this.send({ type: 'profile_request', question, yes_no: this.profileCollector?.yesNo ?? false }); this.send({ type: 'say', text: question });
  }
  private select(id: string) {
    const method = bookingMethods[id];
    if (!method || !this.options.some((option) => option.id === id)) { this.error('No supported booking method for this option.'); return; }
    const collector = new VoiceProfile(this.profile!, ['guide_dog']);
    if (collector.field) { this.profileCollector = collector; this.pendingProfileOption = id; this.profilePrompt(collector.question); return; }
    const option = this.options.find((item) => item.id === id)!;
    if (this.trip.guide_dog && option.guide_dog_status === 'refused') { this.speak('choose-again', {}); return; }
    this.attempt = 0;
    if (method.kind === 'manual') { this.speak('manual-instructions', { id, instructions: method.instructions }); this.transition('DONE'); }
    else void this.execute(id, this.generation);
  }
  private decide(approved: boolean, reply: string) {
    const pending = this.confirmation; if (!pending) return;
    this.confirmation = undefined; this.attempt = 0; this.transition('EXECUTE'); pending.resolve({ approved, reply });
  }
  private answer(text: string, progress = false) {
    if (!progress && text === this.lastText) text = `${this.language === 'fr' ? 'Autrement dit, ' : 'In other words, '}${text.charAt(0).toLocaleLowerCase(this.language) + text.slice(1)}`;
    this.lastText = text;
    this.lastSay = this.ports.clock().getTime(); this.remember('assistant', text); this.send({ type: 'say', text });
  }
  private ask(text: string) {
    if (text === this.lastText || this.questionReplies.includes(text)) {
      const alternative = [0, 1, 2].map((variant) => this.fallback(variant)).find((value) => value !== this.lastText && !this.questionReplies.includes(value));
      text = alternative ?? `${this.language === 'fr' ? 'Nouvel essai' : 'Another attempt'} ${this.attempt + 1}. ${this.fallback()}`;
    }
    this.questionReplies = [...this.questionReplies, text].slice(-10); this.questionAsked = true;
    if (this.stage === 'CLARIFY') this.send({ type: 'clarify', question: text });
    this.answer(text);
  }
  private fallback(variant = 0) {
    return fallbackQuestion({ stage: this.stage, language: this.language, missing: this.missing(), options: this.options, now: this.ports.clock(), attempt: this.attempt, variant });
  }
  private async interpretTurn(transcript: string) {
    const generation = this.generation, stage = this.stage, version = this.turnVersion;
    const controller = new AbortController(); this.turnController = controller;
    let result: TurnResult;
    const finish = this.beginOperation();
    try {
      const context: Pick<TurnInput, 'trip' | 'options' | 'confirmation' | 'history'> = JSON.parse(redactGpsCoordinates(JSON.stringify({ trip: this.trip, options: this.options, confirmation: this.confirmation?.details, history: this.history })));
      result = await this.limited((signal) => this.ports.converse({ ...context, transcript: redactGpsCoordinates(redactContactText(transcript, this.profile)), stage, language: this.language, missing: this.missing(), attempt: this.attempt, now: this.ports.clock(), signal }), 20_500, controller.signal);
    } catch { result = { intent: 'unclear', confidence: 0, reply: this.fallback() }; }
    finally { finish(); if (this.turnController === controller) this.turnController = undefined; }
    if (!this.active(generation) || this.stage !== stage || this.turnVersion !== version || controller.signal.aborted) return;
    result = taxiTurn({ transcript, stage, language: this.language, trip: this.trip, options: this.options, now: this.ports.clock(), attempt: this.attempt }, result);
    if (this.trip.origin && result.trip_patch?.origin === redactGpsCoordinates(this.trip.origin)) result.trip_patch.origin = this.trip.origin;
    if (result.intent !== 'unclear' && /^(euh|uh|um|hmm|(?:euh[, ]+)?je (?:ne )?sais pas|i don.t know|not sure)[.!? ]*$/i.test(transcript.trim())) result = { intent: 'unclear', confidence: 0, reply: this.fallback() };
    if (result.intent === 'stop' && result.confidence >= .65) { this.stop(); return; }
    if (this.pendingOrigin && !(['provide_info', 'correct'].includes(result.intent) && result.confidence >= .65 && result.trip_patch?.origin)) { this.confirmOrigin(); return; }
    if (stage === 'CONFIRM') {
      const uncertain = /\b(euh|maybe|perhaps|unsure|not|non|no|pas|attends|demain|tomorrow)\b/i.test(transcript);
      if (result.intent === 'confirm' && result.confidence >= .9 && !uncertain && !Object.keys(result.trip_patch ?? {}).length) { this.answer(result.reply); this.decide(true, transcript); return; }
      if (['decline', 'correct'].includes(result.intent) && result.confidence >= .65) { this.answer(result.reply); this.decide(false, transcript); return; }
      if (result.intent === 'confirm') result = { intent: 'unclear', reply: this.fallback(), confidence: 0 };
    }
    if (['CLARIFY', 'CHOOSE', 'UNDERSTAND', 'RESEARCH', 'PRESENT'].includes(stage) && ['provide_info', 'correct'].includes(result.intent) && result.confidence >= .65 && result.trip_patch && Object.keys(result.trip_patch).length) {
      const before = this.trip;
      if (result.trip_patch.origin && result.trip_patch.origin !== before.origin) this.pickupGps = undefined;
      this.trip = TripSchema.partial().parse({ passengers: 1, luggage: 0, guide_dog: this.profile?.guide_dog ?? false, ...this.trip, ...result.trip_patch }); this.attempt = 0;
      const changedRoute = ['origin', 'destination', 'deadline'].some((key) => before[key as keyof Trip] !== undefined && before[key as keyof Trip] !== this.trip[key as keyof Trip]);
      const next = ++this.generation;
      if (changedRoute || !this.research) { this.flow.abort(); this.flow = new AbortController(); this.research = undefined; this.locationResolving = false; }
      this.options = [];
      if (!this.missing().length) this.answer(result.reply);
      await this.plan(transcript, next, result.reply);
      if (this.stage === 'CHOOSE' && requestsTaxi(transcript) && this.options.some((option) => option.id === 'paris-airport-shuttle')) this.select('paris-airport-shuttle');
      return;
    }
    if (['CLARIFY', 'CHOOSE', 'PRESENT'].includes(stage) && result.intent === 'choose' && result.confidence >= .65 && result.option_id && this.options.some((option) => option.id === result.option_id)) { this.answer(result.reply); this.transition('CHOOSE'); this.select(result.option_id); return; }
    if (['CLARIFY', 'CHOOSE', 'CONFIRM'].includes(stage)) {
      if (result.intent !== 'question' && this.questionAsked) ++this.attempt;
      if (result.intent === 'question' && stage !== 'CLARIFY') this.answer(result.reply);
      else this.ask(this.attempt >= 2 ? this.fallback() : result.reply);
    } else this.answer(result.reply);
  }
  private async plan(transcript: string, generation: number, question?: string) {
    try {
      if (this.trip.origin) { this.ports.timers.clearTimeout(this.locationTimer); this.locationRequest = undefined; this.pendingOrigin = undefined; }
      if (this.missing().length) {
        this.transition('CLARIFY');
        if (!this.trip.origin && !this.locationAttempted) {
          this.locationAttempted = true; this.locationTranscript = transcript;
          if (this.gps) { const gps = this.gps; this.gps = undefined; await this.locate(gps, generation); }
          else {
            const request_id = randomUUID(); this.locationRequest = request_id;
            this.speak('location-request', {}); this.send({ type: 'location_request', request_id });
            this.locationTimer = this.ports.timers.setTimeout(() => this.locationResult(request_id, null), 11_000);
          }
          return;
        }
        if (this.locationRequest || this.pendingOrigin || this.locationResolving) return;
        if (question) this.ask(question); else await this.interpretTurn(transcript);
        return;
      }
      const trip = TripSchema.parse(this.trip);
      this.transition('RESEARCH');
      this.research ??= this.startResearch(transcript, generation);
      const research = await this.research;
      if (!this.active(generation)) return;
      const rerBDisrupted = research.traffic.some((report) => report.line === 'RER B' && report.status === 'disrupted');
      const fare = await this.ports.resolveFare(trip, { now: this.ports.clock(), gps: this.pickupGps, signal: this.flow.signal });
      if (!this.active(generation)) return;
      this.taxiQuote = fare;
      const local = optionsForTrip(trip, rerBDisrupted, this.taxiQuote);
      const catalogue = mergeOptions(local, research.extraOptions).filter((option) => bookingMethods[option.id] &&
        (option.id !== 'rer-b-replacement-bus' || local.some((item) => item.id === 'rer-b-replacement-bus'))).map((option) => {
        const contextual = local.find((item) => item.id === option.id);
        return contextual ? { ...option, name: contextual.name, price: contextual.price, journey_minutes: contextual.journey_minutes, pickup_wait_minutes: contextual.pickup_wait_minutes } : option;
      });
      const assessed = assessOptions(catalogue, trip, this.ports.clock());
      this.options = assessed.feasible;
      this.transition('PRESENT');
      this.send({ type: 'options', items: this.options });
      for (const report of research.traffic) {
        if (report.line === 'RER B' && report.recorded) this.speak('disruption', { ...report, airport: isAirport(trip.destination), origin: !/gare du nord/i.test(trip.origin) || !isAirport(trip.destination) ? trip.origin : undefined });
        else this.speak('traffic-line', report);
      }
      if (!research.traffic.length) this.speak('traffic-line', { mode: this.scenario, status: 'unknown', summary: '' });
      if (this.options.length) this.speak('present-options', { options: this.options, now: this.ports.clock() });
      else if (!catalogue.length) this.speak('no-known-options', {});
      else this.speak('no-feasible-options', { rejected: assessed.rejected.map(({ option, reason }) => ({ id: option.id, name: option.name, reason })) });
      this.transition('CHOOSE');
    } catch {
      if (!this.active(generation)) return;
      this.ports.logger.error('Trip understanding failed.');
      this.error('Could not understand the trip. Please try again.');
      this.cancel(); this.transition('LISTEN');
      this.answer(this.language.startsWith('fr') ? 'Je n’ai pas pu préparer le trajet. Veuillez réessayer.' : 'I could not prepare the journey. Please try again.');
    }
  }
  private async execute(id: string, generation: number) {
    this.retryOption = undefined;
    this.paidRefs.clear();
    this.payment = undefined;
    this.transition('EXECUTE');
    const finish = this.beginOperation();
    const controller = new AbortController();
    this.bookingController = controller;
    const current = () => this.active(generation) && !controller.signal.aborted;
    try {
      const option = this.options.find((item) => item.id === id)!;
      const trip = TripSchema.parse(this.trip);
      const base = publicShuttleUrl(this.ports.shuttlePublicUrl());
      const startUrl = base.pathname === '/' ? new URL('/fr/reservation/', base) : base;
      if (base.searchParams.get('difficulty') === 'easy') startUrl.searchParams.set('difficulty', 'easy');
      this.agentPaymentPage = false;
      const profile = ProfileSchema.parse({ phone: process.env.VOILA_DEFAULT_PHONE || '+33612345678', ...this.profile, name: ProfileSchema.shape.name.trim().parse(this.profile?.name || process.env.VOILA_DEFAULT_NAME || 'Karim Demo'), email: this.profile?.email || process.env.VOILA_DEFAULT_EMAIL || 'karim@example.com', guide_dog: trip.guide_dog });
      this.bookingName = profile.name;
      const result = await this.ports.runBooking({
        trip, pickupGps: this.pickupGps, fareQuote: this.taxiQuote, journeyMinutes: option.journey_minutes, profile, startUrl: startUrl.href, signal: controller.signal,
        onRetry: () => { if (current()) { this.pendingBookingAction = undefined; this.speak('booking-retry', {}); } },
        onAction: (action) => { if (current() && this.stage === 'EXECUTE') this.pendingBookingAction = action; },
        onProgress: (text) => {
          if (!current()) return;
          this.send({ type: 'feed', kind: 'agent', text });
        },
        onStep: (event) => { if (current()) { const safe = this.watchEvent(event); if (safe) this.stepSink?.(safe); } },
        onPage: (page) => { if (current()) this.agentPaymentPage = page === 'payment'; if (current() && this.stage === 'EXECUTE') this.speak('booking-page', { page }); },
        confirm: (summary, details) => {
          if (!current()) return Promise.resolve({ approved: false, reply: 'Stopped' });
          if (this.confirmation) throw new Error('A confirmation is already pending.');
          details = sanitizeConfirmationFields(details);
          if (details.total_price === undefined || details.currency !== 'EUR') return Promise.resolve({ approved: false, reply: 'Read the transfer total price and EUR currency before asking for approval.' });
          summary = say('confirm', { trip, option, details, now: this.ports.clock() }, this.language);
          const decision = new Promise<{ approved: boolean; reply: string }>((resolve) => { this.confirmation = { summary, details: { ...sanitizeConfirmationFields(details), option_name: option.name, guide_dog_status: option.guide_dog_status }, resolve }; });
          this.transition('CONFIRM'); this.send({ type: 'confirm', summary }); this.speak('confirm', { trip, option, details, now: this.ports.clock() });
          return decision;
        },
        onPaymentHandoff: (payment) => {
          if (!current()) return;
          this.payment = { type: 'payment_handoff', url: payment.url, amount: payment.amount, merchant: payment.merchant };
          this.transition('HANDOFF');
          this.send(this.payment);
          this.speak('payment-handoff', payment);
        },
      });
      if (!current()) return;
      this.booking = result.booking;
      if (this.paidRefs.has(this.booking.ref) || this.paidRefs.has(userPayment)) this.finishPayment();
      else this.transition('AWAIT_PAYMENT');
      this.paidRefs.clear();
    } catch (error) {
      if (!current()) return;
      this.confirmation?.resolve({ approved: false, reply: 'Booking failed' }); this.confirmation = undefined;
      this.ports.logger.error(`Booking execution failed: ${bookingErrorMessage(error).slice(0, 300)}`);
      if (this.payment) {
        this.transition('HANDOFF');
        this.answer(this.language.startsWith('fr') ? 'Le paiement reste disponible sur votre téléphone, mais je n’ai pas pu récupérer la référence. Vérifiez la réservation sur le site avant de recommencer une réservation.' : 'Payment remains available on your phone, but I could not retrieve the reference. Check the booking on the site before starting another booking.');
        return;
      }
      this.error(say('booking-failed', {}, this.language));
      this.speak('booking-failed', {});
      this.retryOption = id === 'paris-airport-shuttle' ? id : undefined;
      if (!this.retryOption) this.options = this.options.filter((option) => option.id !== id);
      this.send({ type: 'options', items: this.options });
      this.transition('CHOOSE');
    } finally { controller.abort(); if (this.bookingController === controller) { this.pendingBookingAction = undefined; this.bookingController = undefined; } finish(); }
  }
}
