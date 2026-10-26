import { BrowserRouter } from "react-router-dom";
import { AccountProvider } from "../features/account/AccountProvider.js";
import { SessionPersistence } from "../features/auth/SessionPersistence.js";
import { SessionDraftProvider } from "../features/new-session/draft.js";
import { ServicesProvider } from "../services/ServicesProvider.js";
import type { Services } from "../services/types.js";
import { AppRoutes } from "./routes.js";

/** Providers + router. Screens live in features/, the route table in routes.tsx. */
export function App({ services }: { services?: Services }) {
  return (
    <SessionPersistence>
      <ServicesProvider {...(services ? { services } : {})}>
        <AccountProvider>
          <SessionDraftProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AppRoutes />
            </BrowserRouter>
          </SessionDraftProvider>
        </AccountProvider>
      </ServicesProvider>
    </SessionPersistence>
  );
}
