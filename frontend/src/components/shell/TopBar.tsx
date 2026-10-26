import { Link } from "react-router-dom";
import { Bell, CircleHelp } from "lucide-react";
import { copy } from "../../copy/en.js";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="topbar">
      <h1 className="pt">{title}</h1>
      <div className="tb-r">
        <Link className="tb-ic" to="/help" aria-label={copy.shell.help}><CircleHelp className="icon" /></Link>
        <Link className="tb-ic" to="/notifications" aria-label={copy.shell.notifications}><Bell className="icon" /></Link>
      </div>
    </header>
  );
}
