import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

function serveGraphs(): Plugin {
  return {
    name: "serve-graphs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "";
        // Vite turns `import cloud.json` into a module URL with a query. Leave those
        // alone; this middleware only serves the raw files fetched by `?graph=`.
        if (rawUrl.includes("?")) return next();
        const url = rawUrl;
        if (!url.startsWith("/tests/graphs/")) return next();
        const name = path.basename(url);
        if (!/^[a-z0-9_-]+\.json$/.test(name)) return next();
        const file = path.join(root, "tests/graphs", name);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end(`missing graph ${name}`);
          return;
        }
        res.setHeader("content-type", "application/json");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveGraphs()],
  server: { host: true, port: 5173 },
});
