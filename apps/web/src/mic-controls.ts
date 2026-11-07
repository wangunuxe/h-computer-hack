export function bindMicControls(button: HTMLButtonElement, dock: HTMLElement, controls: {
  mode: () => 'hold' | 'toggle'; active: () => boolean; start: () => void; release: () => void;
}) {
  let pointer: number | undefined;
  dock.oncontextmenu = (event) => event.preventDefault();
  button.onpointerdown = (event) => {
    if (controls.mode() !== 'hold' || event.button !== 0 || pointer !== undefined) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); pointer = event.pointerId; controls.start();
  };
  button.onpointerup = (event) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault(); pointer = undefined; controls.release();
  };
  button.onpointercancel = () => { pointer = undefined; };
  button.onkeydown = (event) => {
    if (controls.mode() === 'hold' && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) controls.start(); }
  };
  button.onkeyup = (event) => {
    if (controls.mode() === 'hold' && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); controls.release(); }
  };
  button.onclick = (event) => {
    if (controls.mode() === 'toggle' || event.detail === 0) { if (controls.active()) controls.release(); else controls.start(); }
  };
}
