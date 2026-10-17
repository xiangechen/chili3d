// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type AsyncController,
    type BoundingBox,
    command,
    GetOrSelectNodeStep,
    type I18nKeys,
    type IDocument,
    Id,
    type IEdge,
    type INode,
    type IStep,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    type SnapResult,
    Transaction,
    UNITLESS,
    type UnitSpec,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type {
    CircularPatternFeatureData,
    LinearPatternFeatureData,
    PatternLineSource,
} from "../features/feature";
import { idIsShared } from "../features/trackedId";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    PatternDragHandler,
    type PatternLine,
    type PatternPanelSink,
    PatternPreviewHandler,
    PatternSessionStep,
    type PatternStepHandler,
} from "./patternSession";
import { LineEdgeFilter } from "./shapeFilters";

/**
 * The Direction-2 pick: a line edge like the first direction's, but OPTIONAL — Enter (or the
 * confirm bar's success) with nothing picked skips it, and the pattern stays one-directional;
 * Escape cancels the whole run, as it does on every step. The two read apart through the
 * controller: a pick's Enter resolves it as a success however empty the selection is, while
 * Escape cancels it.
 */
export class Direction2Step implements IStep {
    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        // Clear first: the first direction's edge is still selected (its step keeps the
        // selection) and pickShape reports the selection — an empty accept must read empty.
        document.selection.clearSelection();
        const shapes = await document.picker.pickShape("prompt.select.direction2Edge", controller, {
            shapeType: ShapeTypes.edge,
            shapeFilter: new LineEdgeFilter(),
            nodeFilter: { allow: (node) => node instanceof ShapeNode },
            highlightState: VisualStates.edgeHighlight,
            selectedState: VisualStates.edgeSelected,
            showConfirmControl: true,
        });
        // Escape cancelled the controller — the step contract aborts the run on it.
        if (controller.result?.status !== "success") return undefined;
        return {
            view: document.application.activeView!,
            shapes,
            nodes: shapes.map((x) => x.owner.node),
            type: "shape",
        };
    }
}

/**
 * The shared flow of the two pattern commands: pick the parametric body (or take the selected
 * one), pick the line edge the pattern runs along — the direction for a linear pattern, the
 * rotation axis for a circular one — then a last step, always run, previews every copy as a
 * ghost until the confirm control (or Enter) commits the feature or ESC cancels with nothing
 * written. How the numbers edit is the mode's own: a linear pattern is panel-driven, the
 * preview simply following the options; a circular one adds a turn-handle drag session whose
 * hand writes the panel back. The edge is stored as a live reference (source-local
 * fingerprint plus the tracked id when the source carries one), so editing or moving the
 * source re-aims the copies on rebuild; count/spacing/angle/merge ride on the options panel
 * (and the feature row afterwards), skip on the feature row.
 *
 * A linear pattern interleaves an OPTIONAL second-direction pick between the first edge and
 * the preview (Direction2Step): skipped, the run is exactly the single-direction one; taken,
 * the panel grows the count2/spacing2 pair, the preview ghosts the grid, and the commit
 * carries the direction2/count2/spacing2 trio the feature data requires together.
 *
 * No new body and no boolean scope — a pattern appends to the chain of the body it is applied
 * to, exactly as a mirror does.
 */
abstract class PatternFeatureCommand extends MultistepCommand {
    protected abstract readonly mode: "linear" | "circular";
    /** The session step's prompt — the number its handle drags names it. */
    protected abstract readonly sessionTip: I18nKeys;

    /** The live preview/session, registered through the step data's `onReady`/`onDone`. */
    protected _session: PatternPanelSink | undefined;
    /** Set while the drag session's settled value is written back, so the setter does not echo it. */
    private _syncingFromSession = false;

    /** The live preview/session, for the modes' own pushes (they narrow it by class). */
    protected get session(): PatternPanelSink | undefined {
        return this._session;
    }

    /** Total instances, original included — a whole number of at least 2 (the feature re-checks). */
    @property("common.count", { unit: UNITLESS })
    get count(): ParameterValue {
        return this.getPrivateValue("count", 3);
    }
    set count(value: ParameterValue) {
        this.setProperty("count", value, () => {
            if (this._syncingFromSession) return;
            const resolved = this.resolveParameter(this.count, UNITLESS);
            if (resolved.isOk) this._session?.setCount(resolved.value);
        });
    }

