// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    BoundingBox,
    type I18nKeys,
    type IDocument,
    type INode,
    type IShape,
    isPropertyChanged,
    LENGTH_UNITS,
    Logger,
    Material,
    type Matrix4,
    type NodeRecord,
    ParameterShapeNode,
    type ParameterShapeNodeOptions,
    Plane,
    Precision,
    property,
    Result,
    serializable,
    serialize,
    XYZ,
} from "@chili3d/core";
import { planeRefNodeId } from "../features/feature";
import { syncNodeWatches } from "../nodeWatch";
import type { PlaneDefinition } from "./planeDefinition";
import { resolvePlaneDefinition } from "./planeDefinition";
import type { IPlaneNode } from "./planeNodeContract";

/** The size a datum plane's display rectangle falls back to when no sketch is bound to it. */
const DEFAULT_DISPLAY_SIZE = 500;
/**
 * Breathing room around a bound sketch's projected bounds, as a fraction of EACH side.
 * A deliberately generous margin: the square reads as a reference surface around the
 * sketch rather than a tight bounding box.
 */
const DISPLAY_MARGIN_RATIO = 0.25;
const MIN_DISPLAY_MARGIN = 1;
/** A too-small rectangle is hard to see and to pick. */
const MIN_DISPLAY_SIZE = 100;
/** The shared semi-transparent surface every datum plane is drawn with. */
const PLANE_MATERIAL_NAME = "Datum Plane";

export interface PlaneNodeOptions extends ParameterShapeNodeOptions {
    definition?: PlaneDefinition;
    /** Serialized form produced by the Serializer; takes precedence over `definition`. */
    definitionJson?: string;
    /** The last resolved plane, persisted as the fallback when a source is lost. */
    plane?: Plane;
}

/**
 * A user-created datum plane, the Onshape-style reference geometry a sketch or feature can
 * be placed on.
 *
 * It is a NODE rather than a body feature on purpose: `ParametricBodyNode.evaluateChain`
 * requires every feature to produce the chain's next shape, and a datum plane produces no
 * solid. `SketchNode` is the same kind of standalone reference node.
 *
 * The node owns a rectangular face so it has a visual and can be picked; that rectangle is
 * derived, not parametric geometry. `definitionJson` is the authoritative definition and
 * `plane` is the last result in WORLD coordinates, kept so a document still shows the
 * plane after a referenced face/edge/vertex is lost. The display rectangle follows the sketches
 * bound to this plane (see `addDisplayDependent`).
 */
@serializable()
export class PlaneNode extends ParameterShapeNode implements IPlaneNode {
    override display(): I18nKeys {
        return "body.plane";
    }

    override get icon(): string {
        return "icon-setWorkingPlane";
    }

    /** Reference geometry must never be offered as a solid face by generic shape pickers. */
    override get isReferenceGeometry(): boolean {
        return true;
    }

    /** A datum plane is world-space reference geometry, never a placed body. */
    override get copiesAsInstance(): boolean {
        return false;
    }

    @serialize()
    get definitionJson(): string {
        return this.getPrivateValue("definitionJson");
    }
    set definitionJson(value: string) {
        this.setPropertyEmitShapeChanged("definitionJson", value);
    }

    get definition(): PlaneDefinition {
        try {
            const parsed: unknown = JSON.parse(this.definitionJson);
            if (parsed === null || typeof parsed !== "object") {
                throw new Error("definition is not an object");
            }
            return parsed as PlaneDefinition;
        } catch (error) {
            // A hand-edited/corrupt document must not tear down every rebuild that touches
            // this node; fall back to a harmless plane and say so.
            Logger.warn(`PlaneNode: definition is not valid JSON: ${String(error)}`);
            return defaultDefinition();
        }
    }

    /**
     * The last successfully resolved plane, in WORLD coordinates — construction geometry
     * is world-authoritative; a node transform only places the drawing. Persisted as a
     * fallback: a definition whose source was deleted keeps showing (and being referenced
     * at) its last known plane instead of vanishing.
     */
    @serialize()
    get plane(): Plane | undefined {
        return this.getPrivateValue("plane", undefined);
    }
    set plane(value: Plane | undefined) {
        this.setProperty("plane", value);
    }

