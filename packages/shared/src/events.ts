/**
 * Voilà session event protocol (docs/PLAN.md §2.3).
 * One WebSocket per session: `/ws/session/:id`.
 */

export type Stage =
  | "LISTEN"
  | "UNDERSTAND"
  | "CLARIFY"
  | "RESEARCH"
  | "PRESENT"
  | "CHOOSE"
  | "EXECUTE"
  | "CONFIRM"
  | "HANDOFF"
  | "AWAIT_PAYMENT"
  | "DONE";

export interface Source {
  title: string;
  url: string;
}

export interface Trip {
  origin: string;
  destination: string;
  /** ISO time the user must be at the destination by (e.g. check-in close). */
  deadline: string;
  flight?: string;
  passengers: number;
  guide_dog: boolean;
  luggage: number;
}

export type GuideDogStatus = "accepted" | "unknown" | "refused";
export type OptionKind = "train" | "taxi" | "vtc" | "shuttle" | "bus";

export interface TransportOption {
  id: string;
  label: string;
  operator: string;
  kind: OptionKind;
  pickup_eta_min: number;
  travel_min: number;
  price_eur?: number;
  guide_dog: GuideDogStatus;
  feasible: boolean;
  /** Minutes left between arrival + buffer and the deadline (negative = misses it). */
  margin_min?: number;
  reason?: string;
  source?: Source;
}

export interface Booking {
  ref: string;
  pickup_time: string;
  pickup_point: string;
  price: string;
  operator: string;
  operator_phone: string;
  payment_url: string;
  guide_dog_status: GuideDogStatus;
}

export type FeedKind = "info" | "search" | "alert" | "ok" | "warn" | "agent" | "tool";

/** Fine-grained H agent activity, used by the stage "agent live view" (FR-6). */
export type AgentAction =
  | { kind: "session"; model: string; session_id: string; max_steps: number }
  | { kind: "navigate"; url: string; page: string }
  | { kind: "think"; step: number; text: string }
  | { kind: "click"; target: string }
  | { kind: "type"; target: string; text: string }
  | { kind: "select"; target: string; value: string }
  | { kind: "reveal"; target: string }
  | { kind: "audit"; on: boolean }
  | { kind: "tool_call"; name: "confirm_with_user" | "handoff_payment"; args: Record<string, unknown> }
  | { kind: "paused"; reason: string }
  | { kind: "done" };

export type ServerEvent =
  | { type: "stage"; stage: Stage }
  | { type: "say"; text: string }
  | { type: "feed"; kind: FeedKind; text: string; source?: Source }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "trip"; trip: Trip }
  | { type: "clarify"; question: string }
  | { type: "options"; items: TransportOption[]; now: string; deadline: string }
  | { type: "chosen"; id: string }
  | { type: "confirm"; summary: string[] }
  | { type: "confirmed" }
  | { type: "agent"; action: AgentAction }
  | { type: "payment_handoff"; url: string; amount: string; merchant: string; expires_at?: string }
  | { type: "payment_completed" }
  | { type: "booking_card"; booking: Booking }
  | { type: "error"; message: string };

export type ClientEvent =
  | { type: "hello"; profile: UserProfile; gps?: { lat: number; lng: number } }
  | { type: "final_transcript"; text: string }
  | { type: "user_reply"; text: string }
  | { type: "stop" }
  | { type: "paid" };

export interface UserProfile {
  name: string;
  phone: string;
  email: string;
  guide_dog: boolean;
  language: string;
}

export const FLOW: { stage: Stage; label: string }[] = [
  { stage: "LISTEN", label: "Listen" },
  { stage: "UNDERSTAND", label: "Understand" },
  { stage: "RESEARCH", label: "Research" },
  { stage: "CHOOSE", label: "Decide" },
  { stage: "EXECUTE", label: "Act" },
  { stage: "CONFIRM", label: "Confirm" },
  { stage: "HANDOFF", label: "Pay" },
  { stage: "DONE", label: "Follow up" },
];

/** Map any state-machine stage onto the 8-step public flow (PRD §8.1). */
export function flowIndex(stage: Stage): number {
  const alias: Partial<Record<Stage, Stage>> = {
    CLARIFY: "UNDERSTAND",
    PRESENT: "RESEARCH",
    AWAIT_PAYMENT: "HANDOFF",
  };
  const s = alias[stage] ?? stage;
  return FLOW.findIndex((f) => f.stage === s);
}