    /** Fuse every copy into the input (the default) or keep the pattern an unmerged compound. */
    @property("option.command.merge")
    get merge(): boolean {
        return this.getPrivateValue("merge", true);
    }
    set merge(value: boolean) {
        this.setProperty("merge", value);
    }

    /** The panel field the drag edits — the spacing of a linear, the angle of a circular. */
    protected abstract get draggedValue(): ParameterValue;
    protected abstract set draggedValue(value: ParameterValue);

    /** The value the session opens with, resolved; 0 when the field's expression does not. */
    protected abstract sessionValue(body: ParametricBodyNode): number;

    protected override getSteps(): IStep[] {
        const steps: IStep[] = [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
            new SelectShapeStep(
                ShapeTypes.edge,
                this.mode === "linear" ? "prompt.select.lineEdge" : "prompt.select.axis",
                {
                    shapeFilter: new LineEdgeFilter(),
                    keepSelection: true,
                    highlightState: VisualStates.edgeHighlight,
                    selectedState: VisualStates.edgeSelected,
                },
            ),
        ];
        // Direction 2 is a linear grid's alone — a circular pattern has no second pick.
        if (this.mode === "linear") steps.push(new Direction2Step());
        steps.push(
            new PatternSessionStep(this.sessionTip, (document, controller) =>
                this.createSession(document, controller),
            ),
        );
        return steps;
    }

    /**
     * The picks any pattern session opens on: the picked body, the reference edge's LIVE world
     * line (the stored fingerprint path stays the commit's), and the panel count resolved.
     * Undefined when the picks cannot be read — the step then aborts the run rather than open
     * on a guessed frame.
     */
    protected sessionPreamble(): { body: ParametricBodyNode; line: PatternLine; count: number } | undefined {
        const body = this.stepDatas[0].nodes?.[0];
        if (!(body instanceof ParametricBodyNode)) return undefined;
        const line = this.worldLine(1);
        if (line === undefined) return undefined;
        const count = this.resolveParameter(this.count, UNITLESS);
        // An unresolvable count previews as the field's own default; the commit's
        // validateParams is what reports the expression.
        return { body, line, count: count.isOk ? count.value : 3 };
    }

    /** The last step's handler — the mode's own (a linear's ghost preview, a circular's drag session). */
    protected abstract createSession(
        document: IDocument,
        controller: AsyncController,
    ): PatternStepHandler | undefined;

    /** The picked edge of step `stepIndex` as a world line, read the feature's way (see `PatternLine`). */
    protected worldLine(stepIndex: number): PatternLine | undefined {
        const data = this.stepDatas[stepIndex]?.shapes?.[0];
        if (data === undefined) return undefined;
        const edge = data.shape as unknown as IEdge;
        const direction = edge.endPoint().sub(edge.startPoint()).normalize();
        if (direction === undefined) return undefined;
        return {
            point: data.transform.ofPoint(edge.startPoint()),
            direction: data.transform.ofVector(direction),
        };
    }

    /** Pushes a panel value into the live session; an unresolvable expression is not pushed. */
    protected pushSessionValue(value: ParameterValue, unit: UnitSpec): void {
        if (this._syncingFromSession) return;
        const resolved = this.resolveParameter(value, unit);
        if (resolved.isOk) this._session?.setValue(resolved.value);
    }

    /** The number the drag settled lands on the panel field — guarded against the echo. */
    protected syncFromSession(value: number): void {
        this._syncingFromSession = true;
        this.draggedValue = value;
        this._syncingFromSession = false;
    }

    /** The count a badge dialog settled lands on the panel field — guarded the same way. */
    protected syncCountFromSession(count: number): void {
        this._syncingFromSession = true;
        this.count = count;
        this._syncingFromSession = false;
    }

