import { ScenarioSchema, TripSchema, WebEventSchema, type Booking, type Option, type Profile, type Scenario, type ServerEvent, type Trip } from '@voila/shared';
import { understand } from './understand.js';
import { getDemoDisruption, type Disruption } from './adapters/disruption.js';
import { readRerBTraffic, rerBTrafficPage } from './adapters/traffic-h.js';
import { searchDisruptionAndAlternatives } from './adapters/linkup.js';
import { runBooking } from './booking.js';
import { publicShuttleUrl } from './booking-cli.js';
import { assessOptions } from './feasibility.js';
import { bookingMethods, matchesPresetRoute, mergeOptions, presetOptions } from './options.js';
import { chooseOption } from './choose.js';
import { say, type NarrationParams } from './narrate.js';
import { converse, type ConfirmationContext, type Turn, type TurnResult } from './converse.js';
import { sanitizeConfirmationFields } from './confirmation.js';
import { fallbackQuestion } from './questions.js';

type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
type Research = { disruption: Disruption; extraOptions: Option[] };
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
}

export class VoilaSession {
  get language() { return this.profile?.language ?? 'fr'; }
  stage: Stage = 'LISTEN';
  private profile?: Profile;
  private scenario: Scenario = 'demo';
  private gpsOrigin?: string;
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
  private heartbeat: ReturnType<typeof setInterval>;
  private readonly ports: SessionPorts;

