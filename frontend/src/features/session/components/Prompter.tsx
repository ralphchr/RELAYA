import { Mic } from "lucide-react";
import { RelayaMark } from "../../../components/brand/RelayaMark.js";
import { copy } from "../../../copy/en.js";

/** Say it yourself: the approved sentence in large type, read aloud by the user. */
export function Prompter({ text }: { text: string }) {
  return (
    <div className="prompter">
      <div className="head">
        <span className="l"><RelayaMark size={30} /><span className="chip chip-green"><Mic className="icon" />{copy.panel.unmuted}</span></span>
        <span className="chip chip-line">{copy.panel.readAloud}</span>
      </div>
      <p className="willsay">{text}</p>
    </div>
  );
}