    protected override executeMainTask(): void {
        const body = this.stepDatas[0].nodes?.[0];
        if (!(body instanceof ParametricBodyNode)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a parametric body");
            return;
        }
        const source = this.lineSource(1);
        if (source === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a line edge");
            return;
        }
        if (!this.validateParams()) return;

        Transaction.execute(this.document, "excute feature.pattern", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(body, source)]);
            this.document.visual.update();
        });
    }

    /**
     * The options-panel values checked at commit time — a bad one toasts and aborts rather
     * than standing a feature up to fail its first rebuild. The base checks the count; the
     * modes add their spacing/angle.
     */
    protected validateParams(): boolean {
        const count = this.resolveParameter(this.count, UNITLESS);
        if (!count.isOk || !Number.isInteger(count.value) || count.value < 2) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Pattern count must be a whole number of at least 2",
            );
            return false;
        }
        return true;
    }

    /** The picked edge of step `stepIndex` as a live reference, carrying the source's tracked id when it has one. */
    protected lineSource(stepIndex: number): PatternLineSource | undefined {
        const data = this.stepDatas[stepIndex]?.shapes?.[0];
        if (data === undefined) return undefined;
        const node = data.owner.node;
        if (!(node instanceof ShapeNode)) return undefined;
        const edge = data.shape as unknown as IEdge;
        if (!isBodyTrackingNode(node)) return { nodeId: node.id, edge: captureEdgeRef(edge) };
        const edgeId = node.edgeIdAt(data.indexes[0]);
        const edges = node.shape.isOk ? (node.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[]) : [];
        const shared = idIsShared(
            edges.map((_, index) => node.edgeIdAt(index)),
            edgeId,
        );
        return { nodeId: node.id, edge: captureEdgeRef(edge, edgeId, shared) };
    }

    protected abstract feature(
        body: ParametricBodyNode,
        source: PatternLineSource,
    ): LinearPatternFeatureData | CircularPatternFeatureData;
}

/** The edge ref's start→end as a vector; the fingerprint carries both endpoints. */
function refDirection(edge: EdgeRef): XYZ | undefined {
    if (edge.kind !== "line") return undefined;
    return new XYZ(edge.end).sub(new XYZ(edge.start)).normalize();
}

/** The body's extent along `direction` — the spread of its bounding-box corners projected on it. */
function extentAlong(box: BoundingBox, direction: XYZ): number {
    let min = Infinity;
    let max = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                const projection = x * direction.x + y * direction.y + z * direction.z;
                min = Math.min(min, projection);
                max = Math.max(max, projection);
            }
        }
    }
    return max - min;
}

@command({ key: "feature.patternLinear", icon: "icon-array" })
export class LinearPatternFeatureCommand extends PatternFeatureCommand {
    protected readonly mode = "linear";
    protected readonly sessionTip: I18nKeys = "prompt.patternPreview";

    /**
     * Copy pitch along the direction. Empty means auto: the body's extent along the picked
     * direction plus a fifth (`defaultSpacing`). The preview's start converges it — the panel
     * is written the concrete value, so the field and the ghosts speak one number — and only
     * a run that never opened the preview still falls back to it here.
     */
    @property("feature.pattern.spacing", { unit: LENGTH_UNITS })
    get spacing(): ParameterValue {
        return this.getPrivateValue("spacing", "");
    }
    set spacing(value: ParameterValue) {
        this.setProperty("spacing", value, () => this.pushSessionValue(this.spacing, LENGTH_UNITS));
    }

    protected get draggedValue(): ParameterValue {
        return this.spacing;
    }
    protected set draggedValue(value: ParameterValue) {
        this.spacing = value;
    }

