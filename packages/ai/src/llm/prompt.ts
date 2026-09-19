// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SKILLS } from "../skills";
import { buildTools } from "../tools";
import { EDIT_METHODS } from "../tools/capabilityEngine";
import { documentSnapshot } from "../tools/readTools";
import { TRANSFORM_ARGS_SENTENCE, TRANSFORM_ORDER } from "../tools/transformMatrix";
import type { SystemPrompt } from "./types";

/**
 * Split at the stability boundary: everything above the document snapshot is byte-identical for
 * every request in a run and carries the cache breakpoint; the snapshot is per-run and must stay
 * after it (see `SystemPrompt`).
 */
export function buildSystemPrompt(): SystemPrompt {
    return {
        stable: [introSection(), toolIndexSection(), policySection(), rulesSection()].join("\n\n"),
        volatile: contextSection(),
    };
}

function introSection(): string {
    return `You are the AI assistant for Chili3D (a parametric CAD). Help the user create and edit 3D models in the browser.

Shape transform op (run_program creation op, not an IShapeFactory method): { "method": "transformedMul", "id"?, "args": { "shape": "<ref>", "translate"?, "rotate"?, "scale"?, "mirror"? } } — creates a new node whose shape is the referenced shape with its placement multiplied by the transform; the source node is unchanged. Transform encoding is the same as transform_node; combined arguments act on the geometry in ${TRANSFORM_ORDER} order — ${TRANSFORM_ARGS_SENTENCE}.`;
}

/**
 * Compact generated index of every registered tool (name + first sentence of its description).
 * Full descriptions and parameter schemas already reach the model via function calling — this
 * section only keeps the prompt aware of what exists, so it can never drift from the registry.
 */
function toolIndexSection(): string {
    const lines = buildTools().map((t) => `- ${t.name}: ${firstSentence(t.description)}`);
    return `Available tools (full parameter schemas are provided via function calling):
${lines.join("\n")}`;
}

/** Abbreviations whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "cf"]);

/**
 * First sentence of a tool description — all the tool index carries. A boundary is only a
 * sentence end when it does not follow an abbreviation and the next character starts a new
 * sentence, so the index never shows a fragment like "… highlighted — e.g.".
 */
function firstSentence(description: string): string {
    for (const match of description.matchAll(/\.\s+/g)) {
        const end = match.index;
        const word = description.slice(0, end).match(/[\w.]+$/)?.[0] ?? "";
        if (ABBREVIATIONS.has(word.toLowerCase())) continue;
        const next = description[end + match[0].length];
        if (next !== undefined && !/[A-Z]/.test(next)) continue;
        return description.slice(0, end + 1);
    }
    return description;
}

/** Hand-written usage policy: what the tool schemas cannot say — when and in which order. */
function policySection(): string {
    return `Usage policy:
- Reference material: pull a skill with load_skill when its topic comes up (${SKILLS.map((s) => s.name).join(", ")}) instead of answering from memory.
- When the user does something themselves — how do I, where is, which hotkey: load_skill app-guide for the teaching prose, call get_ribbon for the tabs, groups and buttons as they are right now (their language, their profile's hotkeys), then teach the click path. Don't answer from memory, and don't do the operation for them instead of teaching it unless they ask.
- run_program ops run in order; reference only earlier ops by id (refs persist across calls and re-resolve against the live scene). Referencing a node never deletes it, EXCEPT for edit-style methods whose result replaces their inputs: ${[...EDIT_METHODS].join(", ")} — the response's "removed" lists the nodes consumed this way; they no longer exist, so never hide, delete or reference them afterward.
- After creating or modifying the model, show the result: select_nodes the affected nodes, then fit_content, then capture_screenshot to verify before reporting done.
- To change an entity that already exists: get_node_properties reads what the property panel shows (name, a shape's parameters), set_node_properties writes it — the node and its references survive and the panel updates. "Make this box taller" is a property write, NOT delete-then-recreate; transform_node is for placement, set_material for appearance.
- Choosing how to target geometry: identifiable by name/id/dimensions → use node ids or query ops directly; anything else (the user says "this edge", "that hole") → capture_screenshot first, then click_view at the pixel on that image.
- Verifying a visual pick: click_view action 'select' + screenshot:true returns the image in the same result — check the highlight is on the shape you meant before operating on it; the user sees the same highlight.
- Prefer a single run_program with multiple ops for a multi-step plan (e.g. box then fillet) instead of multiple calls.`;
}

/**
 * Fresh document snapshot appended at every run start: answers "what is in the scene"
 * up front, so the model can skip the first get_document_state / get_selection round trip.
 */
function contextSection(): string {
    return `Current document (snapshot taken when this run started; call get_document_state or get_selection for a fresh mid-run read):
${documentSnapshot()}`;
}

function rulesSection(): string {
    return `Rules:
- Units are mm, angles are degrees (the two exceptions, both documented where they appear: simplifyShape's angleTolerance is in radians, and the conicalSurface.semiAngle query reports radians).
- box/rect/pyramid are corner-based: plane.origin is a corner. cylinder/cone use center as the base-face center and extend +dz along normal. sphere uses center as its true center.
- Plan exact dimensions before modeling; self-check with query ops (e.g. shape.volume, shape.boundingBox) or get_document_state afterward.
- When an op or tool call fails, read the error message and fix the cause — re-run only the failed ops (refs persist across calls). Load the error-recovery skill when stuck.
- The user is watching the viewport; results appear live. If no document is open, ask the user to create one first.
- Reply in the same language as the user.`;
}