    /** Offset distance, only for `offset` definitions; `undefined` hides the row otherwise. */
    @property("option.command.distance", { unit: LENGTH_UNITS })
    get distance(): number | undefined {
        const definition = this.definition;
        return definition.kind === "offset" ? definition.distance : undefined;
    }
    set distance(value: number) {
        this.updateDefinition((definition) =>
            definition.kind === "offset" ? { ...definition, distance: value } : definition,
        );
    }

    /** Rotation angle in degrees, only for `lineAngle` definitions; the row hides otherwise. */
    @property("common.angle", { unit: ANGLE_UNITS })
    get angle(): number | undefined {
        const definition = this.definition;
        return definition.kind === "lineAngle" ? definition.angle : undefined;
    }
    set angle(value: number) {
        this.updateDefinition((definition) =>
            definition.kind === "lineAngle" ? { ...definition, angle: value } : definition,
        );
    }

    @property("option.command.flip")
    get flip(): boolean {
        return this.definition.flip === true;
    }
    set flip(value: boolean) {
        this.updateDefinition((definition) => ({ ...definition, flip: value }));
    }

    @property("option.command.oppositeDirection")
    get reverse(): boolean | undefined {
        const definition = this.definition;
        return definition.kind === "offset" ? definition.reverse === true : undefined;
    }
    set reverse(value: boolean) {
        this.updateDefinition((definition) =>
            definition.kind === "offset" ? { ...definition, reverse: value } : definition,
        );
    }

    /** Guards against a watcher-driven rebuild re-entering its own resolution. */
    private _resolving = false;
    /** Plane nodes already on the resolution stack when `worldPlane` had to trigger a build. */
    private _pendingVisited: ReadonlySet<string> | undefined;
    /**
     * True while `worldPlane` is triggering the first build. The display fit reads bound
     * sketches' shapes, and the sketch that is asking for the plane is mid-generation —
     * reading it here would re-enter that sketch. The default square is used instead;
     * the sketch's own shape emission then triggers the fit.
     */
    private _skipDisplayFit = false;
    /** One deferred display-fit per skipped first build; see `displayExtent`. */
    private _displayFitQueued = false;
    /** The display frame/size last built, so a dependent change that fits the same skips `setShape`. */
    private _lastExtent: DisplayExtent | undefined;
    /** 1 while the definition cannot resolve (a lost point/edge/face), shown as a tree badge. */
    private _warningCount = 0;
    /** Source nodes of the definition (`shape`/`transform`/`plane` changes trigger a rebuild). */
    private readonly _sourceNodes = new Map<string, INode>();
    /** Sketches drawn on this plane; their bounds drive the display rectangle's size. */
    private readonly _displayDependents = new Map<string, INode>();
    /** Parent/ancestor nodes whose transform moves this node's visual. */
    private readonly _ancestorNodes = new Map<string, INode>();

    constructor(options: PlaneNodeOptions) {
        super(options);
        this.setPrivateValue(
            "definitionJson",
            options.definitionJson ?? JSON.stringify(options.definition ?? defaultDefinition()),
        );
        this.setPrivateValue("plane", options.plane);
        // A document saved before the overlay depth flags existed carries an old
        // "Datum Plane" material; normalize it as soon as a plane node loads.
        const referenced =
            options.materialId === undefined
                ? undefined
                : options.document.modelManager.materials.find(
                      (material) => material.id === options.materialId,
                  );
        if (options.materialId === undefined) {
            // `GeometryNode` already fell back to the document's first material. A node
            // created programmatically (tests, plugins, AI) must get the overlay surface
            // too, or the depth-bias settings never apply. `setPrivateValue`, not the
            // property setter: a constructor write must not enter the undo history.
            this.setPrivateValue("materialId", ensurePlaneMaterial(options.document).id);
        } else if (referenced?.name === PLANE_MATERIAL_NAME) {
            // An older document's shared material may predate the overlay flags.
            ensurePlaneMaterial(options.document);
        }
        // A sketch removed from the document is not disposed until the history drops its
        // record, so its `disposeInternal` would leave its bounds in the display fit.
        options.document.modelManager.addNodeObserver(this.handleNodeRecords);
        // The display rectangle is built in the local frame; a later placement change must
        // re-map it so the drawing stays on the world plane its references use.
        this.onPropertyChanged(this.handleSelfChanged);
    }

