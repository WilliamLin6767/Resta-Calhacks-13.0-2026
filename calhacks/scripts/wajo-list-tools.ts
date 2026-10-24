// One-off: list the tools the Wajo MCP server offers, without calling any of them.
// Run from calhacks/:  node --env-file=.env.local scripts/wajo-list-tools.ts
// Writes lib/wajo/TOOLS.md. Never prints the API key.

import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const WAJO_MCP_URL = "https://mcp.api.wajo.ai/fo";

const key = process.env.WAJO_API_KEY;
if (!key) {
  console.error("WAJO_API_KEY is not set. Run with: node --env-file=.env.local scripts/wajo-list-tools.ts");
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(WAJO_MCP_URL), {
  requestInit: { headers: { Authorization: `Bearer ${key}` } },
});
const client = new Client({ name: "calhacks-wajo-list-tools", version: "0.1.0" });

await client.connect(transport);

// listTools() is paginated; follow nextCursor until the server stops sending one.
const tools = [];
let cursor: string | undefined;
do {
  const page = await client.listTools(cursor ? { cursor } : undefined);
  tools.push(...page.tools);
  cursor = page.nextCursor;
} while (cursor);

const server = client.getServerVersion();
const instructions = client.getInstructions();

const md = [
  "# Wajo MCP tools",
  "",
  `Listed from ${WAJO_MCP_URL} on ${new Date().toISOString().slice(0, 10)} by scripts/wajo-list-tools.ts (listTools only; no tool was called).`,
  "",
  `Server: ${server?.name ?? "?"} ${server?.version ?? ""}`.trim(),
  "",
  ...(instructions ? ["## Server instructions", "", instructions, ""] : []),
  `## Tools (${tools.length})`,
  "",
  ...tools.flatMap((t) => [
    `### ${t.name}`,
    "",
    ...(t.title ? [`Title: ${t.title}`, ""] : []),
    t.description ?? "(no description)",
    "",
    ...(t.annotations ? ["Annotations:", "", "```json", JSON.stringify(t.annotations, null, 2), "```", ""] : []),
    "Input schema:",
    "",
    "```json",
    JSON.stringify(t.inputSchema, null, 2),
    "```",
    "",
    ...(t.outputSchema ? ["Output schema:", "", "```json", JSON.stringify(t.outputSchema, null, 2), "```", ""] : []),
  ]),
].join("\n");

mkdirSync("lib/wajo", { recursive: true });
writeFileSync("lib/wajo/TOOLS.md", md);
console.log(md);

await client.close();
