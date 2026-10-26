import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import "./shell.css";

const COLLAPSE_KEY = "relaya.sidebar.collapsed";

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}

/** Sidebar + top bar around every signed-in page except /session/*. */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((value) => {
      try { localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1"); } catch { /* per-viewer convenience only */ }
      return !value;
    });
  };
  return (
    <div className={`app${collapsed ? " collapsed" : ""}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <section className="app-main">
        <TopBar title={title} />
        <main className="app-body"><div className="col">{children}</div></main>
      </section>
    </div>
  );
}
