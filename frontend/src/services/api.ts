/** Where the Relaya API lives. Same origin (/api) in production unless VITE_API_URL says otherwise. */
export const apiBase = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

/** Locally the scripted mocks run unless a developer points the app at a real API. */
export const realApi = import.meta.env.PROD || Boolean(import.meta.env.VITE_API_URL);
