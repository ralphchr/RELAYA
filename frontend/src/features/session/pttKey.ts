/** Push-to-talk keys are stored as KeyboardEvent.code, which names the physical key whatever the keyboard layout. */
export const DEFAULT_PTT_KEY = "Space";

/** Keys the panel already uses, or that the system takes before the page sees them. */
const RESERVED = new Set(["Escape", "Enter", "NumpadEnter", "Tab", "Backspace", "CapsLock", "MetaLeft", "MetaRight", "ContextMenu"]);

export const isAllowedPttKey = (code: string) => /^[A-Za-z0-9]{1,20}$/.test(code) && !RESERVED.has(code);

const NAMED: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

/** "KeyF" → "F", "Digit1" → "1", "AltRight" → "Right Alt", "F8" → "F8". */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1];
  if (letter) return letter;
  const numpad = /^Numpad(.+)$/.exec(code)?.[1];
  if (numpad) return `Numpad ${numpad}`;
  const side = /^(Shift|Control|Alt)(Left|Right)$/.exec(code);
  if (side) return `${side[2]} ${side[1] === "Control" ? "Ctrl" : side[1]}`;
  return code;
}
