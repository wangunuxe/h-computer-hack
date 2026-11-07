# Accessible mobile client

Run the server on port 3000 and `pnpm --filter @voila/web dev` on 5173.
Vite proxies `/session`, `/gladia` and `/ws` (including WebSockets); quick tunnels
under `*.trycloudflare.com` are allowed. Use HTTPS for microphone access on phones.
`?scenario=demo` or `?scenario=live` selects the scenario; an omitted/invalid value
leaves the server default unchanged.

The first-run profile stays in `localStorage` under `voila.profile`. Session
credentials stay in memory, not URLs in the page or persistent storage. Reconnects
reuse the token and do not resend `hello`; the server replays stage-specific UI.
Editing a profile stops the previous trip before opening a new session.

Voice is the only request input; there is no text field or text-input toggle.
Recordings finish normally after 180 seconds, retaining final utterances and
announcing the limit. The elapsed counter is visual only (`aria-hidden`).
Gladia permits live sessions up to three hours; its 5–60 second maximum utterance
duration is segmentation, not a session cap. We retain 30-second segmentation
and assemble all final utterances. See the official [limits](https://docs.gladia.io/chapters/limits-and-specifications/concurrency)
and [endpointing](https://docs.gladia.io/chapters/live-stt/features/endpointing) docs.
Three-minute transcripts fit the existing shared text schema and 64 KiB WebSocket
limit; trip extraction allows 20 seconds for Gemini.
The circular microphone defaults to tap-to-toggle: activate once to start and
again to finish, including with VoiceOver/TalkBack or keyboard activation.
The profile also offers hold-to-talk (hold Space/Enter or press and hold).
Client-only `mic_mode` and `tts_enabled` preferences persist beside the profile;
they are stripped from the wire profile. Choose “Screen reader only” to disable
all Voilà speech synthesis and use the live caption card instead. Screen-reader
presence is not inferred, because browsers provide no reliable detection API.
Speech is unlocked by a user gesture. The large caption card contains the latest
message, with Repeat beside it; errors are assertive. The last recognized request
appears in a separate bubble. Stage changes focus options, confirmation, payment
or booking content; plain caption updates never move focus. Options send ordinals.
Stop cancels recording/speech, and sends `stop` (or retries it on reconnection).
Payment uses a real new-tab link, never a programmatic popup.

The mobile-first interface uses semantic landmarks, 56 px minimum controls, a
104 px microphone, safe-area-aware fixed dock, dark/light system themes, rem
typography and reduced-motion support. Stop is beside the microphone whenever
recording, a trip or a pending cancellation is active. Activity/source links live
in the native “What I’m doing” details panel. UI evidence uses fake events via
CDP; scripted session/WebSocket requests can exercise routing without a text
field or an H booking run.

`POST /gladia/session` accepts `{id, resume_token}` and exposes only `{url}`.
The session must have connected over WebSocket at least once. Initialization
attempts (including upstream failures) are limited per session to one every 3 s
and 30 per rolling hour; excess attempts return 429. Reconnecting does not reset
these limits.
The API key remains server-side. Audio is raw little-endian signed PCM16, mono,
16 kHz. Gladia names this encoding `wav/pcm` (a WAV header is not required).
Endpointing is 0.5 s; on release we send `stop_recording`, then collect final
`transcript.data.utterance.text` messages until `end_session`/normal closure.
Unfinalized partials are never submitted. Setup cancellation stops late microphone
tracks, recording is bounded to 60 s, and finalization is bounded to 10 s.
Microphone capture starts alongside URL initialization. PCM is buffered (up to
1 MB) until the Gladia socket opens, then flushed in order. Releasing during setup
stops capture but preserves the buffered audio and sends `stop_recording` after it.

Official contracts checked:
- https://docs.gladia.io/api-reference/v2/live/init
- https://api.gladia.io/openapi.json
- https://docs.gladia.io/asyncapi.yaml
- https://docs.gladia.io/api-reference/v2/live/action/audio-chunk
- https://docs.gladia.io/api-reference/v2/live/action/stop-recording

Pure modules `audio.ts`, `protocol.ts`, `state.ts` and `speech.ts` have Vitest tests.
`recorder.ts` owns browser audio/network resources; `main.ts` owns semantic DOM
wiring and localization. No framework or third-party speech SDK is used.
