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

type Stage = Extract<ServerEvent, { type: 'stage' }>['stage'];
type Research = { disruption: Disruption; extraOptions: Option[] };
const userPayment = Symbol('user-payment');
export interface SessionPorts {
  understand: typeof understand;
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
  private confirmation?: { summary: string; resolve: (decision: { approved: boolean; reply: string }) => void };
  private lastSay: number;
  private lastHeartbeat = -Infinity;
  private heartbeat: ReturnType<typeof setInterval>;
  private readonly ports: SessionPorts;

  constructor(private emit: (event: ServerEvent) => void, ports: Partial<SessionPorts> = {}) {
    this.ports = { understand, trafficH: readRerBTraffic, linkup: searchDisruptionAndAlternatives, runBooking,
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
      this.transition('UNDERSTAND');
      this.speak('acknowledgement', {});
      this.speak('research-started', {});
      this.research = this.startResearch(event.text, generation);
      void this.research.catch(() => {});
      void this.interpret(event.text, generation);
    } else if (event.type === 'user_reply' && this.stage === 'CLARIFY') {
      if (!event.text.trim()) { this.error('Reply must not be empty.'); return; }
      this.transition('UNDERSTAND');
      void this.interpret(event.text, this.generation);
    } else if (event.type === 'user_reply' && this.stage === 'CHOOSE') {
      const id = chooseOption(event.text, this.options);
      if (!id) { this.speak('choose-again', {}); return; }
      const method = bookingMethods[id];
      if (!method) { this.error('No supported booking method for this option.'); return; }
      if (method.kind === 'manual') {
        this.speak('manual-instructions', { id, instructions: method.instructions });
        this.transition('DONE');
      } else void this.execute(id, this.generation);
    } else if (event.type === 'user_reply' && this.stage === 'CONFIRM' && this.confirmation) {
      const reply = event.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      const yes = /^(oui|yes|y|ouais|ok|okay|d accord|vas y|go ahead|yes please|bien sur)$/.test(reply);
      const no = /^(non|no|n|attends|attendez|wait|not yet|pas encore|stop)$/.test(reply);
      if (!yes && !no) { this.speak('confirm-again', {}); return; }
      const pending = this.confirmation;
      this.confirmation = undefined;
      this.transition('EXECUTE');
      pending.resolve({ approved: yes, reply: event.text });
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
  private transition(stage: Stage) { this.lastHeartbeat = -Infinity; this.stage = stage; this.send({ type: 'stage', stage }); }
  private speak<K extends keyof NarrationParams>(key: K, params: NarrationParams[K]) {
    this.lastSay = this.ports.clock().getTime();
    this.send({ type: 'say', text: say(key, params, this.profile?.language ?? 'en') });
  }
  private active(generation: number) { return generation === this.generation && !this.flow.signal.aborted; }
  private cancel() {
    ++this.generation;
    this.flow.abort();
    this.bookingController?.abort();
    this.confirmation?.resolve({ approved: false, reply: 'Stopped' });
    this.confirmation = undefined;
    this.paidRefs.clear();
  }
  private resetTrip() {
    this.cancel();
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
      const result = await this.limited((signal) => this.ports.understand({ transcript, profile: this.profile!, now: this.ports.clock(), previous: this.trip, signal }), 8500, this.flow.signal);
      if (!this.active(generation)) return;
      this.trip = { passengers: 1, luggage: 0, guide_dog: this.profile!.guide_dog, ...this.trip, ...result.trip };
      const missing = (['origin', 'destination', 'deadline'] as const).filter((key) => !this.trip[key]);
      if (missing.length) {
        this.transition('CLARIFY');
        const key = missing[0] === 'origin' ? 'clarify-origin' : missing[0] === 'destination' ? 'clarify-destination' : 'clarify-deadline';
        const question = say(key, {}, this.profile!.language);
        this.send({ type: 'clarify', question });
        this.speak(key, {});
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
        trip, profile: this.profile!, startUrl: startUrl.href, signal: controller.signal,
        onProgress: (text) => {
          if (!current()) return;
          this.send({ type: 'feed', kind: 'agent', text });
        },
        onPage: (page) => { if (current() && this.stage === 'EXECUTE') this.speak('booking-page', { page }); },
        confirm: (summary, details) => {
          if (!current()) return Promise.resolve({ approved: false, reply: 'Stopped' });
          if (this.confirmation) throw new Error('A confirmation is already pending.');
          const decision = new Promise<{ approved: boolean; reply: string }>((resolve) => { this.confirmation = { summary, resolve }; });
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
