/*
 * Error reports to Sentry. Off unless VITE_SENTRY_DSN is set; the SDK is only
 * downloaded when it is. Reports carry the error and where it happened, never
 * what anyone said: no request bodies, console logs, typed text or
 * user details.
 */
export function startMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  void import("@sentry/browser").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      ...(import.meta.env.VITE_APP_VERSION ? { release: import.meta.env.VITE_APP_VERSION } : {}),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeBreadcrumb: (crumb) => (crumb.category === "console" || crumb.category === "ui.input" ? null : crumb),
      beforeSend: (event) => {
        if (event.request) delete event.request.data;
        delete event.user;
        return event;
      },
    });
  }).catch(() => undefined);
}
