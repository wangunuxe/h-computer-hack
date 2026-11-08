export function micControlState(state: { connected: boolean; failed: boolean; active: boolean; releasing: boolean }, labels: { connectionRetry: string; connecting: string; listening: string; stopListening: string; processing: string; tap: string }) {
  const caption = !state.connected ? (state.failed ? labels.connectionRetry : labels.connecting) : state.active ? labels.listening : state.releasing ? labels.processing : labels.tap;
  return { caption, label: !state.connected && state.failed ? labels.connectionRetry : state.active ? labels.stopListening : labels.tap, disabled: state.connected && state.releasing, pressed: state.active };
}
export function bindMicControls(button: HTMLButtonElement, dock: HTMLElement, controls: {
  active: () => boolean; start: () => void; release: () => void;
}) {
  let pointer: { id: number; x: number; y: number; moved: boolean } | undefined;
  let suppressClickUntil = 0;
  const toggle = () => { if (!button.disabled) { if (controls.active()) controls.release(); else controls.start(); } };
  dock.oncontextmenu = (event) => event.preventDefault();
  button.onpointerdown = (event) => {
    if (button.disabled || !event.isPrimary || event.button !== 0 || !['touch', 'pen'].includes(event.pointerType)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  button.onpointermove = (event) => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) pointer.moved = true;
  };
  button.onpointercancel = button.onlostpointercapture = (event) => {
    if (pointer?.id === event.pointerId) { pointer = undefined; suppressClickUntil = Date.now() + 700; }
  };
  button.onpointerup = (event) => {
    const down = pointer;
    if (!down || down.id !== event.pointerId) return;
    pointer = undefined; suppressClickUntil = Date.now() + 700;
    if (down.moved || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12) return;
    const bounds = button.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    event.preventDefault(); toggle();
  };
  button.onclick = (event) => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil) return;
    toggle();
  };
}