    /**
     * The plane in world coordinates, resolving it lazily when it has never been built.
     * `visited` is the resolution stack: a cycle between plane nodes returns undefined
     * rather than recursing forever.
     */
    worldPlane(visited?: ReadonlySet<string>): Plane | undefined {
        if (visited?.has(this.id) === true) return undefined;
        // Resolve at least once even when a saved fallback exists: the definition may have
        // changed since the document was saved, and a reference should see the fresh plane.
        if (!this._shape.isOk && !this._resolving) {
            const next = new Set(visited ?? []);
            next.add(this.id);
            this._pendingVisited = next;
            this._skipDisplayFit = true;
            try {
                // Reading `shape` is what runs `generateShape` on a not-yet-resolved node.
                void this.shape;
            } finally {
                this._skipDisplayFit = false;
                this._pendingVisited = undefined;
            }
        }
        // Construction geometry is world-authoritative: a node/parent transform is a visual
        // placement, not a redefinition of the plane. The display rectangle is built in the
        // local frame, so it stays on this same world plane under any transform too.
        // (Transform commands also filter reference geometry out.)
        return this.plane;
    }

    /** The square the user sees, in world space — what the plane picker must hit. */
    displayQuad(): { plane: Plane; center: XYZ; width: number; height: number } | undefined {
        if (this._lastExtent === undefined && !this._resolving) void this.shape;
        const extent = this._lastExtent;
        if (extent === undefined) {
            const plane = this.worldPlane();
            return plane === undefined
                ? undefined
                : {
                      plane,
                      center: plane.origin,
                      width: DEFAULT_DISPLAY_SIZE,
                      height: DEFAULT_DISPLAY_SIZE,
                  };
        }
        const plane = extent.plane.transformed(this.worldTransform());
        return { plane, center: plane.origin, width: extent.width, height: extent.height };
    }

    /** INodeWarning: a lost source keeps the last plane, but the user must see it. */
    get warningCount(): number {
        return this._warningCount;
    }

    get warningTooltip(): I18nKeys {
        return "body.missingInputs{0}";
    }

    private setResolutionWarning(error: string | undefined): void {
        const count = error === undefined ? 0 : 1;
        if (count === this._warningCount) return;
        const previous = this._warningCount;
        this._warningCount = count;
        this.emitPropertyChanged("warningCount", previous);
        if (error !== undefined) Logger.warn(`PlaneNode: ${error}`);
    }

    /** Makes the display rectangle grow to cover `node`'s shape (a sketch drawn on this plane). */
    addDisplayDependent(node: INode): void {
        // Register now, fit on the next microtask: the caller may be the sketch's own
        // generateShape, and reading its not-yet-finished shape synchronously would re-enter
        // it. By the microtask the sketch's shape is assigned, whether this is a first
        // registration or a later one.
        this.registerDisplayDependent(node, false);
        this.queueDisplayFit();
    }

    removeDisplayDependent(node: INode): void {
        this.unregisterDisplayDependent(node, false);
        this.queueDisplayFit();
    }

    /** A display-dependent sketch left the document: stop fitting the square around it. */
    private readonly handleNodeRecords = (records: NodeRecord[]) => {
        let changed = false;
        for (const record of records) {
            const node = this._displayDependents.get(record.node.id);
            if (record.action === "remove" || record.action === "transfer") {
                if (node !== undefined) {
                    this.unregisterDisplayDependent(node, false);
                    changed = true;
                }
            } else if (record.action === "add" && isDisplayDependent(record.node, this.id)) {
                // Undo of a delete: the node comes back without regenerating its shape.
                this.registerDisplayDependent(record.node, false);
                changed = true;
            }
        }
        // Reparenting changes the world matrix without a transform event on this node.
        this.syncAncestorWatches();
        if (changed) this.queueDisplayFit();
    };

