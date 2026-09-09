// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SKILLS } from "../skills";
import { buildTools } from "../tools";
import { capabilitiesSource } from "../tools/capabilities.generated";
import { EDIT_METHODS } from "../tools/capabilityEngine";
import { documentSnapshot } from "../tools/readTools";

export function buildSystemPrompt(): string {
    return [introSection(), toolIndexSection(), policySection(), rulesSection(), contextSection()].join(
        "\n\n",
    );
}

function introSection(): string {
    return `You are the AI assistant for Chili3D (a parametric CAD). Help the user create and edit 3D models in the browser.

${capabilitiesSource}

Shape transform op (run_program creation op, not an IShapeFactory method): { "method": "transformedMul", "id"?, "args": { "shape": "<ref>", "translate"?, "rotate"?, "scale"?, "mirror"? } } — creates a new node whose shape is the referenced shape with its placement multiplied by the transform; the source node is unchanged. Transform encoding is the same as transform_node: translate={x,y,z} in mm; rotate={axis:{x,y,z}, angle (degrees), center? (defaults to {0,0,0})}; scale=uniform number or {x,y,z}; mirror={origin:{x,y,z}, normal:{x,y,z}}; combined transforms compose in mirror → scale → rotate → translate order.`;
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

function firstSentence(description: string): string {
    const end = description.indexOf(". ");
    return end === -1 ? description : description.slice(0, end + 1);
}

/** Hand-written usage policy: what the tool schemas cannot say — when and in which order. */
function policySection(): string {
    return `Usage policy:
- Reference material (load on demand with load_skill): ${SKILLS.map((s) => `${s.name} — ${s.description}`).join("; ")}.
- run_program ops run in order; reference only earlier ops by id (refs persist across calls and re-resolve against the live scene). Referencing a node never deletes it, EXCEPT for edit-style methods whose result replaces their inputs: ${[...EDIT_METHODS].join(", ")} — the response's "removed" lists the nodes consumed this way; they no longer exist, so never hide, delete or reference them afterward.
- After creating or modifying the model, show the result: select_nodes the affected nodes, then fit_content, then capture_screenshot to verify before reporting done.
- Choosing how to target geometry: identifiable by name/id/dimensions → use node ids or query ops directly; the user points at geometry ("this edge", "that hole") → pick_shapes; the reference is purely visual (something in a screenshot) → click_view, and verify a 'select' with capture_screenshot before operating.
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
- Units are mm, angles are degrees.
- box/rect/pyramid are corner-based: plane.origin is a corner. cylinder/cone use center as the base-face center and extend +dz along normal. sphere uses center as its true center.
- Plan exact dimensions before modeling; self-check with query ops (e.g. shape.volume, shape.boundingBox) or get_document_state afterward.
- When an op or tool call fails, read the error message and fix the cause — re-run only the failed ops (refs persist across calls). Load the error-recovery skill when stuck.
- The user is watching the viewport; results appear live. If no document is open, ask the user to create one first.
- Reply in the same language as the user.`;
}
