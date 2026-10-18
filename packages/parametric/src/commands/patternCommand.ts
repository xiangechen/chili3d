// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    AsyncController,
    type BoundingBox,
    command,
    GetOrSelectNodeStep,
    type I18nKeys,
    type IDocument,
    Id,
    type IEdge,
    type INode,
    type IStep,
    isReferenceGeometryNode,
    isSameShapeData,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    UNITLESS,
    type UnitSpec,
    type VisualShapeData,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef } from "../features/edgeRef";
import type {
    CircularPatternFeatureData,
    LinearPatternFeatureData,
    PatternLineSource,
} from "../features/feature";
import { idIsShared } from "../features/trackedId";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    PATTERN_SESSION_CURSOR,
    PatternDragHandler,
    type PatternLine,
    type PatternPanelSink,
    PatternPreviewHandler,
    PatternSessionStep,
    type PatternStepHandler,
} from "./patternSession";
import { LineEdgeFilter } from "./shapeFilters";

/**
 * The shared flow of the two pattern commands: pick the parametric body (or take the selected
 * one), pick the line edge the pattern runs along — the direction for a linear pattern, the
 * rotation axis for a circular one — then a last step, always run, previews every copy as a
 * ghost until the confirm control (or Enter) commits the feature or ESC cancels with nothing
 * written. How the numbers edit is the mode's own: a linear pattern puts an arrow per
 * direction on the canvas, each dragging its spacing while the panel follows; a circular one
 * adds a turn-handle drag session whose hand writes the panel back. The edge is stored as a
 * live reference (source-local fingerprint plus the tracked id when the source carries one),
 * so editing or moving the source re-aims the copies on rebuild; count/spacing/angle/merge
 * ride on the options panel (and the feature row afterwards), skip on the feature row.
 *
 * A linear pattern is one-directional unless the panel's direction-2 checkbox is ticked:
 * ticking it asks for a second line edge and folds that direction into the live preview; with
 * nothing ticked the panel shows no count2/spacing2 pair and the commit carries no second
 * direction at all.
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
    /** Takes the run's translucent tint away again (see `tintTargetBody`). */
    private _untintTarget: (() => void) | undefined;
    /** Set while the drag session's settled value is written back, so the setter does not echo it. */
    protected _syncingFromSession = false;

    /** Fuse every copy into the input (the default) or keep the pattern an unmerged compound. */
    @property("option.command.merge")
    get merge(): boolean {
        return this.getPrivateValue("merge", true);
    }
    set merge(value: boolean) {
        this.setProperty("merge", value);
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

    /** The panel field the drag edits — the spacing of a linear, the angle of a circular. */
    protected abstract get draggedValue(): ParameterValue;
    protected abstract set draggedValue(value: ParameterValue);

    /** The value the session opens with, resolved; 0 when the field's expression does not. */
    protected abstract sessionValue(body: ParametricBodyNode): number;

    protected override getSteps(): IStep[] {
        // Direction 2 is not a step: a linear pattern opens single-directional and the
        // panel's checkbox asks for the second edge only once it is ticked.
        return [
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
                    // The body is selected as a NODE, which lights its whole outline. Swap
                    // that outline for the translucent tint a preview already uses, so the
                    // edge this step asks for is the only bright outline on the canvas.
                    // Only this command does it, and only for the run's own target.
                    beforeSelection: () => this.tintTargetBody(),
                },
            ),
            new PatternSessionStep(this.sessionTip, (document, controller) =>
                this.createSession(document, controller),
            ),
        ];
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

    /** The picked edge of step `stepIndex` as a world line (see `PatternLine`). */
    protected worldLine(stepIndex: number): PatternLine | undefined {
        const data = this.stepDatas[stepIndex]?.shapes?.[0];
        return data === undefined ? undefined : worldLineOf(data);
    }

    /** Pushes a panel value into the live session; an unresolvable expression is not pushed. */
    protected pushSessionValue(value: ParameterValue, unit: UnitSpec): void {
        if (this._syncingFromSession) return;
        const resolved = this.resolveParameter(value, unit);
        if (resolved.isOk) this._session?.setValue(resolved.value);
    }

    /** The number the drag settled lands on the panel field — guarded against the echo. */
    protected syncFromSession(value: number): void {
        this.withoutEcho(() => (this.draggedValue = value));
    }

    /** The count a badge dialog settled lands on the panel field — guarded the same way. */
    protected syncCountFromSession(count: number): void {
        this.withoutEcho(() => (this.count = count));
    }

    /** Runs a panel write that CAME from the live session, so it is not pushed back into it. */
    protected withoutEcho(apply: () => void): void {
        this._syncingFromSession = true;
        try {
            apply();
        } finally {
            this._syncingFromSession = false;
        }
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

    /** The picked edge of step `stepIndex` as a live reference (see `lineSourceOf`). */
    protected lineSource(stepIndex: number): PatternLineSource | undefined {
        const data = this.stepDatas[stepIndex]?.shapes?.[0];
        return data === undefined ? undefined : lineSourceOf(data);
    }

    /**
     * Swaps the target body's node-selected outline for the translucent face tint, for this
     * run only: the edge the next step asks for is then the only bright outline on the
     * canvas. A node selection lights every edge in the same colour a pick uses, so without
     * the swap there is no telling which edge the pattern was aimed at.
     */
    private tintTargetBody(): void {
        const node = this.stepDatas[0]?.nodes?.[0];
        const visual = node === undefined ? undefined : this.document.visual.context.getVisual(node);
        if (visual === undefined) return;
        const highlighter = this.document.visual.highlighter;
        highlighter.removeState(visual, VisualStates.edgeSelected, ShapeTypes.shape);
        highlighter.addState(visual, VisualStates.faceTransparent, ShapeTypes.shape);
        // Held as the undo itself, not as the visual: the teardown must not have to find the
        // document again (the view may be gone by then).
        this._untintTarget = () =>
            highlighter.removeState(visual, VisualStates.faceTransparent, ShapeTypes.shape);
    }

    /**
     * Puts the selection back the way the preview had it. A CANCELLED pick clears everything,
     * node selection included; the body comes back and is re-tinted, because re-selecting it
     * lights the outline this run had swapped for the tint.
     */
    protected restoreSelection(reference: VisualShapeData[], nodes: readonly INode[]): void {
        if (this._session === undefined) return;
        const selection = this.document.selection;
        if (nodes.length > 0 && selection.getSelectedNodes().length === 0) {
            selection.setSelectedNodes([...nodes], false);
            this.tintTargetBody();
        }
        const edges = [...reference];
        for (const picked of selection.getSelectedShapes()) {
            if (!edges.some((edge) => isSameShapeData(edge, picked))) edges.push(picked);
        }
        selection.setSelectedShapes(edges, VisualStates.edgeSelected, false);
    }

    /** Takes the run's tint away — the node selection's own state is cleared with the run. */
    protected override afterExecute(): void {
        this._untintTarget?.();
        this._untintTarget = undefined;
        super.afterExecute();
    }

    protected abstract feature(
        body: ParametricBodyNode,
        source: PatternLineSource,
    ): LinearPatternFeatureData | CircularPatternFeatureData;
}

