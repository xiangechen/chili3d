// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EdgeMeshData,
    MultistepCommand,
    type Property,
    PubSub,
    property,
    VisualConfig,
} from "@chili3d/core";
import { applyAutoConstraints } from "../autoConstraints";
import { curveChainMesh } from "../curveMesh";
import { SketchEditor } from "../editor/sketchEditor";
import { type SketchConstraintData, toUV } from "../sketchModel";
import { typedDimension } from "../typedDimension";
import { autoReference } from "./sketchDimensions";

/**
 * Base class for in-sketch step commands: requires an active sketch editing session.
 */
export abstract class SketchMultistepCommand extends MultistepCommand {
    /**
     * Construction mode: the committed entity becomes reference geometry (dashed,
     * excluded from profiles). Shared by every draw command — the checkbox set on one of
     * them applies to the others and sticks until unticked, which `cacheKeyOfProperty`
     * below keeps on the process-wide bare-name key.
     */
    @property("option.command.construction")
    get construction(): boolean {
        return this.getPrivateValue("construction", false);
    }
    set construction(value: boolean) {
        this.setProperty("construction", value);
    }

    /**
     * `construction` is the one option the draw commands share (see its doc): the base
     * class scopes every cached option to its own command, so the shared one keeps the
     * bare-name key here.
     */
    protected override cacheKeyOfProperty(property: Property): string {
        if (property.name === "construction") return property.name;
        return super.cacheKeyOfProperty(property);
    }

    protected override canExcute(): Promise<boolean> {
        if (SketchEditor.getActive() === undefined) {
            PubSub.default.pub("displayError", "No active sketch editor");
            return Promise.resolve(false);
        }
        return Promise.resolve(true);
    }

    protected get editor(): SketchEditor {
        return SketchEditor.getActive()!;
    }

    /**
     * Whether a freshly committed entity takes the drawing hints' auto-constraints (see
     * `applyAutoConstraints`). A command whose entity's points the *tool* derived answers no:
     * those points are not the user's, and a snap onto whatever happens to lie near one —
     * the neighbouring segment's own curve, say — would be fought by the derivation that
     * placed it. Such a command states the relations it means itself.
     */
    protected takesAutoConstraints(): boolean {
        return true;
    }

    /**
     * Which of a freshly committed entity's points take those auto-constraints: `undefined` for
     * every point, or the indices of the ones the *user* placed. A command that derives some of
     * its points — an ellipse's minor probe is projected onto the major axis's perpendicular,
     * not picked — answers with the picked ones, so a snap cannot pull a derived point off the
     * shape the derivation just placed it on.
     */
    protected autoConstraintPoints(): readonly number[] | undefined {
        return undefined;
    }

    /** Applies auto-constraints to a freshly added entity, then solves and commits. */
    protected commitNewEntity(entityId: number): void {
        if (this.construction) this.editor.solver.setConstruction(entityId, true);
        if (this.takesAutoConstraints()) {
            applyAutoConstraints(
                this.editor.solver,
                entityId,
                { pointTolerance: this.editor.screenTolerance() },
                this.autoConstraintPoints(),
            );
        }
        this.solveAndCommit(this.typedDimensions(entityId));
    }

    /**
     * The dimensions a typed lone number asked for on the entity just built. Empty when the
     * pick was a click — the hints' inference is the whole of what an untyped entity gets —
     * and when the number was not one a dimension can hold (see `typedDimension`).
     *
     * Read at the step that carries the entity's size, not at the last one: an arc's and the
     * ellipse family's last pick fixes a direction and takes no number at all, and a chain's
     * later segments would otherwise read the pick before them.
     */
    protected typedDimensions(entityId: number): Omit<SketchConstraintData, "id">[] {
        if (!this.hasTypedNumber(1)) return [];

        const dimension = typedDimension(this.editor.solver, entityId);
        return dimension === undefined ? [] : [dimension];
    }

    /**
     * Whether the pick at `index` was a single typed number — the one form of input that
     * states a reading of the entity. A click states none, a pair of numbers states where the
     * point goes, and absolute `#x,y,z` coordinates state that too; what any of them states is
     * not a measurement, which is the whole of what that number itself would be read for.
     */
    protected hasTypedNumber(index: number): boolean {
        const input = this.stepDatas[index]?.input;
        return input !== undefined && !input.absolute && input.values.length === 1;
    }

    /**
     * Whether the pick at `index` was a typed pair — the offsets, in the sketch's own (u, v),
     * of where the point was to go from the step's reference point. A lone number is not one,
     * and neither is a click.
     */
    protected hasTypedOffsets(index: number): boolean {
        const input = this.stepDatas[index]?.input;
        return input !== undefined && !input.absolute && input.values.length === 2;
    }

    /**
     * Adds the constraints a typed pick asked for, solves, drops to a reference whatever the
     * sketch turned out to already hold, then commits.
     *
     * Adding them here rather than in the caller is what keeps a drawn entity one undo step:
     * `commit` is the only transaction boundary, and everything put into the solver before it —
     * the entity, the hints' auto-constraints, these — lands inside that one.
     */
    protected solveAndCommit(constraints: readonly Omit<SketchConstraintData, "id">[] = []): void {
        const added = constraints.map((constraint) => this.editor.solver.addConstraint(constraint));
        this.editor.solve(true);
        for (const id of added) autoReference(this.editor, id);
        this.editor.commit();
    }

    /** Sketch (u, v) of the point picked by the step at `index`. */
    protected uvOf(index: number): [number, number] {
        return toUV(this.editor.node.plane, this.stepDatas[index].point!);
    }

    /**
     * A numeric-curve preview from its sketch-uv polyline: the ellipse and the free curves
     * draw sampled (`curveEval.sampleEntity`), where a line or an
     * arc has a kernel shape to preview instead.
     */
    protected meshCurvePolyline(
        uvs: readonly [number, number][],
        color: number = VisualConfig.defaultEdgeColor,
    ): EdgeMeshData {
        // the same chain the committed entity draws as, so the preview is the edge to come
        return curveChainMesh(this.editor.node.plane, uvs, color);
    }
}
