import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ProfilePage } from "../features/account/ProfilePage.js";
import { AuthCallbackPage } from "../features/auth/AuthCallbackPage.js";
import { EmailConfirmedPage } from "../features/auth/EmailConfirmedPage.js";
import { AuthGuard } from "../features/auth/AuthGuard.js";
import { LoginPage } from "../features/auth/LoginPage.js";
import { RootRedirect } from "../features/auth/RootRedirect.js";
import { JoiningPage } from "../features/meeting-link/JoiningPage.js";
import { ChooseModePage } from "../features/new-session/ChooseModePage.js";
import { SessionPage } from "../features/session/SessionPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { PrivacyPage, TermsPage } from "../features/legal/LegalPages.js";
import { BillingPage, HelpPage, NamesPage, NotificationsPage, SearchPage, SettingsPage, VoicePage } from "../features/workspace/WorkspacePages.js";
import { SessionSummaryPage, SessionsPage } from "../features/sessions/SessionsPages.js";

/** Route table. */
export function AppRoutes() {
  const guard = (element: JSX.Element) => <AuthGuard>{element}</AuthGuard>;
  const navigate = useNavigate();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); navigate("/search"); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [navigate]);
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/email-confirmed" element={<EmailConfirmedPage />} />

      <Route path="/new" element={guard(<ChooseModePage />)} />
      <Route path="/new/link" element={<Navigate to="/new" replace />} />
      <Route path="/new/joining" element={guard(<JoiningPage />)} />
      <Route path="/session/:sessionId" element={guard(<SessionPage />)} />

      <Route path="/profile" element={guard(<ProfilePage />)} />
      <Route path="/names" element={guard(<NamesPage />)} />
      <Route path="/voice" element={guard(<VoicePage />)} />
      <Route path="/settings/*" element={guard(<SettingsPage />)} />
      <Route path="/sessions" element={guard(<SessionsPage />)} />
      <Route path="/sessions/:sessionId" element={guard(<SessionSummaryPage />)} />
      <Route path="/billing" element={guard(<BillingPage />)} />
      <Route path="/notifications" element={guard(<NotificationsPage />)} />
      <Route path="/search" element={guard(<SearchPage />)} />
      <Route path="/help" element={guard(<HelpPage />)} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
