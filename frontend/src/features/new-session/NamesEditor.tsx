import { useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { copy } from "../../copy/en.js";
import { MAX_NAMES, validateName } from "./names.js";

/** Add and remove the per-call names Context Guard checks. Shared by /new and the panel. */
export function NamesEditor({ names, onChange, autoFocus = false }: { names: string[]; onChange: (names: string[]) => void; autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = value.trim();
    if (!name) return;
    const problem = validateName(name, names);
    if (problem) { setError(problem); return; }
    onChange([...names, name]);
    setValue("");
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <div className="names-editor">
      {names.length > 0 && (
        <ul className="ne-list">
          {names.map((name) => (
            <li key={name} className="ne-row">
              <span>{name}</span>
              <button type="button" aria-label={copy.names.remove(name)} onClick={() => onChange(names.filter((item) => item !== name))}><X className="icon" /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="ne-add" onSubmit={add}>
        <label className="sr-only" htmlFor="name-entry">{copy.names.add}</label>
        <input id="name-entry" ref={inputRef} autoFocus={autoFocus} value={value} maxLength={80} placeholder={copy.names.placeholder} onChange={(event) => { setValue(event.target.value); setError(null); }} />
        <button className="btn btn-coral btn-sm" type="submit" disabled={!value.trim() || names.length >= MAX_NAMES}><Plus className="icon" />{copy.names.add}</button>
      </form>
      <p className={`ne-hint${error ? " err" : ""}`} role={error ? "alert" : undefined}>{error ?? copy.names.limit(names.length, MAX_NAMES)}</p>
    </div>
  );
}
