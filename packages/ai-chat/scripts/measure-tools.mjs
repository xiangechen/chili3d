// One-off: estimate per-tool token cost. Run with:
//   node --experimental-strip-types scripts/measure-tools.mjs   (Node 22+)
// or tsx scripts/measure-tools.mjs
import { tool } from "ai";
import { schemas, toolDescriptions } from "../src/tools/schemas.ts";

// Uses ai SDK's own serialization: tool() → provider-shaped definition that
// gets sent on every request. We stringify the JSON that the provider sees.
const est = (s) => Math.ceil(s.length / 4); // ~4 chars/token rough heuristic

const rows = [];
let totalChars = 0;
let totalTokens = 0;

for (const [name, schema] of Object.entries(schemas)) {
    const def = tool({
        description: toolDescriptions[name],
        inputSchema: schema,
    });
    // The provider gets name + description + the JSON Schema version of input.
    // We re-derive the JSON Schema the SDK would emit via the tool() wrapper.
    const wire = {
        name,
        description: toolDescriptions[name],
        input_schema: def.inputSchema,
    };
    const serialized = JSON.stringify(wire);
    const chars = serialized.length;
    const tokens = est(serialized);
    totalChars += chars;
    totalTokens += tokens;
    rows.push({ name, chars, tokens });
}

rows.sort((a, b) => b.tokens - a.tokens);
console.log("Tool".padEnd(24), "Chars".padStart(8), "~Tokens".padStart(10));
console.log("-".repeat(44));
for (const r of rows) {
    console.log(r.name.padEnd(24), String(r.chars).padStart(8), String(r.tokens).padStart(10));
}
console.log("-".repeat(44));
console.log("TOTAL".padEnd(24), String(totalChars).padStart(8), String(totalTokens).padStart(10));
console.log(`\n${rows.length} tools.`);

// Also measure the system prompt.
import { SYSTEM_PROMPT } from "../src/tools/system-prompt.ts";

console.log(`\nSystem prompt: ${SYSTEM_PROMPT.length} chars ≈ ${Math.ceil(SYSTEM_PROMPT.length / 4)} tokens`);
console.log(
    `Fixed per-request overhead (tools + system): ≈ ${totalTokens + Math.ceil(SYSTEM_PROMPT.length / 4)} tokens`,
);