    generateShape(): Result<IShape> {
        this.syncSourceWatches();
        this.syncAncestorWatches();
        this.syncDisplayDependents();
        if (this._resolving) {
            const fallback = this.plane;
            const inverse = this.worldTransform().invert();
            return fallback === undefined || inverse === undefined
                ? Result.err("Plane is already resolving")
                : this.buildRect(fallback.transformed(inverse), fallback);
        }

        this._resolving = true;
        try {
            const resolved = resolvePlaneDefinition(this.definition, this.document, this._pendingVisited);
            this.setResolutionWarning(resolved.isOk ? undefined : resolved.error);
            // A lost source keeps the last known plane: the node stays visible and the
            // sketches on it keep resolving, instead of the whole document lighting up
            // with "Plane not found" on every rebuild.
            const world = resolved.isOk ? resolved.value : this.plane;
            if (world === undefined) return Result.err(resolved.error);

            const inverse = this.worldTransform().invert();
            if (inverse === undefined) return Result.err("Plane node transform is not invertible");
            const local = world.transformed(inverse);
            this.rememberPlane(world);
            return this.buildRect(local, world);
        } finally {
            this._resolving = false;
        }
    }

    /**
     * Stores the resolved WORLD plane and emits it — a sketch watching this node follows a
     * definition edit.
     */
    private rememberPlane(world: Plane): void {
        const previous = this.plane;
        if (previous !== undefined && samePlane(previous, world)) return;
        this.withoutHistory(() => this.setProperty("plane", world));
    }

    /**
     * A source changed. Only a plane that actually MOVED rebuilds the shape — a fresh rect
     * is never `isEqual` to the previous one, so rebuilding unconditionally would make
     * every unrelated source rebuild ripple through this node and its sketches.
     */
    private refreshFromSources(): void {
        if (this._resolving) return;
        this._resolving = true;
        try {
            const resolved = resolvePlaneDefinition(this.definition, this.document, new Set([this.id]));
            this.setResolutionWarning(resolved.isOk ? undefined : resolved.error);
            if (!resolved.isOk) return;
            const previous = this.plane;
            if (previous !== undefined && samePlane(previous, resolved.value)) return;
            const inverse = this.worldTransform().invert();
            if (inverse === undefined) return;
            const local = resolved.value.transformed(inverse);
            this.withoutHistory(() => {
                this.setProperty("plane", resolved.value);
                this.setShape(this.buildRect(local, resolved.value));
            });
        } finally {
            this._resolving = false;
        }
    }

    /** A bound sketch's content changed: re-fit the display rectangle around it. */
    private refreshDisplay(): void {
        if (this._isDisposed || this._resolving) return;
        const world = this.plane;
        if (world === undefined) return;
        const inverse = this.worldTransform().invert();
        if (inverse === undefined) return;
        const local = world.transformed(inverse);
        const extent = this.displayExtent(world, local);
        // A dependent's shape change usually leaves the fitted square exactly as it was.
        // Rebuilding anyway would emit a fresh `shape` (a new kernel rect is never
        // `isEqual`), and every body watching this plane would rebuild its whole chain.
        if (this._lastExtent !== undefined && sameExtent(this._lastExtent, extent)) return;
        const rect = this.rectOf(extent);
        if (!rect.isOk) return;
        this._lastExtent = extent;
        this.withoutHistory(() => this.setShape(rect));
    }

    /** Defers one display fit to after the current call stack (see `displayExtent`). */
    private queueDisplayFit(): void {
        if (this._displayFitQueued) return;
        this._displayFitQueued = true;
        queueMicrotask(() => {
            this._displayFitQueued = false;
            this.refreshDisplay();
        });
    }

    private readonly handleSourceChanged = (property: string) => {
        if (
            property !== "shape" &&
            property !== "transform" &&
            property !== "plane" &&
            property !== "definitionJson"
        ) {
            return;
        }
        this.refreshFromSources();
    };

    private readonly handleDependentChanged = (property: string) => {
        if (property !== "shape" && property !== "transform") return;
        this.refreshDisplay();
    };

    /** The node's own placement changed: re-map the local rectangle onto the world plane. */
    private readonly handleSelfChanged = (property: keyof this) => {
        if (property === "transform") this.queueDisplayFit();
    };

