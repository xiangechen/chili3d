// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    Combobox,
    command,
    type I18nKeys,
    type IEdge,
    type Plane,
    PubSub,
    property,
    ShapeTypes,
    type VisualShapeData,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../../features/bodyTracking";
import type { EdgeRef, Vec3 } from "../../features/edgeRef";
import { ParametricBodyNode } from "../../parametricBodyNode";
import type { SketchEditor } from "../editor/sketchEditor";
import { captureExternalRef, isEdgeCoplanarWithPlane } from "../externalRef";
import { type ExternalRefData, isExternalEntityId } from "../sketchModel";
import { SketchConstraintCommand } from "./sketchConstraints";

const ROLE_REFERENCE: I18nKeys = "option.command.externalRole.reference";

function sameVec(a: Vec3, b: Vec3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Fingerprint equality, field by field — JSON.stringify equality is key-order sensitive. */
function sameEdgeFingerprint(a: EdgeRef, b: EdgeRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "line" && b.kind === "line") {
        return sameVec(a.start, b.start) && sameVec(a.end, b.end);
    }
    if (a.kind === "circle" && b.kind === "circle") {
        return sameVec(a.center, b.center) && a.radius === b.radius && sameVec(a.axis, b.axis);
    }
    if (a.kind === "other" && b.kind === "other") {
        return sameVec(a.mid, b.mid) && a.length === b.length;
    }
    return false;
}

/** Same source edge: identical kernel edgeId when both carry one, else identical fingerprint. */
function sameExternalEdge(a: ExternalRefData, b: ExternalRefData): boolean {
    if (a.nodeId !== b.nodeId) return false;
    if (a.edge.edgeId !== undefined && b.edge.edgeId !== undefined) {
        return a.edge.edgeId === b.edge.edgeId;
    }
    return sameEdgeFingerprint(a.edge, b.edge);
}

function projectEdge(
    editor: SketchEditor,
    plane: Plane,
    picked: VisualShapeData,
    role: ExternalRefData["role"],
    existing: ExternalRefData[],
): boolean {
    const worldEdge = (picked.shape as IEdge).transformedMul(picked.transform) as IEdge;
    try {
        if (!isEdgeCoplanarWithPlane(plane, worldEdge)) return false;
        const owner = picked.owner.node;
        const edgeId = isBodyTrackingNode(owner) ? owner.edgeIdAt(picked.indexes[0]) : undefined;
        // solver-side monotonic counter — deleted ids are never reissued
        const ref = captureExternalRef(
            editor.solver.allocateExternalEntityId(),
            owner.id,
            plane,
            worldEdge,
            edgeId,
            role,
        );
        if (ref === undefined || existing.some((r) => sameExternalEdge(r, ref))) return false;
        // an explicitly chosen profile role is pinned, or the next role
        // derivation would revert it while no constraint references the edge
        if (role === "profile") ref.pinned = true;
        editor.solver.addExternalEntity(ref);
        // anchor the body's timeline position on its first reference —
        // a body referenced for the first time is anchored as it is now
        if (owner instanceof ParametricBodyNode) {
            editor.solver.recordRefPosition(owner.id, owner.features.length);
        }
        existing.push(ref);
        return true;
    } finally {
        worldEdge.dispose();
    }
}

/**
 * Projects picked scene edges onto the active sketch as external references.
 * Only edges coplanar with the sketch plane whose curve is a line or a circle
 * (full or trimmed) can be projected; the role option decides whether they also
 * participate in profile building.
 */
@command({ key: "sketch.projectEdges", icon: "icon-projectEdges" })
export class ProjectSketchEdges extends SketchConstraintCommand {
    @property("option.command.externalRole", {
        combobox: Combobox.from([ROLE_REFERENCE, "option.command.externalRole.profile"] satisfies I18nKeys[]),
    })
    get role(): I18nKeys {
        return this.getPrivateValue("role", ROLE_REFERENCE);
    }
    set role(value: I18nKeys) {
        this.setProperty("role", value);
    }

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const document = editor.document;
        this.controller = new AsyncController();
        const picked = await document.picker.pickShape("prompt.select.edges", this.controller, {
            shapeType: ShapeTypes.edge,
            multi: true,
            // projecting the sketch's own edges is pointless
            nodeFilter: { allow: (node) => node !== editor.node },
        });
        this.controller.dispose();
        document.selection.clearSelection();
        if (picked.length === 0) return;

        const plane = editor.node.plane;
        const existing = editor.solver.toData().externalRefs ?? [];
        const role: ExternalRefData["role"] = this.role === ROLE_REFERENCE ? "reference" : "profile";
        let added = 0;
        for (const x of picked) {
            if (projectEdge(editor, plane, x, role, existing)) added++;
        }
        if (added === 0) {
            PubSub.default.pub("displayError", "sketch.noProjectableEdges");
            return;
        }
        editor.refreshExternalDisplay();
        editor.solve(true);
        editor.commit();
    }
}

const flipRole = (role: ExternalRefData["role"]): ExternalRefData["role"] =>
    role === "reference" ? "profile" : "reference";

/**
 * Flips picked external references between reference and profile roles — profile-role
 * edges join profile building (they close loops into faces), reference-role ones stay
 * construction-only. Picks repeat until ESC; a single commit records all flips.
 */
@command({ key: "sketch.toggleExternal", icon: "icon-toggleExternal" })
export class ToggleSketchExternalRole extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        let flipped = false;
        while (true) {
            this.controller = new AsyncController();
            const id = await editor.pickEntity(
                "prompt.pickExternalRef",
                undefined,
                undefined,
                this.controller,
            );
            this.controller.dispose();
            if (id === undefined) break;
            if (!isExternalEntityId(id)) {
                PubSub.default.pub("statusBarTip", "prompt.pickExternalRef");
                continue;
            }
            // geometry is untouched — syncExternalRefs only adopts the flipped roles;
            // pinning marks the explicit choice so role auto-derivation keeps it
            const refs = (editor.solver.toData().externalRefs ?? []).map((ref) =>
                ref.entityId === id ? { ...ref, role: flipRole(ref.role), pinned: true } : ref,
            );
            editor.solver.syncExternalRefs(refs);
            editor.refreshExternalDisplay();
            flipped = true;
        }
        if (flipped) editor.commit();
    }
}