/** A picked edge as the world line the preview reads — the live geometry, not the stored ref. */
function worldLineOf(data: VisualShapeData): PatternLine | undefined {
    const edge = data.shape as unknown as IEdge;
    const direction = edge.endPoint().sub(edge.startPoint()).normalize();
    if (direction === undefined) return undefined;
    return {
        point: data.transform.ofPoint(edge.startPoint()),
        direction: data.transform.ofVector(direction),
    };
}

/** A picked edge as a live reference, carrying the source's tracked id when it has one. */
function lineSourceOf(data: VisualShapeData): PatternLineSource | undefined {
    const node = data.owner.node;
    if (!(node instanceof ShapeNode) || isReferenceGeometryNode(node)) return undefined;
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

    /**
     * The second-direction switch starts OFF on every run: it is an intent for THIS array,
     * not an option to be remembered. The options cache (`CancelableCommand.saveProperties`)
     * would otherwise restore the last run's state and the preview would open straight into
     * a second-direction pick.
     */
    protected override beforeExecute(): void {
        super.beforeExecute();
        this.direction2Enabled = false;
    }

    protected get draggedValue(): ParameterValue {
        return this.spacing;
    }
    protected set draggedValue(value: ParameterValue) {
        this.spacing = value;
    }

    protected sessionValue(body: ParametricBodyNode): number {
        if (this.spacing === "") {
            const direction = this.worldLine(1)?.direction;
            if (direction !== undefined) this.spacing = this.defaultSpacing(body, direction);
        }
        if (this.spacing === "") return 0;
        const resolved = this.resolveParameter(this.spacing, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    // ------------------------------------------------------------------ Direction 2

    /**
     * The panel's second-direction switch. Off by default, so a plain run is one row of
     * copies; ticking it asks for the second line edge — at once when the preview is up, or
     * as soon as the preview opens when it was ticked during the earlier picks — and the
     * pattern becomes a grid. Unticking it drops the direction again, ghosts and all.
     */
    @property("feature.pattern.direction2")
    get direction2Enabled(): boolean {
        return this.getPrivateValue("direction2Enabled", false);
    }
    set direction2Enabled(value: boolean) {
        this.setProperty("direction2Enabled", value, () => {
            if (value) void this.beginDirection2Pick();
            else this.dropDirection2();
        });
    }

    /**
     * Whether a second direction has actually been picked — the flag the panel's dependencies
     * read to show the count2/spacing2 pair. The switch alone is not enough: until its pick
     * comes back there is no direction for the pair to act on.
     */
    get hasDirection2(): boolean {
        return this.getPrivateValue("hasDirection2", false);
    }
    private set hasDirection2(value: boolean) {
        this.setProperty("hasDirection2", value);
    }

    /** The second direction's picked edge and its live ref, once its pick came back. */
    private _direction2Pick: VisualShapeData | undefined;
    private _direction2Source: PatternLineSource | undefined;
    /** The edges selected when the second-direction pick started — the first direction's reference. */
    private _direction2Reference: VisualShapeData[] = [];
    /** The nested pick's controller, so unticking (or closing the preview) cancels it. */
    private _direction2Controller: AsyncController | undefined;

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
        return new PatternPreviewHandler(document, controller, {
            body,
            line,
            count,
            value: this.sessionValue(body),
            onValue: (value) => this.syncFromSession(value),
            onValue2: (value) => this.withoutEcho(() => (this.spacing2 = value)),
            onReady: (handler) => {
                this._session = handler;
            },
            // Ticked before the preview existed, the switch had nowhere to pick. It may only
            // pick once the session's own pick has installed the handler — starting here, in
            // `createSession`, would have the outer pick install OVER the nested one, which
            // would never see a click and would leave a dead handler behind on teardown.
            onOpened: () => {
                if (this.direction2Enabled) void this.beginDirection2Pick();
            },
            onDone: () => {
                this._session = undefined;
                // A second-direction pick still open when the preview closes goes with it.
                this._direction2Controller?.cancel();
                this._direction2Controller = undefined;
            },
        });
    }

    /**
     * The second-direction pick, nested inside the preview's session. Only a live preview can
     * host it — before the session opens the switch is just remembered. The picker swaps the
     * event handler for the duration and puts the preview's back afterwards, so the ghosts
     * stay up and the confirm bar is untouched (a click finishes this single pick).
     */
    private async beginDirection2Pick(): Promise<void> {
        const body = this.stepDatas[0]?.nodes?.[0];
        if (this._direction2Source !== undefined || this._direction2Controller !== undefined) return;
        if (!(body instanceof ParametricBodyNode) || this.previewSession === undefined) return;

        const controller = new AsyncController();
        this._direction2Controller = controller;
        // The first direction's edge is still selected (its step keeps it) and a pick reports
        // the selection — so the SHAPES go before the nested pick and come back after it. The
        // node's tint is not touched: it is what says which body the preview is patterning.
        const selection = this.document.selection;
        const reference = selection.getSelectedShapes();
        const nodes = selection.getSelectedNodes();
        this._direction2Reference = reference;
        selection.setSelectedShapes([], VisualStates.edgeSelected, false);
        try {
            const shapes = await this.document.picker.pickShape("prompt.select.direction2Edge", controller, {
                shapeType: ShapeTypes.edge,
                shapeFilter: new LineEdgeFilter(),
                nodeFilter: { allow: (node) => node instanceof ShapeNode && !isReferenceGeometryNode(node) },
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
            });
            // Enter/Space with nothing picked is the old step's "skip": no second direction,
            // and the preview stays open for its own Enter. Committing here would land the
            // pattern with values the user has had no chance to adjust.
            if (controller.result?.status !== "success" || shapes[0] === undefined) {
                this.direction2Enabled = false;
                return;
            }
            this.applyDirection2(shapes[0], body);
        } finally {
            if (this._direction2Controller === controller) this._direction2Controller = undefined;
            // The picker hung its own listeners on this controller; they hold the selection
            // handler and the document, so the controller is let go with the pick.
            controller.dispose();
            if (this._session !== undefined) {
                this.restoreSelection(reference, nodes);
                // The nested pick cleared the status tip and the cursor on its way out; the
                // preview's own both come back.
                PubSub.default.pub("statusBarTip", this.sessionTip);
                PubSub.default.pub("viewCursor", PATTERN_SESSION_CURSOR);
            }
        }
    }

    /** Drops the second direction: a pending pick is cancelled and the ghosts fall back to one row. */
    private dropDirection2(): void {
        this._direction2Controller?.cancel();
        this._direction2Controller = undefined;
        const picked = this._direction2Pick;
        const reference = this._direction2Reference;
        this._direction2Pick = undefined;
        this._direction2Source = undefined;
        this._direction2Reference = [];
        // The edge the pick selected is not a reference any more; left in the selection it
        // would be read as one (and restored beside the first direction) by the next pick.
        // The first direction's own edge stays even when the two picks are the same edge.
        if (picked !== undefined) this.deselectShape(picked, reference);
        if (!this.hasDirection2) return;
        this.hasDirection2 = false;
        this.previewSession?.setDirection2(undefined);
    }

    /** Takes one picked sub-shape out of the selection, unless it is also a kept reference. */
    private deselectShape(shape: VisualShapeData, keep: readonly VisualShapeData[]): void {
        const selection = this.document.selection;
        const selected = selection.getSelectedShapes();
        const rest = selected.filter(
            (x) => !isSameShapeData(x, shape) || keep.some((edge) => isSameShapeData(edge, x)),
        );
        if (rest.length === selected.length) return;
        selection.setSelectedShapes(rest, VisualStates.edgeSelected, false);
    }

    /** Folds a picked second edge into the panel and the live preview. */
    private applyDirection2(pick: VisualShapeData, body: ParametricBodyNode): void {
        const source = lineSourceOf(pick);
        const line = worldLineOf(pick);
        if (source === undefined || line === undefined) {
            this.direction2Enabled = false;
            return;
        }
        this._direction2Pick = pick;
        this._direction2Source = source;
        this.hasDirection2 = true;
        const value = this.direction2Value(body);
        this.previewSession?.setDirection2(line, this.resolvedCount2(), value);
        // The auto spacing is converged onto the panel only after the session already holds
        // it: writing it first would push into a preview with no second direction yet and
        // ghost the single row once for nothing. The matching push is a no-op.
        if (this.spacing2 === "") this.spacing2 = value;
    }

    /**
     * Direction 2's count, resolved — the field's default stands in for an expression that
     * does not resolve; the commit's validation reports it.
     */
    private resolvedCount2(): number {
        const count2 = this.resolveParameter(this.count2, UNITLESS);
        return count2.isOk ? count2.value : 2;
    }

    /**
     * The panel's spacing2 push — an unresolvable expression, or the drag's own echo, never
     * reaches the preview.
     */
    private pushSessionValue2(): void {
        if (this._syncingFromSession) return;
        const resolved = this.resolveParameter(this.spacing2, LENGTH_UNITS);
        if (resolved.isOk) this.previewSession?.setValue2(resolved.value);
    }

    /** Direction 2's opening spacing — its own extent rule off its own picked edge. */
    private direction2Value(body: ParametricBodyNode): number {
        if (this.spacing2 === "") {
            const direction =
                this._direction2Pick === undefined ? undefined : worldLineOf(this._direction2Pick)?.direction;
            return direction === undefined ? 0 : this.defaultSpacing(body, direction);
        }
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
        if (this._direction2Source === undefined) return true;

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
        const line1 = this.worldLine(1);
        const line2 = this._direction2Pick === undefined ? undefined : worldLineOf(this._direction2Pick);
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
        const source2 = this._direction2Source;
        return {
            id: Id.generate(),
            type: "pattern",
            mode: "linear",
            direction: source,
            count: this.count,
            spacing:
                this.spacing === "" ? this.defaultSpacing(body, this.worldLine(1)?.direction) : this.spacing,
            // The contract: direction2 set means count2 and spacing2 come along — the trio
            // appears together or not at all.
            ...(source2 !== undefined
                ? {
                      direction2: source2,
                      count2: this.count2,
                      spacing2:
                          this.spacing2 === ""
                              ? this.defaultSpacing(
                                    body,
                                    this._direction2Pick === undefined
                                        ? undefined
                                        : worldLineOf(this._direction2Pick)?.direction,
                                )
                              : this.spacing2,
                  }
                : {}),
            ...(this.merge ? {} : { merge: false }),
        };
    }

    /**
     * The spacing a pattern opens with: the body's extent along the picked direction plus a
     * fifth, so the first copy lands clear of the original; 50mm when the extent degenerates.
     *
     * The direction arrives in WORLD space (the pick carries its own node's transform) and
     * is carried into the body's own frame before the extent is measured: an edge picked on
     * ANOTHER, rotated node would otherwise be projected onto the wrong local axis, or
     * degenerate to the fallback.
     */
    private defaultSpacing(body: ParametricBodyNode, worldDirection: XYZ | undefined): number {
        const direction =
            worldDirection && body.worldTransform().invert()?.ofVector(worldDirection).normalize();
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
