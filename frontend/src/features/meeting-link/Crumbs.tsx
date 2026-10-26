import { Check } from "lucide-react";
import { copy } from "../../copy/en.js";

/** Set up → Join → Workspace. `at` is the current step index. */
export function Crumbs({ at }: { at: number }) {
  return (
    <ol className="crumbs" aria-label="Setup steps">
      {copy.crumbs.map((label, i) => (
        <li key={label} className={`c${i < at ? " done" : ""}${i === at ? " on" : ""}`} aria-current={i === at ? "step" : undefined}>
          <i>{i < at ? <Check className="icon" strokeWidth={3} /> : i + 1}</i>{label}
        </li>
      ))}
    </ol>
  );
}
