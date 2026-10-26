/*
 * Error reports to Sentry. Off unless SENTRY_DSN is set; the SDK is only
 * loaded when it is. Reports carry the error and the request id, never what
 * anyone said: no request bodies, headers or user details.
 */
type SentryNode = typeof import("@sentry/node");
let client: Promise<SentryNode | null> | undefined;

function sentry(): Promise<SentryNode | null> {
  if (client) return client;
  const dsn = process.env.SENTRY_DSN;
  client = !dsn ? Promise.resolve(null) : import("@sentry/node").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      ...(process.env.APP_VERSION ? { release: process.env.APP_VERSION } : {}),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
      beforeSend: (event) => {
        delete event.request;
        delete event.user;
        return event;
      },
    });
    return Sentry;
  }).catch(() => null);
  return client;
}

/** Something broke that we should look at. Never throws. */
export function reportError(error: unknown, where: string, requestId?: string): void {
  void sentry().then((Sentry) => {
    Sentry?.captureException(error, { tags: { where }, ...(requestId ? { extra: { requestId } } : {}) });
  }).catch(() => undefined);
}
