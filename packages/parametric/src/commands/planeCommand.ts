// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    AsyncController,
    Combobox,
    CurveUtils,
    command,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    type IShapeFilter,
    type IStep,
    type IVertex,
    isReferenceGeometryNode,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    type PickShapeOptions,
    type Plane,
    PubSub,
    property,
    Result,
    ShapeNode,
    ShapeTypes,
    type SnapResult,
    Transaction,
    type VisualShapeData,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { captureEdgeRef, type EdgeRef, edgeMidPoint } from "../features/edgeRef";
import { type NeutralPlaneRef, planeRefNodeId } from "../features/feature";
import { plainVec } from "../features/refGeometry";
import { captureVertexRef } from "../features/vertexRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    captureVertexAnchors,
    type EdgeSourceRef,
    type PlaneDefinition,
    type PointRef,
    resolvePlaneDefinition,
    type VertexAnchor,
} from "../plane/planeDefinition";
import { ensurePlaneMaterial, PlaneNode } from "../plane/planeNode";
import {
    captureNeutralPlane,
    type PickedNeutralPlane,
    PlanePickHandler,
} from "../sketch/commands/planePickHandler";
import { datumQuadAt } from "../sketch/commands/planePreview";
import { worldShape } from "./booleanPreview";
import { type DragPreview, PreviewConfirmHandler } from "./previewConfirmHandler";
import { LineEdgeFilter, LineOrCircleEdgeFilter } from "./shapeFilters";

const PLANE_TYPES = [
    "feature.plane.offset",
    "feature.plane.planePoint",
    "feature.plane.lineAngle",
    "feature.plane.pointNormal",
    "feature.plane.threePoint",
    "feature.plane.midPlane",
    "feature.plane.curvePoint",
] as const satisfies readonly I18nKeys[];

type PlaneTypeKey = (typeof PLANE_TYPES)[number];

const PLANE_TYPE_KINDS: Record<PlaneTypeKey, PlaneDefinition["kind"]> = {
    "feature.plane.offset": "offset",
    "feature.plane.planePoint": "planePoint",
    "feature.plane.lineAngle": "lineAngle",
    "feature.plane.pointNormal": "pointNormal",
    "feature.plane.threePoint": "threePoint",
    "feature.plane.midPlane": "midPlane",
    "feature.plane.curvePoint": "curvePoint",
};

const PREVIEW_QUAD_SIZE = 200;

/** Everything the step collected; `buildDefinition` turns it into the stored definition. */
interface CollectedPlaneRefs {
    source?: NeutralPlaneRef;
    reference?: NeutralPlaneRef;
    second?: NeutralPlaneRef;
    point?: PointRef;
    points?: [PointRef, PointRef, PointRef];
    edge?: EdgeSourceRef;
    curve?: EdgeSourceRef;
    anchors: Record<string, number>;
    /** A world point of the resulting plane near the source geometry, for the display square. */
    anchor?: XYZLike;
}

/**
 * Creates a datum plane (Onshape's Plane): pick the construction geometry, adjust its
 * parameters in the floating panel while a translucent quad shows the result, then confirm.
 *
 * The plane is a standalone node rather than a body feature — see `PlaneNode`. Each type
 * has its own pick sequence; changing the type mid-run restarts the command so the new
 * sequence starts cleanly.
 */
@command({ key: "feature.plane", icon: "icon-setWorkingPlane" })
export class PlaneCommand extends MultistepCommand {
    @property("feature.plane.type", { combobox: Combobox.from([...PLANE_TYPES]) })
    get planeType(): I18nKeys {
        return this.getPrivateValue("planeType", PLANE_TYPES[0]);
    }
    set planeType(value: I18nKeys) {
        if (!this.setProperty("planeType", value)) return;
        // The pick sequence is type-specific; restart rather than continue with stale picks.
        // Only while a step owns a controller: restoring a cached value in `beforeExecute`
        // happens before the run starts, and restarting there would commit twice.
        if (this.controller !== undefined) void this.restart();
    }

    @property("option.command.distance", {
        unit: LENGTH_UNITS,
        dependencies: [{ property: "planeType", value: "feature.plane.offset" }],
    })
    get distance(): ParameterValue {
        return this.getPrivateValue("distance", 10);
    }
    set distance(value: ParameterValue) {
        this.setProperty("distance", value, () => this._preview?.refresh());
    }

