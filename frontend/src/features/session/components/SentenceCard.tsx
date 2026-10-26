import { RelayaMark } from "../../../components/brand/RelayaMark.js";
import { Wave } from "../../../components/ui/Wave.js";
import { copy } from "../../../copy/en.js";

/** Speak for me, while the agent says the approved sentence in the meeting. */
export function SentenceCard({ text }: { text: string }) {
  return (
    <div className="card output big">
      <div className="head">
        <span className="l"><RelayaMark size={30} /></span>
        <span className="chip chip-green"><Wave heights={[6, 12, 8, 14, 7]} live />{copy.panel.speaking}</span>
      </div>
      <p className="willsay">{text}</p>
    </div>
  );
}