  constructor(private emit: (event: ServerEvent) => void, ports: Partial<SessionPorts> = {}) {
    this.ports = { understand, converse, trafficH: readRerBTraffic, linkup: searchDisruptionAndAlternatives, runBooking,
      clock: () => new Date(), timers: globalThis, logger: console, shuttlePublicUrl: () => process.env.SHUTTLE_PUBLIC_URL, ...ports };
    this.lastSay = this.ports.clock().getTime();
    this.heartbeat = this.ports.timers.setInterval(() => {
      const now = this.ports.clock().getTime();
      if (['UNDERSTAND', 'RESEARCH', 'EXECUTE'].includes(this.stage) && now - this.lastSay >= 4000 && now - this.lastHeartbeat >= 15_000) {
        this.lastHeartbeat = now;
        this.speak('still-working', {});
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
    return () => { if (this.emit === emit) this.emit = () => {}; };
  }

  handle(input: unknown): void {
    const parsed = WebEventSchema.safeParse(input);
    if (!parsed.success) { this.error('Invalid web event.'); return; }
    const event = parsed.data;
    if (event.type === 'stop') { this.stop(); return; }
    if (event.type === 'hello') {
      if (this.profile) { this.error('Profile already set; reconnect without restarting the trip.'); return; }
      this.profile = event.profile;
      this.scenario = event.scenario ?? (ScenarioSchema.safeParse(process.env.VOILA_SCENARIO).data ?? 'demo');
      this.gpsOrigin = event.gps ? `${event.gps.latitude}, ${event.gps.longitude}` : undefined;
      this.transition('LISTEN');
      return;
    }
    if (!this.profile) { this.error('Send hello first.'); return; }
    if (event.type === 'final_transcript' && ['LISTEN', 'DONE'].includes(this.stage)) {
      if (!event.text.trim()) { this.error('Transcript must not be empty.'); return; }
      const restarting = this.stage === 'DONE';
      this.resetTrip();
      if (restarting) this.transition('LISTEN');
      this.flow = new AbortController();
      const generation = ++this.generation;
      this.lastHeartbeat = -Infinity;
      this.trip = this.gpsOrigin ? { origin: this.gpsOrigin } : {};
      this.remember('user', event.text);
      this.transition('UNDERSTAND');
      this.speak('acknowledgement', {});
      this.speak('research-started', {});
      this.research = this.startResearch(event.text, generation);
      void this.research.catch(() => {});
      void this.interpret(event.text, generation);
    } else if (event.type === 'user_reply') {
      if (!event.text.trim()) { this.error('Reply must not be empty.'); return; }
      this.turnController?.abort(); ++this.turnVersion;
      this.remember('user', event.text);
      const normalized = event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      if (/^(stop|arrete|arretez|annule|cancel)$/.test(normalized)) { this.stop(); return; }
      if (this.stage === 'CHOOSE') {
        const id = chooseOption(event.text, this.options);
        if (id) { this.select(id); return; }
      }
      if (this.stage === 'CONFIRM' && this.confirmation) {
        const yes = /^(oui|yes|y|ouais|ok|okay|d accord|vas y|go ahead|yes please|bien sur)$/.test(normalized);
        const no = /^(non|no|n|attends|attendez|wait|not yet|pas encore)$/.test(normalized);
        if ((yes || no) && !event.text.includes('?')) { this.decide(yes, event.text); return; }
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
  private send(event: ServerEvent) { try { this.emit(event); } catch { this.ports.logger.error('Session event delivery failed.'); } }
  private error(message: string) { this.send({ type: 'error', message }); }
  private transition(stage: Stage) {
    if (stage !== this.stage) { this.attempt = 0; this.questionReplies = []; this.questionAsked = ['CHOOSE', 'CONFIRM'].includes(stage); }
    this.lastHeartbeat = -Infinity; this.stage = stage; this.send({ type: 'stage', stage });
  }
  private speak<K extends keyof NarrationParams>(key: K, params: NarrationParams[K]) {
    this.answer(say(key, params, this.profile?.language ?? 'en'), ['still-working', 'booking-page', 'research-started'].includes(key));
  }
  private active(generation: number) { return generation === this.generation && !this.flow.signal.aborted; }
  private cancel() {
    this.turnController?.abort(); ++this.turnVersion;
    ++this.generation;
    this.flow.abort();
    this.bookingController?.abort();
    this.confirmation?.resolve({ approved: false, reply: 'Stopped' });
    this.confirmation = undefined;
    this.paidRefs.clear();
  }
  private resetTrip() {
    this.cancel();
    this.history = []; this.attempt = 0; this.questionReplies = []; this.questionAsked = false;
    this.research = undefined; this.booking = undefined; this.payment = undefined; this.options = []; this.trip = {};
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
    const parent = this.flow.signal;
    const traffic = async (): Promise<Disruption> => {
      if (this.scenario === 'demo') return getDemoDisruption();
      try { return await this.limited((signal) => this.ports.trafficH({ signal, now: this.ports.clock() }), 46_000, parent); }
      catch {
        parent.throwIfAborted();
        return { status: 'unknown', mode: 'live', summary: 'RER B status unknown: H lookup unavailable.', cause: '', source: rerBTrafficPage, recorded: false };
      }
    };
    const trafficResult = traffic().then((disruption) => {
      if (this.active(generation)) this.send({ type: 'feed', kind: 'traffic', text: `${disruption.mode}${disruption.recorded ? ' — recorded data' : ''} — ${disruption.summary}`, source: disruption.source, mode: disruption.mode, status: disruption.status });
      return disruption;
    });
    const linkup = this.scenario === 'demo' ? Promise.resolve([] as Option[]) : this.limited((signal) => this.ports.linkup({
      query: `Transport disruption and alternatives for this request today ${this.ports.clock().toISOString()}. ${transcript}`, signal,
    }), 9000, parent).then((result) => {
      if (this.active(generation)) for (const item of result.corroboration) {
        for (const source of item.sources) this.send({ type: 'feed', kind: 'research', text: item.text, source });
      }
      return result.extraOptions;
    }).catch(() => { if (this.active(generation)) this.ports.logger.error('Linkup research unavailable; retaining preset options.'); return []; });
    const [disruption, extraOptions] = await Promise.all([trafficResult, linkup]);
    return { disruption, extraOptions };
  }
  private async interpret(transcript: string, generation: number) {
    try {
      const result = await this.limited((signal) => this.ports.understand({ transcript, profile: this.profile!, now: this.ports.clock(), previous: this.trip, signal }), 20_500, this.flow.signal);
      if (!this.active(generation)) return;
      this.trip = { passengers: 1, luggage: 0, guide_dog: this.profile!.guide_dog, ...this.trip, ...result.trip };
      await this.plan(transcript, generation);
    } catch {
      if (!this.active(generation)) return;
      this.ports.logger.error('Trip understanding failed.');
      this.error('Could not understand the trip. Please try again.');
      this.answer(this.fallback());
      this.cancel(); this.transition('LISTEN');
    }
  }
  private missing() { return (['origin', 'destination', 'deadline'] as const).filter((key) => !this.trip[key]); }
  private remember(role: Turn['role'], text: string) { this.history = [...this.history, { role, text }].slice(-10); }
  private select(id: string) {
    const method = bookingMethods[id];
    if (!method || !this.options.some((option) => option.id === id)) { this.error('No supported booking method for this option.'); return; }
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
    try {
      result = await this.limited((signal) => this.ports.converse({ transcript, stage, language: this.language, trip: { ...this.trip }, missing: this.missing(), options: this.options, confirmation: this.confirmation ? { ...this.confirmation.details } : undefined, history: [...this.history], attempt: this.attempt, now: this.ports.clock(), signal }), 20_500, controller.signal);
    } catch { result = { intent: 'unclear', confidence: 0, reply: this.fallback() }; }
    finally { if (this.turnController === controller) this.turnController = undefined; }
    if (!this.active(generation) || this.stage !== stage || this.turnVersion !== version || controller.signal.aborted) return;
    if (result.intent !== 'unclear' && /^(euh|uh|um|hmm|(?:euh[, ]+)?je (?:ne )?sais pas|i don.t know|not sure)[.!? ]*$/i.test(transcript.trim())) result = { intent: 'unclear', confidence: 0, reply: this.fallback() };
    if (result.intent === 'stop' && result.confidence >= .65) { this.stop(); return; }
    if (stage === 'CONFIRM') {
      const uncertain = /\b(euh|maybe|perhaps|unsure|not|non|no|pas|attends|demain|tomorrow)\b/i.test(transcript);
      if (result.intent === 'confirm' && result.confidence >= .9 && !uncertain && !Object.keys(result.trip_patch ?? {}).length) { this.answer(result.reply); this.decide(true, transcript); return; }
      if (['decline', 'correct'].includes(result.intent) && result.confidence >= .65) { this.answer(result.reply); this.decide(false, transcript); return; }
      if (result.intent === 'confirm') result = { intent: 'unclear', reply: this.fallback(), confidence: 0 };
    }
    if (['CLARIFY', 'CHOOSE', 'UNDERSTAND', 'RESEARCH', 'PRESENT'].includes(stage) && ['provide_info', 'correct'].includes(result.intent) && result.confidence >= .65 && result.trip_patch && Object.keys(result.trip_patch).length) {
      const before = this.trip;
      this.trip = TripSchema.partial().parse({ ...this.trip, ...result.trip_patch }); this.attempt = 0;
      const changedRoute = ['origin', 'destination', 'deadline'].some((key) => before[key as keyof Trip] !== undefined && before[key as keyof Trip] !== this.trip[key as keyof Trip]);
      const next = ++this.generation;
      if (changedRoute || !this.research) { this.flow.abort(); this.flow = new AbortController(); this.research = this.startResearch(transcript, next); void this.research.catch(() => {}); }
      this.options = [];
      if (!this.missing().length) this.answer(result.reply);
      await this.plan(transcript, next, result.reply); return;
    }
    if (stage === 'CHOOSE' && result.intent === 'choose' && result.confidence >= .65 && result.option_id && this.options.some((option) => option.id === result.option_id)) { this.answer(result.reply); this.select(result.option_id); return; }
    if (['CLARIFY', 'CHOOSE', 'CONFIRM'].includes(stage)) {
      if (result.intent !== 'question' && this.questionAsked) ++this.attempt;
      if (result.intent === 'question' && stage !== 'CLARIFY') this.answer(result.reply);
      else this.ask(this.attempt >= 2 ? this.fallback() : result.reply);
    } else this.answer(result.reply);
  }
  private async plan(transcript: string, generation: number, question?: string) {
    try {
      if (this.missing().length) {
        this.transition('CLARIFY');
        if (question) this.ask(question); else await this.interpretTurn(transcript);
        return;
      }
      const trip = TripSchema.parse(this.trip);
      this.transition('RESEARCH');
      const research = await this.research!;
      if (!this.active(generation)) return;
      const catalogue = mergeOptions(matchesPresetRoute(trip) ? presetOptions : [], research.extraOptions);
      const assessed = assessOptions(catalogue, trip, this.ports.clock());
      this.options = assessed.feasible;
      this.transition('PRESENT');
      this.send({ type: 'options', items: this.options });
      this.speak('disruption', research.disruption);
      if (this.options.length) this.speak('present-options', { options: this.options, now: this.ports.clock() });
      else if (!catalogue.length) this.speak('no-known-options', {});
      else this.speak('no-feasible-options', { rejected: assessed.rejected.map(({ option, reason }) => ({ id: option.id, name: option.name, reason })) });
      this.transition('CHOOSE');
    } catch {
      if (!this.active(generation)) return;
      this.ports.logger.error('Trip understanding failed.');
      this.error('Could not understand the trip. Please try again.');
      this.cancel(); this.transition('LISTEN');
    }
  }
  private async execute(id: string, generation: number) {
    this.paidRefs.clear();
    this.payment = undefined;
    this.transition('EXECUTE');
    const controller = new AbortController();
    this.bookingController = controller;
    const current = () => this.active(generation) && !controller.signal.aborted;
    try {
      const option = this.options.find((item) => item.id === id)!;
      const trip = TripSchema.parse(this.trip);
      const base = publicShuttleUrl(this.ports.shuttlePublicUrl());
      const startUrl = base.pathname === '/' ? new URL('/fr/reservation/', base) : base;
      if (base.searchParams.get('difficulty') === 'easy') startUrl.searchParams.set('difficulty', 'easy');
      const result = await this.ports.runBooking({
        trip, journeyMinutes: option.journey_minutes, profile: this.profile!, startUrl: startUrl.href, signal: controller.signal,
        onProgress: (text) => {
          if (!current()) return;
          this.send({ type: 'feed', kind: 'agent', text });
        },
        onPage: (page) => { if (current() && this.stage === 'EXECUTE') this.speak('booking-page', { page }); },
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
    } catch {
      if (!current()) return;
      this.confirmation?.resolve({ approved: false, reply: 'Booking failed' }); this.confirmation = undefined;
      this.ports.logger.error('Booking execution failed.');
      this.error('Booking failed. Choose another option.');
      this.speak('booking-failed', {});
      this.options = this.options.filter((option) => option.id !== id);
      this.send({ type: 'options', items: this.options });
      this.transition('CHOOSE');
    } finally { controller.abort(); if (this.bookingController === controller) this.bookingController = undefined; }
  }
}