    protected sessionValue(body: ParametricBodyNode): number {
        if (this.spacing === "") {
            const source = this.lineSource(1);
            if (source !== undefined) this.spacing = this.defaultSpacing(body, source);
        }
        if (this.spacing === "") return 0;
        const resolved = this.resolveParameter(this.spacing, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    // ------------------------------------------------------------------ Direction 2

    /**
     * Whether the optional pick brought a second direction in — the flag the panel's
     * dependencies read to show the count2/spacing2 pair. Written when the preview opens
     * (the pick step has run by then), so the pair appears the moment it means something.
     */
    get hasDirection2(): boolean {
        return this.getPrivateValue("hasDirection2", false);
    }
    private set hasDirection2(value: boolean) {
        this.setProperty("hasDirection2", value);
    }

    /** Instances along Direction 2, the original row included — a whole number of at least 2. */
    @property("feature.pattern.count2", {
        unit: UNITLESS,
        dependencies: [{ property: "hasDirection2", value: true }],
    })
    get count2(): ParameterValue {
        return this.getPrivateValue("count2", 2);
    }
    set count2(value: ParameterValue) {
        this.setProperty("count2", value, () => {
            const resolved = this.resolveParameter(this.count2, UNITLESS);
            if (resolved.isOk) this.previewSession?.setCount2(resolved.value);
        });
    }

    /** Copy pitch along Direction 2. Empty means auto — converged the way `spacing` is. */
    @property("feature.pattern.spacing2", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "hasDirection2", value: true }],
    })
    get spacing2(): ParameterValue {
        return this.getPrivateValue("spacing2", "");
    }
    set spacing2(value: ParameterValue) {
        this.setProperty("spacing2", value, () => this.pushSessionValue2());
    }

    /** The live preview, narrowed for the direction-2 pushes. */
    private get previewSession(): PatternPreviewHandler | undefined {
        return this._session instanceof PatternPreviewHandler ? this._session : undefined;
    }

    /** The last step's handler: the ghost preview the panel drives. */
    protected createSession(
        document: IDocument,
        controller: AsyncController,
    ): PatternStepHandler | undefined {
        const preamble = this.sessionPreamble();
        if (preamble === undefined) return undefined;
        const { body, line, count } = preamble;
        const line2 = this.worldLine(2);
        this.hasDirection2 = line2 !== undefined;
        // Direction 2's pair rides along only when its pick brought one — a skipped pick
        // leaves the preview single-directional, however the (hidden) panel fields read.
        const direction2 =
            line2 === undefined
                ? {}
                : {
                      line2,
                      count2: this.resolvedCount2(),
                      value2: this.sessionValue2(body),
                  };
        return new PatternPreviewHandler(document, controller, {
            body,
            line,
            count,
            value: this.sessionValue(body),
            ...direction2,
            onReady: (handler) => {
                this._session = handler;
            },
            onDone: () => {
                this._session = undefined;
            },
        });
    }

    /**
     * Direction 2's count, resolved — the field's default stands in for an expression that
     * does not resolve; the commit's validation reports it.
     */
    private resolvedCount2(): number {
        const count2 = this.resolveParameter(this.count2, UNITLESS);
        return count2.isOk ? count2.value : 2;
    }

    /** The panel's spacing2 push — an unresolvable expression never reaches the preview. */
    private pushSessionValue2(): void {
        const resolved = this.resolveParameter(this.spacing2, LENGTH_UNITS);
        if (resolved.isOk) this.previewSession?.setValue2(resolved.value);
    }

    /** Direction 2's opening spacing — its own extent rule off its own picked edge. */
    private sessionValue2(body: ParametricBodyNode): number {
        if (this.spacing2 === "") {
            const source = this.lineSource(2);
            if (source !== undefined) this.spacing2 = this.defaultSpacing(body, source);
        }
        if (this.spacing2 === "") return 0;
        const resolved = this.resolveParameter(this.spacing2, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    protected override validateParams(): boolean {
        if (!super.validateParams()) return false;
        if (this.spacing !== "") {
            const spacing = this.resolveParameter(this.spacing, LENGTH_UNITS);
            if (!spacing.isOk || spacing.value === 0) {
                PubSub.default.pub("showToast", "error.default:{0}", "Invalid pattern spacing");
                return false;
            }
        }
        if (this.lineSource(2) === undefined) return true;

        // Direction 2 picked: its pair must hold, and it must not march the way direction 1
        // already does — a parallel second direction only stacks copies on the first
        // direction's own seats (the feature layer builds that overlap without a complaint;
        // the command refuses it as a mistake, not a grid).
        const count2 = this.resolveParameter(this.count2, UNITLESS);
        if (!count2.isOk || !Number.isInteger(count2.value) || count2.value < 2) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Pattern count 2 must be a whole number of at least 2",
            );
            return false;
        }
        if (this.spacing2 !== "") {
            const spacing2 = this.resolveParameter(this.spacing2, LENGTH_UNITS);
            if (!spacing2.isOk || spacing2.value === 0) {
                PubSub.default.pub("showToast", "error.default:{0}", "Invalid pattern spacing 2");
                return false;
            }
        }
        const [line1, line2] = [this.worldLine(1), this.worldLine(2)];
        if (line1 !== undefined && line2 !== undefined && line1.direction.isParallelTo(line2.direction)) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Direction 2 must not be parallel to direction 1",
            );
            return false;
        }
        return true;
    }

    protected feature(body: ParametricBodyNode, source: PatternLineSource): LinearPatternFeatureData {
        const source2 = this.lineSource(2);
        return {
            id: Id.generate(),
            type: "pattern",
            mode: "linear",
            direction: source,
            count: this.count,
            spacing: this.spacing === "" ? this.defaultSpacing(body, source) : this.spacing,
            // The contract: direction2 set means count2 and spacing2 come along — the trio
            // appears together or not at all.
            ...(source2 !== undefined
                ? {
                      direction2: source2,
                      count2: this.count2,
                      spacing2: this.spacing2 === "" ? this.defaultSpacing(body, source2) : this.spacing2,
                  }
                : {}),
            ...(this.merge ? {} : { merge: false }),
        };
    }

    /**
     * The spacing a pattern opens with: the body's extent along the picked direction plus a
     * fifth, so the first copy lands clear of the original; 50mm when the extent degenerates.
     */
    private defaultSpacing(body: ParametricBodyNode, source: PatternLineSource): number {
        const direction = refDirection(source.edge);
        const shape = body.shape;
        if (direction === undefined || !shape.isOk) return 50;
        const extent = extentAlong(shape.value.boundingBox(), direction);
        return extent > 1e-6 ? Math.round(extent * 1.2 * 1e6) / 1e6 : 50;
    }
}