    @property("option.command.oppositeDirection", {
        dependencies: [{ property: "planeType", value: "feature.plane.offset" }],
    })
    get reverse(): boolean {
        return this.getPrivateValue("reverse", false);
    }
    set reverse(value: boolean) {
        this.setProperty("reverse", value, () => this._preview?.refresh());
    }

    @property("common.angle", {
        unit: ANGLE_UNITS,
        dependencies: [{ property: "planeType", value: "feature.plane.lineAngle" }],
    })
    get angle(): ParameterValue {
        return this.getPrivateValue("angle", 30);
    }
    set angle(value: ParameterValue) {
        this.setProperty("angle", value, () => this._preview?.refresh());
    }

    @property("option.command.flip")
    get flip(): boolean {
        return this.getPrivateValue("flip", false);
    }
    set flip(value: boolean) {
        this.setProperty("flip", value, () => this._preview?.refresh());
    }

    private _refs: CollectedPlaneRefs | undefined;
    private _preview: PlanePreviewHandler | undefined;
    private _result: PlaneDefinition | undefined;
    /** The captured curve tangent is fixed for one pick; previews must not re-query the kernel. */
    private _tangentMemo: { curve: EdgeSourceRef; point: PointRef; value?: XYZLike } | undefined;
    /** The last preview error announced, so a failing preview toasts once, not per refresh. */
    private _lastPreviewError: string | undefined;

    /** The definition kind the picked refs must satisfy right now. */
    get kind(): PlaneDefinition["kind"] {
        return PLANE_TYPE_KINDS[this.planeType as PlaneTypeKey] ?? "offset";
    }

    protected override getSteps(): IStep[] {
        return [new PickPlaneGeometryStep(this)];
    }

    protected override onRestarting(): void {
        super.onRestarting();
        this._refs = undefined;
        this._result = undefined;
        this._tangentMemo = undefined;
    }

    /** Called by the step once every reference is in hand. */
    setRefs(refs: CollectedPlaneRefs): void {
        this._refs = refs;
        this._tangentMemo = undefined;
        this._lastPreviewError = undefined;
    }

    setPreview(preview: PlanePreviewHandler | undefined): void {
        this._preview = preview;
    }

