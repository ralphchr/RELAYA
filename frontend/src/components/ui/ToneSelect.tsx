import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Tone } from "@relaya/contracts";
import { copy } from "../../copy/en.js";
import "./tone-select.css";

const OPTIONS: { value: Tone; label: string }[] = [
  { value: "professional", label: copy.newSession.tones.professional },
  { value: "casual", label: copy.newSession.tones.casual },
];

export function ToneSelect({ tone, onTone, label, className = "" }: { tone: Tone; onTone: (tone: Tone) => void; label: string; className?: string }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const selectedIndex = OPTIONS.findIndex((option) => option.value === tone);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timeout = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(timeout);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    window.addEventListener("pointerdown", outside);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("pointerdown", outside); };
  }, [open, selectedIndex]);

  const choose = (value: Tone) => {
    onTone(value);
    setOpen(false);
    trigger.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!open) {
      if (event.target === trigger.current && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    const current = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + direction + OPTIONS.length) % OPTIONS.length;
      optionRefs.current[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      optionRefs.current[event.key === "Home" ? 0 : OPTIONS.length - 1]?.focus();
    }
  };

  return (
    <div ref={root} className={`tone-picker${open ? " is-open" : ""}${className ? ` ${className}` : ""}`} onKeyDown={handleKeyDown} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={trigger} type="button" className="tone-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>{OPTIONS[selectedIndex]?.label ?? OPTIONS[0]?.label ?? ""}</span><ChevronDown className="icon" aria-hidden="true" />
      </button>
      {mounted && <div className={`tone-picker-menu${open ? " is-opening" : " is-closing"}`} id={id} role="listbox" aria-label={label} aria-hidden={!open}>
        {OPTIONS.map((option, index) => (
          <button ref={(element) => { optionRefs.current[index] = element; }} key={option.value} type="button" role="option" tabIndex={open ? 0 : -1} aria-selected={tone === option.value} className="tone-picker-option" onClick={() => choose(option.value)}>
            <span>{option.label}</span>{tone === option.value && <Check className="icon" aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </div>
  );
}
