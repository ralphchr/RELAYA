import { serve } from "@hono/node-server";
import app from "./app.js";

const port = Number(process.env.PORT || 8787);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`Relaya API listening on http://127.0.0.1:${info.port}/api`);
});
