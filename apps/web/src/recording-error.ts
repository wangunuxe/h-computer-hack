export type RecordingErrorKind = 'permission' | 'device' | 'capture' | 'service' | 'empty' | 'provider';
export interface RecordingFailure { kind: RecordingErrorKind; code: string; cause?: unknown }
export class SpeechInitializationError extends Error {
  constructor(readonly status: number) { super('Speech initialization failed'); }
}
export function captureFailure(cause: unknown): RecordingFailure {
  const name = cause instanceof Error ? cause.name : '';
  return { kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'device' : 'capture', code: 'capture', cause };
}
export const recordingErrorKeys = {
  permission: 'microphonePermission', device: 'microphoneMissing', capture: 'microphoneCapture',
  service: 'speechUnavailable', empty: 'nothingHeard', provider: 'speechProvider',
} as const;
export function recordingDiagnostic({ kind, code, cause }: RecordingFailure) {
  const names = ['NotAllowedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'AbortError'];
  return { kind, code, ...(cause instanceof Error ? { causeName: names.includes(cause.name) ? cause.name : 'Error' } : {}),
    ...(cause instanceof SpeechInitializationError ? { status: cause.status } : {}) };
}