    /** A parent's placement changed: its world matrix moved the drawing away from the plane. */
    private readonly handleAncestorChanged = (property: string) => {
        if (property === "transform") this.queueDisplayFit();
    };

    /**
     * Watches the whole parent chain: a GroupNode/ComponentNode transform changes the
     * child's world matrix without touching the child. The parametric plane is world-
     * authoritative, so the drawing must be re-mapped under the new inverse.
     */
    private syncAncestorWatches(): void {
        const wanted = new Set<string>();
        let parent = this.parent;
        while (parent !== undefined) {
            wanted.add(parent.id);
            parent = parent.parent;
        }
        syncNodeWatches(this.document, this._ancestorNodes, wanted, this.handleAncestorChanged);
    }

    private syncSourceWatches(): void {
        syncNodeWatches(
            this.document,
            this._sourceNodes,
            definitionNodeIds(this.definition),
            this.handleSourceChanged,
        );
    }

    /**
     * Picks up sketches that name this plane but were not registered explicitly — chiefly
     * the ones restored from a document, where the sketch is constructed before it can
     * resolve the plane node.
     */
    private syncDisplayDependents(): void {
        for (const node of this.document.modelManager.findNodes((candidate) =>
            isDisplayDependent(candidate, this.id),
        )) {
            this.registerDisplayDependent(node, false);
        }
        let removed = false;
        for (const node of [...this._displayDependents.values()]) {
            if (!isDisplayDependent(node, this.id)) {
                this.unregisterDisplayDependent(node, false);
                removed = true;
            }
        }
        // A deleted sketch must stop stretching the square; the node may still be alive
        // (history disposes it later), so unregistering here is what notices the removal.
        if (removed) this.queueDisplayFit();
    }

    private registerDisplayDependent(node: INode, refresh: boolean): void {
        if (this._displayDependents.has(node.id)) return;
        this._displayDependents.set(node.id, node);
        if (isPropertyChanged(node)) node.onPropertyChanged(this.handleDependentChanged);
        if (refresh) this.queueDisplayFit();
    }

    private unregisterDisplayDependent(node: INode, refresh: boolean): void {
        if (this._displayDependents.delete(node.id) && isPropertyChanged(node)) {
            node.removePropertyChanged(this.handleDependentChanged);
        }
        if (refresh) this.queueDisplayFit();
    }

    /**
     * The rectangular display face, built in the node's LOCAL frame. The definition resolves
     * in world coordinates; the result is mapped back so moving the node moves the visible
     * plane (and `plane` composes the node transform again).
     */
    private buildRect(local: Plane, world: Plane): Result<IShape> {
        const extent = this.displayExtent(world, local);
        const rect = this.rectOf(extent);
        // Cache only a rectangle that was actually built: caching a failed one would make
        // the next same-extent refresh skip rebuilding the node's display.
        if (rect.isOk) this._lastExtent = extent;
        return rect;
    }

    private rectOf(extent: DisplayExtent): Result<IShape> {
        const centered = new Plane({
            origin: extent.plane.origin
                .sub(extent.plane.xvec.multiply(extent.width / 2))
                .sub(extent.plane.yvec.multiply(extent.height / 2)),
            normal: extent.plane.normal,
            xvec: extent.plane.xvec,
        });
        const rect = shapeFactory.rect(centered, extent.width, extent.height);
        return rect.isOk ? Result.ok(rect.value) : Result.err(rect.error);
    }

