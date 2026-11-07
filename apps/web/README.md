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

Hold the large button to talk; release to finish. Keyboard users hold Space or
Enter. Screen-reader users activate the button once to start and again to finish.
The text form is always available. Speech is unlocked by a user gesture; every
spoken message is also appended to a polite live region. Errors are assertive.
Stop cancels recording/speech, and sends `stop` (or retries it on reconnection).
Payment uses a real new-tab link, never a programmatic popup.

`POST /gladia/session` accepts `{id, resume_token}` and exposes only `{url}`.
The API key remains server-side. Audio is raw little-endian signed PCM16, mono,
16 kHz. Gladia names this encoding `wav/pcm` (a WAV header is not required).
Endpointing is 0.5 s; on release we send `stop_recording`, then collect final
`transcript.data.utterance.text` messages until `end_session`/normal closure.
Unfinalized partials are never submitted. Setup cancellation stops late microphone
tracks, recording is bounded to 60 s, and finalization is bounded to 10 s.

Official contracts checked:
- https://docs.gladia.io/api-reference/v2/live/init
- https://api.gladia.io/openapi.json
- https://docs.gladia.io/asyncapi.yaml
- https://docs.gladia.io/api-reference/v2/live/action/audio-chunk
- https://docs.gladia.io/api-reference/v2/live/action/stop-recording

Pure modules `audio.ts`, `protocol.ts`, `state.ts` and `speech.ts` have Vitest tests.
`recorder.ts` owns browser audio/network resources; `main.ts` owns semantic DOM
wiring and localization. No framework or third-party speech SDK is used.