    /** The definition from the current panel values and collected refs, or an error message. */
    buildDefinition(): Result<PlaneDefinition> {
        const refs = this._refs;
        if (refs === undefined) return Result.err("Pick the plane geometry first");
        const anchors = refs.anchors;
        switch (this.kind) {
            case "offset": {
                if (refs.source === undefined) return Result.err("Pick a plane");
                const rawDistance = this.distance;
                if (rawDistance === undefined) return Result.err("Plane distance is not set");
                const distance = this.resolveParameter(rawDistance, LENGTH_UNITS);
                if (!distance.isOk) return Result.err(distance.error);
                return Result.ok({
                    kind: "offset",
                    source: refs.source,
                    distance: distance.value,
                    reverse: this.reverse,
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "planePoint": {
                if (refs.source === undefined || refs.point === undefined) {
                    return Result.err("Pick a plane and a point");
                }
                return Result.ok({
                    kind: "planePoint",
                    source: refs.source,
                    point: refs.point,
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "lineAngle": {
                if (refs.edge === undefined || refs.reference === undefined) {
                    return Result.err("Pick a line and a reference plane");
                }
                const rawAngle = this.angle;
                if (rawAngle === undefined) return Result.err("Plane angle is not set");
                const angle = this.resolveParameter(rawAngle, ANGLE_UNITS);
                if (!angle.isOk) return Result.err(angle.error);
                return Result.ok({
                    kind: "lineAngle",
                    line: refs.edge,
                    reference: refs.reference,
                    angle: angle.value,
                    direction: lineDirection(refs.edge.edge),
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "pointNormal": {
                if (refs.edge === undefined || refs.point === undefined) {
                    return Result.err("Pick an axis and a point");
                }
                return Result.ok({
                    kind: "pointNormal",
                    axis: refs.edge,
                    point: refs.point,
                    direction: axisDirection(refs.edge.edge),
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "threePoint": {
                if (refs.points === undefined) return Result.err("Pick three points");
                return Result.ok({
                    kind: "threePoint",
                    points: refs.points,
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "midPlane": {
                if (refs.source === undefined || refs.second === undefined) {
                    return Result.err("Pick two planes");
                }
                return Result.ok({
                    kind: "midPlane",
                    first: refs.source,
                    second: refs.second,
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
            case "curvePoint": {
                if (refs.curve === undefined || refs.point === undefined) {
                    return Result.err("Pick a curve and a point");
                }
                return Result.ok({
                    kind: "curvePoint",
                    curve: refs.curve,
                    point: refs.point,
                    tangent: this.capturedCurveTangent(refs.curve, refs.point, anchors),
                    flip: this.flip,
                    anchor: refs.anchor,
                    anchors,
                });
            }
        }
    }

    previewPlane() {
        const definition = this.buildDefinition();
        if (!definition.isOk) return this.reportPreviewError(definition.error);
        const plane = resolvePlaneDefinition(definition.value, this.document);
        if (!plane.isOk) return this.reportPreviewError(plane.error);
        this._lastPreviewError = undefined;
        return plane.value;
    }

    /** A preview that cannot resolve must say why; otherwise the OK button silently dies. */
    private reportPreviewError(error: string): undefined {
        if (this._lastPreviewError !== error) {
            this._lastPreviewError = error;
            PubSub.default.pub("showToast", "error.default:{0}", error);
        }
        return undefined;
    }

    /** The preview square's frame and where it is drawn (the anchor, like the committed node). */
    previewFrame(): { plane: Plane; center: XYZ } | undefined {
        const plane = this.previewPlane();
        if (plane === undefined) return undefined;
        const anchor = this._refs?.anchor;
        return {
            plane,
            center: anchor === undefined ? plane.origin : plane.project(new XYZ(anchor)),
        };
    }

    /** The tangent at creation time, for sign-stable rebuilds of a `curvePoint` plane. */
    private capturedCurveTangent(
        curve: EdgeSourceRef,
        point: PointRef,
        anchors: Record<string, number>,
    ): XYZLike | undefined {
        const memo = this._tangentMemo;
        if (memo?.curve === curve && memo.point === point) return memo.value;
        const plane = resolvePlaneDefinition({ kind: "curvePoint", curve, point, anchors }, this.document);
        const value = plane.isOk
            ? { x: plane.value.normal.x, y: plane.value.normal.y, z: plane.value.normal.z }
            : undefined;
        this._tangentMemo = { curve, point, value };
        return value;
    }

    protected override executeMainTask(): void {
        const definition = this.buildDefinition();
        if (!definition.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", definition.error);
            return;
        }
        const plane = resolvePlaneDefinition(definition.value, this.document);
        if (!plane.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", plane.error);
            return;
        }
        this._result = definition.value;
        Transaction.execute(this.document, "create plane", () => {
            const material = ensurePlaneMaterial(this.document);
            const node = new PlaneNode({
                document: this.document,
                definition: definition.value,
                plane: plane.value,
                materialId: material.id,
            });
            this.document.modelManager.addNode(node);
            this.document.selection.setSelectedNodes([node], false);
        });
    }

    /** The definition the command committed, for tests. */
    get result(): PlaneDefinition | undefined {
        return this._result;
    }
}

/** Collects the refs the current type needs, then shows the preview/confirm phase. */
class PickPlaneGeometryStep implements IStep {
    constructor(private readonly command: PlaneCommand) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        // Every pick gets its OWN controller: the selection handler settles the controller
        // it was given, so reusing the step's would make every later pick return instantly
        // (and the preview unreachable). The step controller is settled only on confirm.
        const refs = await collectRefs(this.command.kind, document, controller);
        if (refs === undefined) return undefined;
        // A restart/panel cancel may have landed between the last pick and here.
        if (controller.result !== undefined) return undefined;
        this.command.setRefs(refs);

        const previewController = new AsyncController();
        // Bridge the command's cancel/restart to the pick round (there is no `off()`; the
        // round is settled right after, so a late replay is harmless).
        controller.onCancelled(() => previewController.cancel());
        const preview = new PlanePreviewHandler(document, previewController, () =>
            this.command.previewFrame(),
        );
        this.command.setPreview(preview);
        try {
            // `pickAsync` installs the preview as the view event handler, which is what
            // gives it Enter/Space/Escape; its own `start()` already published the bar.
            await document.picker.pickAsync(
                preview,
                "prompt.confirmPlane",
                previewController,
                "none",
                "select.default",
            );
            if (previewController.result?.status !== "success") return undefined;
            const plane = this.command.previewPlane();
            if (plane === undefined) return undefined;
            controller.success();
            return {
                view: document.application.activeView!,
                shapes: [],
                type: "input",
                plane,
            };
        } finally {
            this.command.setPreview(undefined);
            preview.dispose();
            previewController.dispose();
        }
    }
}

/** The translucent result quad, refreshed as the panel's distance/angle/flip change. */
class PlanePreviewHandler extends PreviewConfirmHandler {
    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly frame: () => { plane: Plane; center: XYZ } | undefined,
    ) {
        super(document, controller);
        this.start();
    }

    protected override buildPreview(): DragPreview {
        const frame = this.frame();
        return frame === undefined
            ? { meshes: [] }
            : { meshes: [datumQuadAt(frame.plane, frame.center, PREVIEW_QUAD_SIZE)] };
    }

    protected override canConfirm(): boolean {
        return this.frame() !== undefined;
    }

    protected override previewOpacity(): number {
        return 0.35;
    }

    protected override previewOnTop(): boolean {
        return true;
    }
}

async function collectRefs(
    kind: PlaneDefinition["kind"],
    document: IDocument,
    stepController: AsyncController,
): Promise<CollectedPlaneRefs | undefined> {
    const anchors: Record<string, number> = {};
    const refs: CollectedPlaneRefs = { anchors };
    switch (kind) {
        case "offset": {
            const source = await pickNeutralPlane(document, stepController);
            if (source === undefined) return undefined;
            refs.source = source.ref;
            refs.anchor = source.anchor;
            recordPlaneAnchor(document, source.ref, anchors);
            return refs;
        }
        case "planePoint": {
            const source = await pickNeutralPlane(document, stepController);
            if (source === undefined) return undefined;
            refs.source = source.ref;
            recordPlaneAnchor(document, source.ref, anchors);
            const point = await pickPoint(document, stepController);
            if (point === undefined) return undefined;
            refs.point = point.ref;
            refs.anchor = point.world;
            Object.assign(anchors, point.anchors);
            return refs;
        }
        case "lineAngle": {
            const line = await pickEdge(
                document,
                stepController,
                "prompt.select.lineEdge",
                new LineEdgeFilter(),
            );
            if (line === undefined) return undefined;
            refs.edge = line.ref;
            refs.anchor = line.anchor;
            Object.assign(anchors, line.anchors);
            const reference = await pickNeutralPlane(document, stepController);
            if (reference === undefined) return undefined;
            refs.reference = reference.ref;
            recordPlaneAnchor(document, reference.ref, anchors);
            return refs;
        }
        case "pointNormal": {
            const axis = await pickEdge(
                document,
                stepController,
                "prompt.select.axis",
                new LineOrCircleEdgeFilter(),
            );
            if (axis === undefined) return undefined;
            refs.edge = axis.ref;
            Object.assign(anchors, axis.anchors);
            const point = await pickPoint(document, stepController);
            if (point === undefined) return undefined;
            refs.point = point.ref;
            refs.anchor = point.world;
            Object.assign(anchors, point.anchors);
            return refs;
        }
        case "threePoint": {
            const picked = await pickPoints(document, 3, stepController);
            if (picked === undefined) return undefined;
            refs.points = [picked.points[0], picked.points[1], picked.points[2]];
            refs.anchor = centroid(picked.worlds);
            Object.assign(anchors, picked.anchors);
            return refs;
        }
        case "midPlane": {
            const first = await pickNeutralPlane(document, stepController);
            if (first === undefined) return undefined;
            refs.source = first.ref;
            recordPlaneAnchor(document, first.ref, anchors);
            const firstAnchor = first.anchor;
            const second = await pickNeutralPlane(document, stepController);
            if (second === undefined) return undefined;
            refs.second = second.ref;
            refs.anchor = midpoint(firstAnchor, second.anchor);
            recordPlaneAnchor(document, second.ref, anchors);
            return refs;
        }
        case "curvePoint": {
            const curve = await pickEdge(document, stepController, "prompt.select.curve");
            if (curve === undefined) return undefined;
            refs.curve = curve.ref;
            refs.anchor = curve.anchor;
            Object.assign(anchors, curve.anchors);
            const point = await pickPoint(document, stepController);
            if (point === undefined) return undefined;
            refs.point = point.ref;
            refs.anchor = point.world;
            Object.assign(anchors, point.anchors);
            return refs;
        }
    }
}

async function pickNeutralPlane(
    document: IDocument,
    stepController: AsyncController,
): Promise<PickedNeutralPlane | undefined> {
    const controller = new AsyncController();
    stepController.onCancelled(() => controller.cancel());
    document.selection.clearSelection();
    const handler = new PlanePickHandler(document, controller);
    try {
        await document.picker.pickAsync(handler, "prompt.select.plane", controller, "none", "select.default");
        return handler.result === undefined ? undefined : captureNeutralPlane(document, handler.result);
    } finally {
        handler.dispose();
        document.selection.clearSelection();
        controller.dispose();
    }
}

interface PickedPoint {
    readonly ref: PointRef;
    readonly anchors: Record<string, number>;
    /** The clicked point in world coordinates (the ref itself is node-local). */
    readonly world: XYZ;
}

async function pickPoint(
    document: IDocument,
    stepController: AsyncController,
): Promise<PickedPoint | undefined> {
    const picked = await pickShapes(document, stepController, "prompt.select.vertexes", {
        shapeType: ShapeTypes.vertex,
        nodeFilter: { allow: (node) => !isReferenceGeometryNode(node) },
    });
    const vertex = picked?.find((candidate) => candidate.shape.shapeType === ShapeTypes.vertex);
    if (vertex === undefined) return undefined;
    const anchors: Record<string, number> = {};
    const captured = capturePoints([vertex], anchors);
    const ref = captured.refs[0];
    return ref === undefined ? undefined : { ref, anchors, world: captured.worlds[0] };
}

interface PickedPoints {
    readonly points: PointRef[];
    readonly anchors: Record<string, number>;
    readonly worlds: XYZ[];
}

async function pickPoints(
    document: IDocument,
    count: number,
    stepController: AsyncController,
): Promise<PickedPoints | undefined> {
    const picked = await pickShapes(document, stepController, "prompt.select.vertexes", {
        shapeType: ShapeTypes.vertex,
        nodeFilter: { allow: (node) => !isReferenceGeometryNode(node) },
        multi: true,
        canFinish: (selected) => selected.length >= count,
    });
    const vertices = picked?.filter((candidate) => candidate.shape.shapeType === ShapeTypes.vertex) ?? [];
    if (vertices.length < count) return undefined;
    const anchors: Record<string, number> = {};
    const captured = capturePoints(vertices.slice(0, count), anchors);
    return captured.refs.length === count
        ? { points: captured.refs, anchors, worlds: captured.worlds }
        : undefined;
}

/**
 * One pick with its OWN controller: a selection handler settles the controller it was
 * given, so reusing a controller across picks makes every later pick return instantly.
 * The selection is cleared first (a stale selection would otherwise be captured) and the
 * success status is checked so Escape is not mistaken for an answer.
 */
async function pickShapes(
    document: IDocument,
    stepController: AsyncController,
    prompt: I18nKeys,
    options: Omit<PickShapeOptions, "nodeFilter"> & {
        nodeFilter?: PickShapeOptions["nodeFilter"];
    },
): Promise<VisualShapeData[] | undefined> {
    const controller = new AsyncController();
    stepController.onCancelled(() => controller.cancel());
    document.selection.clearSelection();
    try {
        const picked = await document.picker.pickShape(prompt, controller, options);
        return controller.result?.status === "success" ? picked : undefined;
    } finally {
        document.selection.clearSelection();
        controller.dispose();
    }
}

/**
 * Vertex refs in the source node's LOCAL frame (moving the source's transform must not
 * break them), plus the same points in world coordinates for the display anchor.
 */
function capturePoints(
    shapes: VisualShapeData[],
    anchors: Record<string, number>,
): { refs: PointRef[]; worlds: XYZ[] } {
    const refs: PointRef[] = [];
    const worlds: XYZ[] = [];
    for (const picked of shapes) {
        const node = picked.owner.node;
        recordAnchor(node, anchors);
        const vertex = picked.shape as IVertex;
        const incident = captureVertexIncidence(node, vertex);
        refs.push({
            nodeId: node.id,
            vertex: captureVertexRef(vertex),
            ...(incident === undefined ? {} : { incident }),
        });
        worlds.push(picked.transform.ofPoint(vertex.point()));
    }
    return { refs, worlds };
}

interface PickedEdge {
    readonly ref: EdgeSourceRef;
    readonly anchors: Record<string, number>;
    /** The edge's source-geometry point in WORLD coordinates, for the display anchor. */
    readonly anchor: XYZLike;
}

async function pickEdge(
    document: IDocument,
    stepController: AsyncController,
    prompt: I18nKeys,
    filter?: IShapeFilter,
): Promise<PickedEdge | undefined> {
    const picked = await pickShapes(document, stepController, prompt, {
        shapeType: ShapeTypes.edge,
        shapeFilter: filter,
        nodeFilter: { allow: (node) => !isReferenceGeometryNode(node) },
    });
    const data = picked?.find((candidate) => candidate.shape.shapeType === ShapeTypes.edge);
    if (data === undefined) return undefined;
    const node = data.owner.node;
    const anchors: Record<string, number> = {};
    recordAnchor(node, anchors);
    const owned: IShape[] = [];
    try {
        const localEdge = data.shape as IEdge;
        const worldEdge = worldShape(localEdge, data.transform, owned);
        const edgeId = node instanceof ParametricBodyNode ? node.edgeIdAt(data.indexes[0]) : undefined;
        const splitPiece =
            node instanceof ParametricBodyNode && edgeId !== undefined ? node.edgeIdIsShared(edgeId) : false;
        return {
            // Captured in the source's LOCAL frame: a moved source still re-matches, and
            // only the resolved geometry is carried into world coordinates.
            ref: { nodeId: node.id, edge: captureEdgeRef(localEdge, edgeId, splitPiece) },
            anchors,
            anchor: worldEdgeAnchor(worldEdge),
        };
    } finally {
        disposeAll(owned);
    }
}

function recordPlaneAnchor(document: IDocument, ref: NeutralPlaneRef, anchors: Record<string, number>): void {
    const nodeId = planeRefNodeId(ref);
    if (nodeId === undefined) return;
    const node = document.modelManager.findNode((candidate) => candidate.id === nodeId);
    if (node !== undefined) recordAnchor(node, anchors);
}

function recordAnchor(node: INode, anchors: Record<string, number>): void {
    if (!(node instanceof ParametricBodyNode)) return;
    anchors[node.id] = node.evaluationStopIndex();
}

function disposeAll(shapes: IShape[]): void {
    for (const shape of shapes) shape.dispose();
}

/** The picked vertex's incident edges, captured as topology (see `captureVertexAnchors`). */
function captureVertexIncidence(node: INode, vertex: IVertex): VertexAnchor[] | undefined {
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return undefined;
    const edgeIdAt = node instanceof ParametricBodyNode ? (index: number) => node.edgeIdAt(index) : undefined;
    return captureVertexAnchors(node.shape.value, vertex, edgeIdAt);
}

/** A world point of the edge's plane, used as the display anchor. */
function worldEdgeAnchor(edge: IEdge): XYZLike {
    const basis = edge.curve.basisCurve;
    if (CurveUtils.isCircle(basis)) return plainVec(basis.center);
    if (CurveUtils.isLine(basis)) return plainVec(edge.startPoint());
    return plainVec(edgeMidPoint(edge));
}

function centroid(points: readonly XYZLike[]): XYZLike {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
        z += point.z;
    }
    return { x: x / points.length, y: y / points.length, z: z / points.length };
}

function midpoint(first: XYZLike, second: XYZLike): XYZLike {
    return {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        z: (first.z + second.z) / 2,
    };
}

function lineDirection(edge: EdgeRef): XYZLike | undefined {
    if (edge.kind !== "line") return undefined;
    const direction = new XYZ(edge.end).sub(new XYZ(edge.start)).normalize();
    return direction === undefined ? undefined : { x: direction.x, y: direction.y, z: direction.z };
}

/** The axis a `pointNormal` plane captured: a straight edge's direction or a circle's axis. */
function axisDirection(edge: EdgeRef): XYZLike | undefined {
    if (edge.kind === "circle") return edge.axis;
    return lineDirection(edge);
}