    /** The display rectangle's frame and size: fitted to the bound sketches, or a default square. */
    private displayExtent(world: Plane, local: Plane): DisplayExtent {
        if (this._skipDisplayFit) {
            // The asking sketch is still inside its own `generateShape`; its shape is not
            // assigned until that returns. Fit on the next microtask, when it is.
            this.queueDisplayFit();
            return { plane: local, width: DEFAULT_DISPLAY_SIZE, height: DEFAULT_DISPLAY_SIZE };
        }
        const bounds = this.contentBounds(world);
        if (bounds === undefined) {
            // No sketch to fit: draw the square near what the plane was made from. The
            // frame's own origin is the world origin projected onto the plane and can be
            // far from the part.
            return {
                plane: this.anchorPlane(local) ?? local,
                width: DEFAULT_DISPLAY_SIZE,
                height: DEFAULT_DISPLAY_SIZE,
            };
        }
        const centerU = (bounds.uMin + bounds.uMax) / 2;
        const centerV = (bounds.vMin + bounds.vMax) / 2;
        const contentWidth = bounds.uMax - bounds.uMin;
        const contentHeight = bounds.vMax - bounds.vMin;
        const marginU = Math.max(MIN_DISPLAY_MARGIN, contentWidth * DISPLAY_MARGIN_RATIO);
        const marginV = Math.max(MIN_DISPLAY_MARGIN, contentHeight * DISPLAY_MARGIN_RATIO);
        return {
            plane: new Plane({
                origin: local.origin.add(local.xvec.multiply(centerU)).add(local.yvec.multiply(centerV)),
                normal: local.normal,
                xvec: local.xvec,
            }),
            width: Math.max(contentWidth + 2 * marginU, MIN_DISPLAY_SIZE),
            height: Math.max(contentHeight + 2 * marginV, MIN_DISPLAY_SIZE),
        };
    }

    /** The plane's display frame moved to the definition's anchor, in local coordinates. */
    private anchorPlane(local: Plane): Plane | undefined {
        const anchor = this.definition.anchor;
        if (
            anchor === undefined ||
            !Number.isFinite(anchor.x) ||
            !Number.isFinite(anchor.y) ||
            !Number.isFinite(anchor.z)
        ) {
            return undefined;
        }
        const inverse = this.worldTransform().invert();
        if (inverse === undefined) return undefined;
        // `project` keeps the square exactly in the plane even if the source moved since
        // the anchor was captured.
        return local.translateTo(local.project(inverse.ofPoint(new XYZ(anchor))));
    }

    /** Every bound sketch's world bounding box projected onto the plane's (xvec, yvec). */
    private contentBounds(
        world: Plane,
    ): { uMin: number; uMax: number; vMin: number; vMax: number } | undefined {
        let uMin = Infinity;
        let uMax = -Infinity;
        let vMin = Infinity;
        let vMax = -Infinity;
        for (const node of this._displayDependents.values()) {
            const shape = (node as { shape?: Result<IShape> | null }).shape;
            // A disposing sketch nulls its shape before it unregisters.
            if (shape === undefined || shape === null || !shape.isOk) continue;
            const box = shape.value.boundingBox();
            if (!isValidBox(box)) continue;
            const transform = (node as { worldTransform?: () => Matrix4 }).worldTransform?.();
            const worldBox = transform === undefined ? box : BoundingBox.transformed(box, transform);
            for (const corner of cornersOf(worldBox)) {
                const offset = corner.sub(world.origin);
                const u = offset.dot(world.xvec);
                const v = offset.dot(world.yvec);
                uMin = Math.min(uMin, u);
                uMax = Math.max(uMax, u);
                vMin = Math.min(vMin, v);
                vMax = Math.max(vMax, v);
            }
        }
        return Number.isFinite(uMin) &&
            Number.isFinite(uMax) &&
            Number.isFinite(vMin) &&
            Number.isFinite(vMax)
            ? { uMin, uMax, vMin, vMax }
            : undefined;
    }

    private updateDefinition(update: (definition: PlaneDefinition) => PlaneDefinition): void {
        this.definitionJson = JSON.stringify(update(this.definition));
    }

    /** Runs a derived-state write with the undo history silenced (see SketchNode.withoutHistory). */
    private withoutHistory<T>(action: () => T): T {
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            return action();
        } finally {
            history.disabled = disabled;
        }
    }

    override disposeInternal(): void {
        this.removePropertyChanged(this.handleSelfChanged);
        this.document.modelManager.removeNodeObserver(this.handleNodeRecords);
        for (const node of this._displayDependents.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleDependentChanged);
        }
        this._displayDependents.clear();
        for (const node of this._sourceNodes.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleSourceChanged);
        }
        this._sourceNodes.clear();
        for (const node of this._ancestorNodes.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleAncestorChanged);
        }
        this._ancestorNodes.clear();
        super.disposeInternal();
    }
}

