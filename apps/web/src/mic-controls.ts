export function micControlState(state: { connected: boolean; failed: boolean; active: boolean; releasing: boolean }, labels: { connectionRetry: string; connecting: string; listening: string; stopListening: string; processing: string; tap: string }) {
  const caption = !state.connected ? (state.failed ? labels.connectionRetry : labels.connecting) : state.active ? labels.listening : state.releasing ? labels.processing : labels.tap;
  return { caption, label: !state.connected && state.failed ? labels.connectionRetry : state.active ? labels.stopListening : labels.tap, disabled: state.connected && state.releasing, pressed: state.active };
}
export function bindMicControls(button: HTMLButtonElement, dock: HTMLElement, controls: {
  active: () => boolean; start: () => void; release: () => void;
}) {
  dock.oncontextmenu = (event) => event.preventDefault();
  button.onclick = () => { if (controls.active()) controls.release(); else controls.start(); };
}
