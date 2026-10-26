import { Link } from "react-router-dom";
import { copy } from "../copy/en.js";
import { EmptyState } from "../components/ui/EmptyState.js";

export function NotFoundPage() {
  return (
    <main className="session-page">
      <h1 className="sr-only">{copy.common.notFound}</h1>
      <EmptyState title={copy.common.notFound} body="" action={<Link className="btn btn-coral" to="/new">{copy.common.backHome}</Link>} />
    </main>
  );
}
