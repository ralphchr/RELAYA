import { useEffect, useRef } from "react";

interface Handlers { onDown(): void; onUp(): void; onCancel(): void; onEnter(): void }

const isEditable = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

/**
 * hold the push-to-talk key (Space unless changed in Settings) to
 * talk while the panel's window has focus, Esc cancels, Enter approves.
 * Attached to the window that shows the panel, which may be the Document
 * Picture-in-Picture window. `key` is a KeyboardEvent.code.
 */
export function usePushToTalk(target: Window, handlers: Handlers, key = "Space") {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let holding = false;
    const down = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      if (event.code === key) {
        event.preventDefault();
        if (!holding && !event.repeat) { holding = true; ref.current.onDown(); }
      } else if (event.key === "Escape") {
        holding = false;
        ref.current.onCancel();
      } else if (event.key === "Enter" && (event.target as Element | null)?.tagName !== "BUTTON") {
        ref.current.onEnter();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== key || isEditable(event.target)) return;
      event.preventDefault();
      if (holding) { holding = false; ref.current.onUp(); }
    };
    const blur = () => { if (holding) { holding = false; ref.current.onUp(); } };
    target.addEventListener("keydown", down);
    target.addEventListener("keyup", up);
    target.addEventListener("blur", blur);
    return () => {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
      target.removeEventListener("blur", blur);
    };
  }, [target, key]);
}
