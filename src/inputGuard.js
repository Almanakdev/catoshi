// Shared guard for every global keybind in the game (WASD, Space, E, N, R, K,
// O, P, Esc…). The chat box is a real <input> living on top of the canvas, so
// without this a message like "wasd" would walk the character while you type.
export function isTypingInUI() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