/** The document's shared translucent surface for datum planes, created on first use. */
export function ensurePlaneMaterial(document: IDocument): Material {
    const existing = document.modelManager.materials.find(
        (material) => material.name === PLANE_MATERIAL_NAME,
    );
    if (existing !== undefined) {
        // Keep an older document's shared material overlay-safe too.
        if (existing.depthWrite) existing.depthWrite = false;
        if (!existing.polygonOffset) existing.polygonOffset = true;
        return existing;
    }
    const material = new Material({ document, name: PLANE_MATERIAL_NAME, color: 0x4f8fdf });
    material.opacity = 0.25;
    material.roughness = 0.9;
    material.metalness = 0;
    // The plane is an overlay: a sketch drawn on it lies in exactly the same plane, and
    // a depth-writing, depth-equal surface would flicker against the sketch's profile
    // face.
    material.depthWrite = false;
    material.polygonOffset = true;
    document.modelManager.materials.push(material);
    return material;
}

/** Every node a definition reads geometry from, for the node's change watches. */
export function definitionNodeIds(definition: PlaneDefinition): Set<string> {
    const ids: (string | undefined)[] = [];
    switch (definition.kind) {
        case "offset":
            ids.push(planeRefNodeId(definition.source));
            break;
        case "planePoint":
            ids.push(planeRefNodeId(definition.source), definition.point.nodeId);
            break;
        case "lineAngle":
            ids.push(definition.line.nodeId, planeRefNodeId(definition.reference));
            break;
        case "pointNormal":
            ids.push(definition.axis.nodeId, definition.point.nodeId);
            break;
        case "threePoint":
            ids.push(...definition.points.map((point) => point.nodeId));
            break;
        case "midPlane":
            ids.push(planeRefNodeId(definition.first), planeRefNodeId(definition.second));
            break;
        case "curvePoint":
            ids.push(definition.curve.nodeId, definition.point.nodeId);
            break;
    }
    return new Set(ids.filter((id): id is string => id !== undefined));
}

function defaultDefinition(): PlaneDefinition {
    return { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 0 };
}

function isDisplayDependent(node: INode, planeNodeId: string): boolean {
    return (node as { planeNodeId?: string }).planeNodeId === planeNodeId;
}

interface DisplayExtent {
    readonly plane: Plane;
    readonly width: number;
    readonly height: number;
}

function sameExtent(left: DisplayExtent, right: DisplayExtent): boolean {
    return (
        samePlane(left.plane, right.plane) &&
        Math.abs(left.width - right.width) <= Precision.Distance &&
        Math.abs(left.height - right.height) <= Precision.Distance
    );
}

function samePlane(left: Plane, right: Plane): boolean {
    return (
        left.origin.distanceTo(right.origin) <= Precision.Distance &&
        left.normal.dot(right.normal) >= 1 - 1e-6 &&
        // The in-plane X axis is part of the plane's identity: a three-point plane whose
        // second point slides within the same plane stays on the same point set but its
        // sketch frame rotates.
        left.xvec.dot(right.xvec) >= 1 - 1e-6
    );
}

function isValidBox(box: BoundingBox): boolean {
    return (
        Number.isFinite(box.min.x) &&
        Number.isFinite(box.min.y) &&
        Number.isFinite(box.min.z) &&
        Number.isFinite(box.max.x) &&
        Number.isFinite(box.max.y) &&
        Number.isFinite(box.max.z) &&
        box.min.x <= box.max.x &&
        box.min.y <= box.max.y &&
        box.min.z <= box.max.z
    );
}

function cornersOf(box: BoundingBox): XYZ[] {
    const { min, max } = box;
    return [
        new XYZ(min.x, min.y, min.z),
        new XYZ(min.x, min.y, max.z),
        new XYZ(min.x, max.y, min.z),
        new XYZ(min.x, max.y, max.z),
        new XYZ(max.x, min.y, min.z),
        new XYZ(max.x, min.y, max.z),
        new XYZ(max.x, max.y, min.z),
        new XYZ(max.x, max.y, max.z),
    ];
}
