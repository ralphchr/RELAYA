import { useState } from "react";
import { Check, Plus, Save, Tag } from "lucide-react";
import { copy } from "../../../copy/en.js";
import { useServices } from "../../../services/ServicesProvider.js";
import { NamesEditor } from "../../new-session/NamesEditor.js";
import { MAX_NAMES } from "../../new-session/names.js";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/** Names for this call, checked by Context Guard. Editable during the call, and can be saved to the default list. */
export function NamesCard({ names, onChange }: { names: string[]; onChange: (names: string[]) => void }) {
  const { data } = useServices();
  const [editing, setEditing] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const t = copy.names;

  async function saveToList() {
    setSave({ kind: "saving" });
    try {
      const lists = await data.nameLists();
      const list = lists.find((l) => l.isDefault) ?? lists[0] ?? await data.createList("Default Glossary");
      if (!list.isDefault) await data.setDefaultList(list.id);
      const have = new Set(list.items.map((i) => i.value.toLocaleLowerCase()));
      const add = names.filter((n) => !have.has(n.toLocaleLowerCase())).slice(0, Math.max(0, MAX_NAMES - list.items.length));
      if (add.length) await data.addNames(list.id, add);
      const skipped = names.filter((n) => !have.has(n.toLocaleLowerCase())).length - add.length;
      setSave({ kind: "done", text: add.length ? t.savedTo(add.length, list.title) + (skipped ? ` ${t.listFull(skipped)}` : "") : t.alreadySaved(list.title) });
    } catch (error) {
      setSave({ kind: "error", text: error instanceof Error ? error.message : t.saveFailed });
    }
  }

  return (
    <section className="names-card" aria-label={t.title}>
      <div className="n-head">
        <span className="ibadge pink"><Tag className="icon" /></span>
        <div className="n-t"><b>{t.title}</b><span className="n-count">{names.length}</span></div>
        <button className="n-edit" onClick={() => setEditing((value) => !value)}>{editing ? copy.common.done : copy.common.edit}</button>
      </div>
      {editing ? <NamesEditor names={names} onChange={(next) => { setSave({ kind: "idle" }); onChange(next); }} autoFocus /> : <>
        {names.length > 0 && <div className="n-list">{names.map((name) => <div key={name} className="n-row">{name}</div>)}</div>}
        <button className="n-add" onClick={() => setEditing(true)}><Plus className="icon" />{t.add}</button>
      </>}
      {names.length > 0 && !editing && (
        <div className="n-save">
          {save.kind === "done" ? <span className="n-saved" role="status"><Check className="icon" />{save.text}</span>
            : <button className="n-edit" disabled={save.kind === "saving"} onClick={() => { void saveToList(); }}><Save className="icon" />{t.saveToList}</button>}
          {save.kind === "error" && <span className="n-save-err" role="alert">{save.text}</span>}
        </div>
      )}
    </section>
  );
}
