export function bindMicControls(button: HTMLButtonElement, dock: HTMLElement, controls: {
  active: () => boolean; start: () => void; release: () => void;
}) {
  dock.oncontextmenu = (event) => event.preventDefault();
  button.onclick = () => { if (controls.active()) controls.release(); else controls.start(); };
}
