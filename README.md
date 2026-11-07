
## Stage demo

```bash
pnpm install
pnpm stage          # http://localhost:5174  ·  /phone.html (phone only)
```

Scripted hero scenario (RER B → CDG 2E) runs entirely in the browser — no keys needed.

| Key | Action |
| --- | --- |
| `Space` / `Enter` | start · pause |
| `→` | skip beat |
| `R` | restart |
| `M` | mute voice + SFX |
| `F` | fullscreen |
| `P` | toggle the computer-use pipeline scene |
| `H` | hide presenter HUD |
| `Esc` | back to title |

URL flags: `?scene=pipeline` (static computer-use diagram, for slides) `?autostart` `?nocold` (skip cold open) `?speed=1.5` `?mute` `?source=live&ws=ws://host:8787/ws/session/demo` (drive the stage from the real backend over the stage event protocol).