@command({ key: "feature.patternCircular", icon: "icon-rotate" })
export class CircularPatternFeatureCommand extends PatternFeatureCommand {
    protected readonly mode = "circular";
    protected readonly sessionTip: I18nKeys = "prompt.dragToPatternAngle";

    /** The sweep the copies fill; with equal spacing on, 360° keeps the last copy off the first. */
    @property("common.angle", { unit: ANGLE_UNITS })
    get angle(): ParameterValue {
        return this.getPrivateValue("angle", 360);
    }
    set angle(value: ParameterValue) {
        this.setProperty("angle", value, () => this.pushSessionValue(this.angle, ANGLE_UNITS));
    }

    /** Evenly fill `angle` (step = angle/count) instead of spacing the copies to its ends. */
    @property("feature.pattern.equalSpacing")
    get equalSpacing(): boolean {
        return this.getPrivateValue("equalSpacing", true);
    }
    set equalSpacing(value: boolean) {
        this.setProperty("equalSpacing", value, () => this.dragSession?.setEqualSpacing(value));
    }

    protected get draggedValue(): ParameterValue {
        return this.angle;
    }
    protected set draggedValue(value: ParameterValue) {
        this.angle = value;
    }

    protected sessionValue(): number {
        const resolved = this.resolveParameter(this.angle, ANGLE_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    /** The live drag session, narrowed for the equalSpacing push. */
    private get dragSession(): PatternDragHandler | undefined {
        return this._session instanceof PatternDragHandler ? this._session : undefined;
    }

    /** The last step's handler: the turn-handle drag session, writing the panel back as it drags. */
    protected createSession(
        document: IDocument,
        controller: AsyncController,
    ): PatternStepHandler | undefined {
        const preamble = this.sessionPreamble();
        if (preamble === undefined) return undefined;
        const { body, line, count } = preamble;
        return new PatternDragHandler(document, controller, {
            body,
            line,
            count,
            value: this.sessionValue(),
            equalSpacing: this.equalSpacing,
            onValue: (value) => this.syncFromSession(value),
            onCount: (count) => this.syncCountFromSession(count),
            resolve: (input, unit) => this.resolveParameter(input, unit),
            onReady: (handler) => {
                this._session = handler;
            },
            onDone: () => {
                this._session = undefined;
            },
        });
    }

    protected override validateParams(): boolean {
        if (!super.validateParams()) return false;
        const angle = this.resolveParameter(this.angle, ANGLE_UNITS);
        if (!angle.isOk || angle.value === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid pattern angle");
            return false;
        }
        return true;
    }

    protected feature(_body: ParametricBodyNode, source: PatternLineSource): CircularPatternFeatureData {
        return {
            id: Id.generate(),
            type: "pattern",
            mode: "circular",
            axis: source,
            count: this.count,
            angle: this.angle,
            equalSpacing: this.equalSpacing,
            ...(this.merge ? {} : { merge: false }),
        };
    }
}
