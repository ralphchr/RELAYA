import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, BookOpenText, Check, Plus, Search, Star, Trash2, X } from "lucide-react";
import { AppShell } from "../../components/shell/AppShell.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { useServices } from "../../services/ServicesProvider.js";
import type { NameList } from "../../services/types.js";
import { MAX_NAMES, MAX_NAME_LENGTH } from "../new-session/names.js";
import { PageIntro, SavedNote, StorageNote, errorMessage } from "./parts.js";
import "./workspace-pages.css";

/** Splits pasted glossary terms into entries: one per line or comma separated, trimmed, no repeats. */
export function parseTerms(raw: string, existing: string[]): { add: string[]; skipped: number } {
  const seen = new Set(existing.map((n) => n.toLocaleLowerCase()));
  const add: string[] = [];
  let skipped = 0;
  for (const value of raw.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase();
    if (value.length > MAX_NAME_LENGTH || seen.has(key) || existing.length + add.length >= MAX_NAMES) { skipped++; continue; }
    seen.add(key);
    add.push(value);
  }
  return { add, skipped };
}

/** /names: personal glossaries. The default glossary fills the session's recognition terms. */
export function NamesPage() {
  const { data } = useServices();
  const navigate = useNavigate();
  const [lists, setLists] = useState<NameList[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [itemName, setItemName] = useState("");
  const [bulk, setBulk] = useState("");
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const reload = useCallback(async () => {
    const next = await data.nameLists();
    setLists(next);
    setSelected((id) => (id && next.some((l) => l.id === id) ? id : next.find((l) => l.isDefault)?.id ?? next[0]?.id ?? null));
  }, [data]);

  useEffect(() => { reload().catch((e: unknown) => { setLists([]); setNotice({ text: errorMessage(e), error: true }); }); }, [reload]);

  /** Runs a change, reloads, and reports the outcome. */
  async function run(change: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await change(); await reload(); setNotice({ text: done }); }
    catch (e) { setNotice({ text: errorMessage(e), error: true }); await reload().catch(() => undefined); }
    finally { setBusy(false); }
  }

  const current = lists?.find((l) => l.id === selected) ?? null;

  function createList(event: FormEvent) {
    event.preventDefault();
    const title = listName.trim();
    if (!title) return;
    void run(async () => {
      const list = await data.createList(title);
      if (!lists?.length) await data.setDefaultList(list.id);
      setSelected(list.id);
      setListName("");
    }, "Glossary created.");
  }

  function addNames(raw: string) {
    if (!current) return;
    const { add, skipped } = parseTerms(raw, current.items.map((i) => i.value));
    if (!add.length) { setNotice({ text: `No new terms added. Check for repeats, the ${MAX_NAME_LENGTH}-character limit, or the ${MAX_NAMES}-term limit.`, error: true }); return; }
    void run(async () => { await data.addNames(current.id, add); setItemName(""); setBulk(""); },
      `${add.length === 1 ? "1 term" : `${add.length} terms`} added.${skipped ? ` ${skipped} skipped.` : ""}`);
  }

  function move(index: number, by: number) {
    if (!current) return;
    const ids = current.items.map((i) => i.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(() => data.reorderNames(current.id, ids), "Term order saved.");
  }

  function deleteList() {
    if (!current || !lists || !window.confirm(`Delete the “${current.title}” glossary and its terms?`)) return;
    const next = lists.find((l) => l.id !== current.id);
    void run(async () => {
      await data.deleteList(current.id);
      if (current.isDefault && next) await data.setDefaultList(next.id);
    }, "Glossary deleted.");
  }

  return (
    <AppShell title="Glossary">
      <div className="workspace-page workspace-motion names-page">
        <PageIntro eyebrow="PERSONAL GLOSSARY" title="Words Relaya should recognize" text="Keep spellings for people, places, and project terms in one place. Your Default Glossary is included when you start a session." />
        {lists === null ? <div className="spinner" aria-busy="true" /> : (
          <div className="names-layout" aria-busy={busy}>
            <section className="workspace-card names-list-card" aria-label="Your glossaries">
              <div className="workspace-card-head"><div className="glossary-list-heading"><span className="glossary-card-mark"><BookOpenText size={17} /></span><div><h3>Your glossaries</h3><p>{lists.length} {lists.length === 1 ? "glossary" : "glossaries"}</p></div></div></div>
              {lists.length > 0 ? (
                <div className="saved-list-nav">
                  {lists.map((list) => (
                    <button key={list.id} className={current?.id === list.id ? "selected" : ""} onClick={() => { setSelected(list.id); setRenaming(false); setSearch(""); }}>
                      <span>{list.title}{list.isDefault && <Star className="default-star" size={13} aria-label="Default glossary" />}</span><small>{list.items.length}</small>
                    </button>
                  ))}
                </div>
              ) : <div className="compact-empty"><b>No glossaries yet</b><span>Create one for words Relaya should recognize.</span></div>}
              <form className="inline-create" onSubmit={createList}>
                <label className="sr-only" htmlFor="new-list-name">New glossary name</label>
                <input id="new-list-name" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="New glossary" maxLength={60} required />
                <button className="wp-button wp-button-primary" disabled={busy} aria-label="Create glossary"><Plus size={17} />Create</button>
              </form>
            </section>

            <section className="workspace-card names-items-card" aria-label="Terms in selected glossary">
              {current ? <>
                <div className="workspace-card-head">
                  <div>
                    {renaming ? (
                      <form className="rename-form" onSubmit={(e) => { e.preventDefault(); if (listName.trim()) void run(async () => { await data.renameList(current.id, listName.trim()); setRenaming(false); setListName(""); }, "Glossary renamed."); }}>
                        <label className="sr-only" htmlFor="rename-list">Glossary name</label>
                        <input id="rename-list" value={listName} onChange={(e) => setListName(e.target.value)} autoFocus maxLength={60} />
                        <button className="icon-action" aria-label="Save list name"><Check size={17} /></button>
                        <button type="button" className="icon-action" aria-label="Cancel rename" onClick={() => setRenaming(false)}><X size={17} /></button>
                      </form>
                    ) : <><h3>{current.title}</h3><p>{current.items.length} of {MAX_NAMES} terms{current.isDefault ? " · Used by default" : ""}</p></>}
                  </div>
                  {!renaming && (
                    <div className="head-actions">
                      {!current.isDefault && <button className="text-action" disabled={busy} onClick={() => void run(() => data.setDefaultList(current.id), `“${current.title}” is now your Default Glossary.`)}>Make default</button>}
                      <button className="wp-button" disabled={!current.items.length} onClick={() => { sessionStorage.setItem("relaya.namesNextSession", JSON.stringify(current.items.map((i) => i.value))); navigate("/new"); }}>Use in next session</button>
                      <button className="text-action" onClick={() => { setListName(current.title); setRenaming(true); }}>Rename</button>
                      <button className="icon-action danger" disabled={busy} aria-label={`Delete ${current.title}`} onClick={deleteList}><Trash2 size={17} /></button>
                    </div>
                  )}
                </div>
                {current.items.length > 0 && <label className="glossary-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search terms in {current.title}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search terms" /></label>}
                {current.items.length ? (
                  <ul className="name-items glossary-entries">
                    {current.items.map((item, index) => ({ item, index })).filter(({ item }) => item.value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(({ item, index }) => (
                      <li key={item.id}>
                        <span className="glossary-term"><span className="glossary-term-mark" aria-hidden="true">{item.value.slice(0, 1).toLocaleUpperCase()}</span><span className="glossary-term-value">{item.value}</span></span>
                        <div>
                          <button className="icon-action" aria-label={`Move ${item.value} up`} onClick={() => move(index, -1)} disabled={busy || index === 0}><ArrowUp size={16} /></button>
                          <button className="icon-action" aria-label={`Move ${item.value} down`} onClick={() => move(index, 1)} disabled={busy || index === current.items.length - 1}><ArrowDown size={16} /></button>
                          <button className="icon-action danger" aria-label={`Remove ${item.value}`} disabled={busy} onClick={() => void run(() => data.removeName(item.id), `${item.value} removed.`)}><X size={17} /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <div className="compact-empty names-empty"><b>This glossary is empty</b><span>Add a term below or paste several at once.</span></div>}
                {current.items.length > 0 && !current.items.some((item) => item.value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <div className="compact-empty names-empty"><b>No matching terms</b><span>Try another search.</span></div>}
                <form className="inline-create add-name-form" onSubmit={(e) => { e.preventDefault(); addNames(itemName); }}>
                  <label className="sr-only" htmlFor="new-item-name">Add a glossary term</label>
                  <input id="new-item-name" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Add a word, name, place, or phrase" maxLength={MAX_NAME_LENGTH} />
                  <button className="wp-button wp-button-primary" disabled={busy || !itemName.trim() || current.items.length >= MAX_NAMES}><Plus size={17} />Add term</button>
                </form>
                <details className="bulk-add">
                  <summary>Paste glossary terms</summary>
                  <label htmlFor="bulk-names">One per line, or separated with commas</label>
                  <textarea id="bulk-names" value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={"Relaya\nCebu City\nProject Aurora"} />
                  <button className="wp-button" onClick={() => addNames(bulk)} disabled={busy || !bulk.trim()}>Add terms</button>
                </details>
              </> : <EmptyState title="Create your first glossary" body="Collect the words and names you want Relaya to recognize." />}
              {notice && <SavedNote error={notice.error ?? false}>{notice.text}</SavedNote>}
            </section>
          </div>
        )}
        <StorageNote />
      </div>
    </AppShell>
  );
}
