import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

export function newPayrollApiPlugin(repoRoot: string): Plugin {
  return {
    name: "vellum-new-payroll-api",
    configureServer(server) {
      server.middlewares.use("/api/new-payroll", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        const script = path.join(repoRoot, "scripts", "deploy-testnet.ps1");
        if (!fs.existsSync(script)) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "deploy-testnet.ps1 not found" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");

        const child = spawn(
          "powershell",
          ["-ExecutionPolicy", "Bypass", "-File", script],
          { cwd: repoRoot, env: process.env, windowsHide: true },
        );

        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on("close", (code) => {
          if (code !== 0) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: stderr.trim() || `Deploy exited with code ${code}` }));
            return;
          }

          const env = parseEnvFile(path.join(repoRoot, "apps", "web", ".env.local"));
          const poolId = env.VITE_POOL_CONTRACT_ID ?? "";
          const tokenId = env.VITE_TOKEN_CONTRACT_ID ?? "";
          if (!poolId || !tokenId) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Deploy finished but .env.local is missing contract IDs" }));
            return;
          }

          res.end(JSON.stringify({ poolId, tokenId }));
        });
      });
    },
  };
}
