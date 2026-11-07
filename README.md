
## Stage demo

```bash
pnpm install
pnpm dev            # http://localhost:5173  (stage)  ·  /phone.html (phone only)
```

Scripted hero scenario (RER B → CDG 2E) runs entirely in the browser — no keys needed.

| Key | Action |
| --- | --- |
| `Space` / `Enter` | start · pause |
| `→` | skip beat |
| `R` | restart |
| `M` | mute voice + SFX |
| `F` | fullscreen |
| `H` | hide presenter HUD |
| `Esc` | back to title |

URL flags: `?autostart` `?nocold` (skip cold open) `?speed=1.5` `?mute` `?source=live&ws=ws://host:8787/ws/session/demo` (drive the stage from the real backend over the shared `@voila/shared` event protocol).
