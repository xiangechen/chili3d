// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id, isPropertyChanged, type NodeRecord, PubSub, Result } from "../foundation";
import type { I18nKeys } from "../i18n";
import { BoundingBox, XYZ, type XYZLike } from "../math";
import { LENGTH_UNITS } from "../parameters/unitSpec";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import {
    type AngleTextPlacement,
    type AnnotationAssociation,
    associationNodeIds,
    type CircleEdgeAssociation,
    type EdgeAnchor,
    type EdgePairAssociation,
    getAnnotationAssociationResolver,
    type IAnnotationAssociationResolver,
    type LinearTextPlacement,
    type PointAnchor,
    type PointPairAssociation,
    type ResolvedAssociation,
    type ResolvedCircleEdge,
    type ResolvedLine,
} from "./annotationAssociation";
import {
    angleFromLines,
    angleTextPlacement,
    angleTextPoint,
    angularDimensionSweep,
    DIMENSION_TEXT_HEIGHT,
    linearTextPlacement,
    linearTextPoint,
} from "./dimensionLayout";
import { type DimensionMeasurement, measurementText } from "./dimensionText";
import type { INode } from "./node";
import type { INodeWarning } from "./nodeWarning";
import { VisualNode } from "./visualNode";

export const AnnotationTypes = ["dimension", "text", "refInfiniteLine", "refSegment"] as const;
export type AnnotationType = (typeof AnnotationTypes)[number];

interface AnnotationOptionsBase {
    document: IDocument;
    annotationType: AnnotationType;
    name: string;
    id?: string;
    color?: number;
    visible?: boolean;
}

export type DimensionType = "linear" | "angular" | "radial" | "diameter";

export interface DimensionAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "dimension";
    startPoint: XYZ;
    endPoint: XYZ;
    /** Where the user placed the dimension text; fixes the dimension plane and offset side. */
    textPoint: XYZ;
    /** The angle vertex — only an angular dimension carries one. */
    centerPoint?: XYZ;
    /**
     * The circle's axis — only radial/diameter dimensions carry one. Their three
     * points are collinear by construction, so the dimension plane cannot be
     * rederived from them; this pins it.
     */
    planeNormal?: XYZ;
    dimensionType?: DimensionType;
    /** World-space text height (mm); arrows and gaps scale with it. Defaults to `DIMENSION_TEXT_HEIGHT`. */
    textHeight?: number;
    /** Text shown instead of the measured value; `<>` inside it stands for that value. */
    textOverride?: string;
}

export interface TextAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "text";
    content: string;
    position: XYZ;
    /** Where the leader points; leave it out for text that stands on its own. */
    leaderPoint?: XYZ;
    /** World-space text height (mm). Defaults to `DIMENSION_TEXT_HEIGHT`. */
    textHeight?: number;
}

export interface RefInfiniteLineAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refInfiniteLine";
    point: XYZ;
    direction: XYZ;
}

export interface RefSegmentAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refSegment";
    startPoint: XYZ;
    endPoint: XYZ;
}

export type AnnotationOptions =
    | DimensionAnnotationOptions
    | TextAnnotationOptions
    | RefInfiniteLineAnnotationOptions
    | RefSegmentAnnotationOptions;

/** The point properties a resolved association writes as one change. */
type DerivedPointKey =
    | "startPoint"
    | "endPoint"
    | "textPoint"
    | "centerPoint"
    | "planeNormal"
    | "position"
    | "leaderPoint";

/**
 * An annotation's points are its local geometry; placement happens through the
 * inherited `transform`, exactly like any other `VisualNode`. That lets an
 * annotation live inside a `Component` and be carried by the instance matrices.
 */
export abstract class Annotation extends VisualNode implements INodeWarning {
    @serialize()
    readonly annotationType: AnnotationType;
    @serialize()
    get color(): number {
        return this.getPrivateValue("color", 0xffff00);
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    /** Cached parse of `associationJson`; reset whenever the JSON changes. */
    private _associationCache?: AnnotationAssociation;
    private _associationRead = false;
    private _referenceLost = false;
    private readonly _watchedNodes = new Map<string, INode>();
    private _observingNodes = false;

    /**
     * The association as persisted JSON. A plain object cannot go through the serializer
     * (it refuses unregistered constructors), so the object graph travels as a string —
     * the same shape `SketchNode.planeRefJson` uses.
     */
    @serialize()
    get associationJson(): string | undefined {
        return this.getPrivateValue("associationJson", undefined);
    }
    set associationJson(value: string | undefined) {
        if (!this.setProperty("associationJson", value)) return;
        this._associationCache = undefined;
        this._associationRead = false;
        this.syncAssociationWatch();
    }

    /**
     * What this annotation measures on other nodes, or undefined for a free-standing one.
     * Setting it starts following the source nodes from the next rebuild on.
     */
    get association(): AnnotationAssociation | undefined {
        if (!this._associationRead) {
            this._associationRead = true;
            this._associationCache = parseAssociation(this.associationJson);
        }
        return this._associationCache;
    }
    set association(value: AnnotationAssociation | undefined) {
        this._associationCache = value;
        this._associationRead = true;
        this.associationJson = value === undefined ? undefined : JSON.stringify(value);
        if (value === undefined) this.setReferenceLost(false, true);
    }

    /** INodeWarning: a dangling association badges the model-tree row. */
    get warningCount(): number {
        return this._referenceLost ? 1 : 0;
    }

    /** INodeWarning: badge tooltip and the one-shot loss toast — `{0}` takes the count. */
    get warningTooltip(): I18nKeys {
        return "annotation.referenceLost{0}";
    }

    /**
     * Re-resolves the associated geometry on the sources' current shapes and lets the
     * subclass move its own points onto it. Returns false when there is nothing to
     * resolve, when a source or a sub-shape is gone, or when no resolver is installed.
     *
     * A failed resolve keeps the last points — the annotation stays where it last made
     * sense — and turns on the warning. Without a resolver (a build without the
     * parametric package) nothing is flagged: the annotation is simply static.
     */
    updateFromAssociation(silent = false): boolean {
        const document = this.document;
        if (!document) return false;
        this.syncAssociationWatch();

        const association = this.association;
        if (association === undefined) return false;
        const resolver = getAnnotationAssociationResolver();
        if (resolver === undefined) return false;

        const resolved = resolveAssociation(document, association, resolver);
        if (!resolved.isOk || !this.applyAssociation(association, resolved.value)) {
            this.setReferenceLost(true, silent);
            return false;
        }

        this.setReferenceLost(false, silent);
        return true;
    }

    /** Subclass: write the resolved world geometry into this annotation's own points. */
    protected applyAssociation(_association: AnnotationAssociation, _resolved: ResolvedAssociation): boolean {
        return false;
    }

    /** Runs derived writes without letting them enter the undo stack. */
    protected writeDerived(action: () => void): void {
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            action();
        } finally {
            history.disabled = disabled;
        }
    }

    /**
     * Writes the points one resolve moves as a single change. The viewport rebuilds its
     * whole layout on every emitted property, so a circle resolve would otherwise cost
     * four rebuilds; the listeners only care that the points changed, not which one.
     */
    protected writeDerivedPoints(values: Partial<Record<DerivedPointKey, XYZ>>): void {
        const entries = Object.entries(values) as [DerivedPointKey, XYZ][];
        if (entries.length === 0) return;

        this.writeDerived(() => {
            for (const [key, value] of entries) {
                (this as unknown as { setPrivateValue(key: string, value: unknown): void }).setPrivateValue(
                    key,
                    value,
                );
            }
            this.emitPropertyChanged(entries[0][0] as keyof this, undefined as never);
        });
    }

    /**
     * Rewrites the node ids this annotation follows, for a command that replaces a body
     * with a successor (`retargetInstanceSources`). Returns true when an id changed; the
     * annotation re-resolves against the successor so its points are current.
     */
    remapAssociationNodes(mapping: ReadonlyMap<string, string>): boolean {
        const association = this.association;
        if (association === undefined || mapping.size === 0) return false;

        let changed = false;
        const remap = (id: string | undefined): string | undefined => {
            if (id === undefined) return undefined;
            const next = mapping.get(id);
            if (next === undefined || next === id) return id;
            changed = true;
            return next;
        };
        const remapAnchor = (anchor: PointAnchor): PointAnchor => ({
            ...anchor,
            nodeId: remap(anchor.nodeId),
        });

        let next: AnnotationAssociation;
        switch (association.kind) {
            case "circleEdge":
                next = { ...association, nodeId: remap(association.nodeId) ?? association.nodeId };
                break;
            case "point":
                next = { ...association, anchor: remapAnchor(association.anchor) };
                break;
            case "pointPair":
                next = {
                    ...association,
                    start: remapAnchor(association.start),
                    end: remapAnchor(association.end),
                };
                break;
            case "edgePair":
                next = {
                    ...association,
                    first: {
                        ...association.first,
                        nodeId: remap(association.first.nodeId) ?? association.first.nodeId,
                    },
                    second: {
                        ...association.second,
                        nodeId: remap(association.second.nodeId) ?? association.second.nodeId,
                    },
                };
                break;
        }

        if (!changed) return false;
        this.association = next;
        this.updateFromAssociation(true);
        return true;
    }

    /**
     * A copy is a new placement, not another measurement of the same geometry: arraying
     * or copying a bound annotation would otherwise have every copy resolve back onto
     * the source and overlap it.
     */
    override clone(): this {
        const clone = super.clone();
        // The copy clearing its own reference is derived from the copy itself, not an
        // edit: `Node.clone()` promises to stay out of the undo stack.
        clone.writeDerived(() => {
            clone.association = undefined;
        });
        return clone;
    }

    /**
     * Follows every node the association reads: `shape` is the one correct "rebuild
     * finished" signal (`featuresJson` fires before the new shape is installed),
     * `transform` moves an instance or a grouped body. The model observer catches a
     * source appearing or disappearing — deserialization bypasses the association
     * setter, so the initial sync also runs from `updateFromAssociation`.
     */
    private syncAssociationWatch(): void {
        const document = this.document;
        if (!document) return;

        const association = this.association;
        const wanted = new Set(association === undefined ? [] : associationNodeIds(association));
        // A group/instance transform moves the source's world geometry without touching
        // the source node, so the ancestors of every referenced node are followed too.
        for (const id of [...wanted]) {
            const node = document.modelManager.findNode((candidate) => candidate.id === id);
            let parent = node?.parent;
            while (parent !== undefined) {
                wanted.add(parent.id);
                parent = parent.parent;
            }
        }
        for (const [id, node] of this._watchedNodes) {
            if (wanted.has(id)) continue;
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleSourcePropertyChanged);
            this._watchedNodes.delete(id);
        }
        for (const id of wanted) {
            if (this._watchedNodes.has(id)) continue;
            const node = document.modelManager.findNode((candidate) => candidate.id === id);
            if (node && isPropertyChanged(node)) {
                node.onPropertyChanged(this.handleSourcePropertyChanged);
                this._watchedNodes.set(id, node);
            }
        }

        const shouldObserve = association !== undefined;
        if (shouldObserve && !this._observingNodes) {
            document.modelManager.addNodeObserver(this.handleNodesChanged);
            this._observingNodes = true;
        } else if (!shouldObserve && this._observingNodes) {
            document.modelManager.removeNodeObserver(this.handleNodesChanged);
            this._observingNodes = false;
        }
    }

    private readonly handleSourcePropertyChanged = (property: string) => {
        if (property === "shape" || property === "transform") this.updateFromAssociation();
    };

    private readonly handleNodesChanged = (records: NodeRecord[]) => {
        // A removed annotation must stop following its sources: otherwise a later
        // rebuild still resolves it and raises a "reference lost" toast for a node
        // that is no longer in the document.
        if (records.some((record) => record.node === this && record.action === "remove")) {
            this.unwatchAssociations();
            return;
        }

        const association = this.association;
        if (association === undefined) return;
        const wanted = new Set(associationNodeIds(association));
        if (!records.some((record) => wanted.has(record.node.id))) return;

        this.syncAssociationWatch();
        this.updateFromAssociation();
    };

    /**
     * Drops the association because an explicit placement has taken over (a move
     * command, a grip drag of an attachment point). A plain transform write does NOT
     * call this: grouping normalizes a member's transform to world space and must keep
     * the association, so "the user moved it" is an explicit action, not an inference
     * from a property event.
     */
    detachAssociation(): void {
        if (this.association !== undefined) this.association = undefined;
    }

    private setReferenceLost(lost: boolean, silent: boolean): void {
        if (this._referenceLost === lost) return;

        const oldCount = this.warningCount;
        this._referenceLost = lost;
        // Runtime state, not a persisted property: a plain emit keeps it out of history.
        this.emitPropertyChanged("warningCount", oldCount);
        if (lost && !silent) {
            PubSub.default.pub("showToast", this.warningTooltip, this.warningCount);
        }
    }

    private unwatchAssociations(): void {
        for (const node of this._watchedNodes.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleSourcePropertyChanged);
        }
        this._watchedNodes.clear();
        const document = this.document;
        if (document && this._observingNodes) {
            document.modelManager.removeNodeObserver(this.handleNodesChanged);
        }
        this._observingNodes = false;
    }

    override disposeInternal(): void {
        this.unwatchAssociations();
        super.disposeInternal();
    }

    constructor(options: AnnotationOptionsBase) {
        super(options.document, options.name, options.id ?? Id.generate());
        this.annotationType = options.annotationType;
        this.setPrivateValue("associationJson", undefined);
        if (options.color !== undefined) this.setPrivateValue("color", options.color);
        if (options.visible !== undefined) this.visible = options.visible;
    }

    override display(): I18nKeys {
        return "annotation";
    }
    override boundingBox(): BoundingBox | undefined {
        return undefined;
    }
}

@serializable()
export class DimensionAnnotation extends Annotation {
    declare readonly annotationType: "dimension";

    @serialize()
    get dimensionType(): DimensionType {
        return this.getPrivateValue("dimensionType", "linear");
    }
    set dimensionType(value: DimensionType) {
        this.setProperty("dimensionType", value);
    }

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    @serialize()
    get textPoint(): XYZ {
        return this.getPrivateValue("textPoint");
    }
    set textPoint(value: XYZ) {
        this.setProperty("textPoint", value);
    }

    /** The angle vertex — set only on angular dimensions, undefined otherwise. */
    @serialize()
    get centerPoint(): XYZ | undefined {
        return this.getPrivateValue("centerPoint", undefined);
    }
    set centerPoint(value: XYZ | undefined) {
        this.setProperty("centerPoint", value);
    }

    /** The circle's axis — set only on radial/diameter dimensions, pinning their plane. */
    @serialize()
    get planeNormal(): XYZ | undefined {
        return this.getPrivateValue("planeNormal", undefined);
    }
    set planeNormal(value: XYZ | undefined) {
        this.setProperty("planeNormal", value);
    }

    /**
     * World-space height of the dimension text (mm) — the whole annotation
     * (arrows, extension gaps) scales with it. Non-positive values are refused:
     * they would make the layout collapse instead of drawing.
     */
    @serialize()
    @property("dimension.textHeight", { unit: LENGTH_UNITS })
    get textHeight(): number {
        return this.getPrivateValue("textHeight", DIMENSION_TEXT_HEIGHT);
    }
    set textHeight(value: number) {
        if (value > 0) this.setProperty("textHeight", value);
    }

    /**
     * Text shown instead of the measured value — a `<>` inside it expands to that
     * value, so "Ø<>" draws as "Ø10.00". Empty (the default) shows the measurement
     * with the dimension kind's affix (R / Ø / °).
     */
    @serialize()
    @property("dimension.textOverride")
    get textOverride(): string {
        return this.getPrivateValue("textOverride", "");
    }
    set textOverride(value: string) {
        this.setProperty("textOverride", value);
    }

    /**
     * The measured value, derived from the attachment points — never stored. An
     * angular dimension reports the drawn sweep in degrees (the text point picks
     * the reflex side, so the number and the arc never disagree); the rest report
     * a distance.
     */
    get value(): number {
        if (this.dimensionType === "angular" && this.centerPoint !== undefined) {
            const sweep = angularDimensionSweep(
                this.centerPoint,
                this.startPoint,
                this.endPoint,
                this.textPoint,
            );
            if (sweep !== undefined) return (Math.abs(sweep) * 180) / Math.PI;
        }
        return this.startPoint.distanceTo(this.endPoint);
    }

    /** How this dimension's kind reads: a radial dimension is a radius, an angular one an angle. */
    get measurement(): DimensionMeasurement {
        switch (this.dimensionType) {
            case "radial":
                return "radius";
            case "diameter":
                return "diameter";
            case "angular":
                return "angle";
            default:
                return "length";
        }
    }

    /**
     * The dimension text: the override as written (with `<>` expanded to the digits), or
     * the measured value with its kind's affix — `R12.00`, `Ø24.00`, `45.0°`. The digits
     * and affixes are the ones every dimension reads with; see `dimensionText`.
     */
    formattedValue(digits?: number): string {
        const text = measurementText(this.measurement, this.value, digits);
        if (this.textOverride !== "") return this.textOverride.replaceAll("<>", text.value);
        return `${text.prefix}${text.value}${text.suffix}`;
    }

    /**
     * Re-reads the label placement from the current points, for a grip drag of the text
     * point that must survive the next rebuild. Each association kind stores its own
     * placement shape; the points themselves say where the user put the label.
     */
    refreshAssociationPlacement(): void {
        const association = this.association;
        if (association === undefined) return;

        const world = this.worldTransform();
        const start = world.ofPoint(this.startPoint);
        const end = world.ofPoint(this.endPoint);
        const text = world.ofPoint(this.textPoint);

        switch (association.kind) {
            case "circleEdge": {
                if (this.planeNormal === undefined) return;
                const center = this.dimensionType === "diameter" ? start.add(end).multiply(0.5) : start;
                const axis = world.ofVector(this.planeNormal).normalize();
                const leader = text.sub(center).normalize();
                if (axis === undefined || leader === undefined) return;
                this.association = {
                    ...association,
                    axis: plain(axis),
                    leader: plain(leader),
                    distance: text.distanceTo(center),
                };
                return;
            }
            case "pointPair": {
                const placement = linearTextPlacement(start, end, text);
                if (placement !== undefined) this.association = { ...association, placement };
                return;
            }
            case "edgePair": {
                if (this.centerPoint === undefined) return;
                const vertex = world.ofPoint(this.centerPoint);
                const placement = angleTextPlacement(vertex, start, end, text);
                if (placement !== undefined) this.association = { ...association, placement };
                return;
            }
            default:
                return;
        }
    }

    protected override applyAssociation(
        association: AnnotationAssociation,
        resolved: ResolvedAssociation,
    ): boolean {
        switch (resolved.kind) {
            case "circleEdge":
                return association.kind === "circleEdge"
                    ? this.applyCircleEdge(association, resolved.circle)
                    : false;
            case "pointPair":
                return association.kind === "pointPair"
                    ? this.applyPointPair(association, resolved.start, resolved.end)
                    : false;
            case "edgePair":
                return association.kind === "edgePair"
                    ? this.applyEdgePair(association, resolved.first, resolved.second)
                    : false;
            default:
                return false;
        }
    }

    /**
     * Writes a resolved world-space circle back into the annotation's local points.
     *
     * The contract is explicit because the annotation's points are local while the
     * resolver answers in world space: the circle and its placement go through the
     * inverse of `worldTransform()`, never assuming an identity transform. The stored
     * leader is rotated with the axis so a rotated body carries the label along.
     */
    private applyCircleEdge(association: CircleEdgeAssociation, edge: ResolvedCircleEdge): boolean {
        const inverse = this.worldTransform().invert();
        const axisWorld = edge.axis.normalize();
        const leaderWorld = rotateLeader(association.leader, association.axis, axisWorld);
        if (inverse === undefined || axisWorld === undefined || leaderWorld === undefined) return false;

        const centerLocal = inverse.ofPoint(edge.center);
        const rimLocal = inverse.ofPoint(edge.center.add(leaderWorld.multiply(edge.radius)));
        const textLocal = inverse.ofPoint(edge.center.add(leaderWorld.multiply(association.distance)));
        const dirLocal = rimLocal.sub(centerLocal).normalize();
        const axisLocal = inverse.ofVector(axisWorld).normalize();
        if (dirLocal === undefined || axisLocal === undefined) return false;

        const radiusLocal = centerLocal.distanceTo(rimLocal);
        const startLocal =
            this.dimensionType === "diameter" ? centerLocal.sub(dirLocal.multiply(radiusLocal)) : centerLocal;
        const endLocal = centerLocal.add(dirLocal.multiply(radiusLocal));

        this.writeDerivedPoints({
            startPoint: startLocal,
            endPoint: endLocal,
            textPoint: textLocal,
            planeNormal: axisLocal,
        });
        return true;
    }

    /** A linear distance: the two anchored points, with the label kept in its frame. */
    private applyPointPair(association: PointPairAssociation, startWorld: XYZ, endWorld: XYZ): boolean {
        const inverse = this.worldTransform().invert();
        if (inverse === undefined) return false;

        const text = association.placement
            ? linearTextPoint(startWorld, endWorld, association.placement)
            : undefined;
        if (association.placement !== undefined && text === undefined) return false;

        this.writeDerivedPoints({
            startPoint: inverse.ofPoint(startWorld),
            endPoint: inverse.ofPoint(endWorld),
            ...(text !== undefined ? { textPoint: inverse.ofPoint(text) } : {}),
        });
        return true;
    }

    /** An angular dimension: the two edges' vertex and directions, and the label's sector. */
    private applyEdgePair(
        association: EdgePairAssociation,
        first: ResolvedLine,
        second: ResolvedLine,
    ): boolean {
        const angle = angleFromLines(first, second);
        if (angle === undefined) return false;

        const text = angleTextPoint(angle.vertex, angle.p1, angle.p2, association.placement);
        const inverse = this.worldTransform().invert();
        if (text === undefined || inverse === undefined) return false;

        this.writeDerivedPoints({
            centerPoint: inverse.ofPoint(angle.vertex),
            startPoint: inverse.ofPoint(angle.p1),
            endPoint: inverse.ofPoint(angle.p2),
            textPoint: inverse.ofPoint(text),
        });
        return true;
    }

    constructor(options: DimensionAnnotationOptions) {
        super(options);
        this.setPrivateValue("dimensionType", options.dimensionType ?? "linear");
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
        this.setPrivateValue("textPoint", options.textPoint);
        if (options.centerPoint !== undefined) {
            this.setPrivateValue("centerPoint", options.centerPoint);
        }
        if (options.planeNormal !== undefined) {
            this.setPrivateValue("planeNormal", options.planeNormal);
        }
        if (options.textHeight !== undefined && options.textHeight > 0) {
            this.setPrivateValue("textHeight", options.textHeight);
        }
        if (options.textOverride !== undefined) {
            this.setPrivateValue("textOverride", options.textOverride);
        }
    }

    override display(): I18nKeys {
        return "annotation.dimension";
    }

    override boundingBox(): BoundingBox | undefined {
        const points = [this.startPoint, this.endPoint, this.textPoint];
        if (this.centerPoint !== undefined) points.push(this.centerPoint);
        return BoundingBox.fromPoints(points);
    }
}

/**
 * A note: a line of text placed in space, with a leader back to whatever it is
 * about. The leader is what makes it an annotation rather than a floating label —
 * without one the text stands alone, which the model allows and the visual draws.
 * The text faces the camera (see the visual), so a note reads from any side.
 */
@serializable()
export class TextAnnotation extends Annotation {
    declare readonly annotationType: "text";

    @serialize()
    @property("text.content")
    get content(): string {
        return this.getPrivateValue("content");
    }
    set content(value: string) {
        this.setProperty("content", value);
    }

    /** Where the text sits — the free end of the leader. */
    @serialize()
    get position(): XYZ {
        return this.getPrivateValue("position");
    }
    set position(value: XYZ) {
        this.setProperty("position", value);
    }

    /** The point the leader points at; undefined draws no leader at all. */
    @serialize()
    get leaderPoint(): XYZ | undefined {
        return this.getPrivateValue("leaderPoint", undefined);
    }
    set leaderPoint(value: XYZ | undefined) {
        this.setProperty("leaderPoint", value);
    }

    /** World-space height of the text (mm), the same size a dimension reads at. */
    @serialize()
    @property("dimension.textHeight", { unit: LENGTH_UNITS })
    get textHeight(): number {
        return this.getPrivateValue("textHeight", DIMENSION_TEXT_HEIGHT);
    }
    set textHeight(value: number) {
        if (value > 0) this.setProperty("textHeight", value);
    }

    override boundingBox(): BoundingBox | undefined {
        const points = [this.position];
        if (this.leaderPoint !== undefined) points.push(this.leaderPoint);
        return BoundingBox.fromPoints(points);
    }

    /**
     * The leader follows its anchored point, and the text keeps the offset the user
     * gave it: the whole callout moves with the geometry rather than stretching the
     * leader across the viewport to a stale text position.
     */
    protected override applyAssociation(
        _association: AnnotationAssociation,
        resolved: ResolvedAssociation,
    ): boolean {
        if (resolved.kind !== "point" || this.leaderPoint === undefined) return false;

        const inverse = this.worldTransform().invert();
        if (inverse === undefined) return false;

        const leader = inverse.ofPoint(resolved.point);
        const delta = leader.sub(this.leaderPoint);
        this.writeDerivedPoints({
            leaderPoint: leader,
            position: this.position.add(delta),
        });
        return true;
    }

    constructor(options: TextAnnotationOptions) {
        super(options);
        this.setPrivateValue("content", options.content);
        this.setPrivateValue("position", options.position);
        this.setPrivateValue("leaderPoint", options.leaderPoint);
        if (options.textHeight !== undefined) this.setPrivateValue("textHeight", options.textHeight);
    }
}

@serializable()
export class RefInfiniteLineAnnotation extends Annotation {
    declare readonly annotationType: "refInfiniteLine";

    @serialize()
    get point(): XYZ {
        return this.getPrivateValue("point");
    }
    set point(value: XYZ) {
        this.setProperty("point", value);
    }

    @serialize()
    get direction(): XYZ {
        return this.getPrivateValue("direction");
    }
    set direction(value: XYZ) {
        this.setProperty("direction", value);
    }

    constructor(options: RefInfiniteLineAnnotationOptions) {
        super(options);
        this.setPrivateValue("point", options.point);
        this.setPrivateValue("direction", options.direction);
    }
}

@serializable()
export class RefSegmentAnnotation extends Annotation {
    declare readonly annotationType: "refSegment";

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    /** Both ends follow their anchors, each independently (one may be a free point). */
    protected override applyAssociation(
        _association: AnnotationAssociation,
        resolved: ResolvedAssociation,
    ): boolean {
        if (resolved.kind !== "pointPair") return false;

        const inverse = this.worldTransform().invert();
        if (inverse === undefined) return false;

        this.writeDerivedPoints({
            startPoint: inverse.ofPoint(resolved.start),
            endPoint: inverse.ofPoint(resolved.end),
        });
        return true;
    }

    constructor(options: RefSegmentAnnotationOptions) {
        super(options);
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
    }

    override boundingBox(): BoundingBox | undefined {
        return BoundingBox.fromPoints([this.startPoint, this.endPoint]);
    }
}

function parseAssociation(json: string | undefined): AnnotationAssociation | undefined {
    if (json === undefined) return undefined;
    try {
        const value = JSON.parse(json) as AnnotationAssociation;
        switch (value?.kind) {
            case "circleEdge":
                if (typeof value.nodeId !== "string" || value.edge === undefined) return undefined;
                if (!isVector(value.axis) || !isVector(value.leader)) return undefined;
                return typeof value.distance === "number" ? value : undefined;
            case "point":
                return isPointAnchor(value.anchor) ? value : undefined;
            case "pointPair":
                if (!isPointAnchor(value.start) || !isPointAnchor(value.end)) return undefined;
                if (value.placement !== undefined && !isLinearPlacement(value.placement)) return undefined;
                return value;
            case "edgePair":
                if (!isEdgeAnchor(value.first) || !isEdgeAnchor(value.second)) return undefined;
                return isAnglePlacement(value.placement) ? value : undefined;
            default:
                return undefined;
        }
    } catch {
        // A hand-edited or truncated payload degrades to a static annotation.
        return undefined;
    }
}

function isPointAnchor(value: unknown): value is PointAnchor {
    const anchor = value as PointAnchor | undefined;
    return isVector(anchor?.point) && (anchor?.nodeId === undefined || typeof anchor.nodeId === "string");
}

function isEdgeAnchor(value: unknown): value is EdgeAnchor {
    const anchor = value as EdgeAnchor | undefined;
    return typeof anchor?.nodeId === "string" && anchor.ref !== undefined;
}

function isLinearPlacement(value: unknown): value is LinearTextPlacement {
    const placement = value as LinearTextPlacement | undefined;
    return (
        typeof placement?.along === "number" &&
        typeof placement.lateral === "number" &&
        isVector(placement.normal)
    );
}

function isAnglePlacement(value: unknown): value is AngleTextPlacement {
    const placement = value as AngleTextPlacement | undefined;
    return (
        typeof placement?.radius === "number" &&
        typeof placement.reflex === "boolean" &&
        // Older payloads predate the flip bit; a missing one reads as "no flip".
        (placement.flip === undefined || typeof placement.flip === "boolean")
    );
}

function resolveAssociation(
    document: IDocument,
    association: AnnotationAssociation,
    resolver: IAnnotationAssociationResolver,
): Result<ResolvedAssociation> {
    switch (association.kind) {
        case "circleEdge": {
            const circle = resolver.resolveCircleEdge(document, association);
            return circle.isOk
                ? Result.ok({ kind: "circleEdge", circle: circle.value })
                : Result.err(circle.error);
        }
        case "point": {
            const point = resolver.resolvePointAnchor(document, association.anchor);
            return point.isOk ? Result.ok({ kind: "point", point: point.value }) : Result.err(point.error);
        }
        case "pointPair": {
            const start = resolver.resolvePointAnchor(document, association.start);
            if (!start.isOk) return Result.err(start.error);
            const end = resolver.resolvePointAnchor(document, association.end);
            if (!end.isOk) return Result.err(end.error);
            return Result.ok({ kind: "pointPair", start: start.value, end: end.value });
        }
        case "edgePair": {
            const first = resolver.resolveEdgeAnchor(document, association.first);
            if (!first.isOk) return Result.err(first.error);
            const second = resolver.resolveEdgeAnchor(document, association.second);
            if (!second.isOk) return Result.err(second.error);
            return Result.ok({ kind: "edgePair", first: first.value, second: second.value });
        }
    }
}

function isVector(value: unknown): value is XYZLike {
    const vector = value as Partial<XYZLike> | undefined;
    return typeof vector?.x === "number" && typeof vector.y === "number" && typeof vector.z === "number";
}

function plain(value: XYZ): XYZLike {
    return { x: value.x, y: value.y, z: value.z };
}

/**
 * The stored leader direction under a possibly rotated circle: rotate it by the
 * minimal rotation taking the old axis to the new one. Axes are directionless, so
 * the new axis is flipped to agree with the old first; a zero cross product (parallel
 * or degenerate) leaves the leader alone, which is the identity rotation anyway.
 */
function rotateLeader(leader: XYZLike, fromAxis: XYZLike, toAxis: XYZ | undefined): XYZ | undefined {
    const from = new XYZ(fromAxis).normalize();
    const direction = new XYZ(leader).normalize();
    if (from === undefined || direction === undefined || toAxis === undefined) return undefined;

    const to = from.dot(toAxis) < 0 ? toAxis.reverse() : toAxis;
    const dot = Math.min(1, Math.max(-1, from.dot(to)));
    if (dot > 1 - 1e-9) return direction;

    const axis = from.cross(to).normalize();
    if (axis === undefined) return direction;

    return rotateAround(direction, axis, Math.acos(dot));
}

/** Rodrigues rotation of `vector` around a unit `axis` by `angle` radians. */
function rotateAround(vector: XYZ, axis: XYZ, angle: number): XYZ | undefined {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cross = axis.cross(vector).multiply(sin);
    const along = axis.multiply(axis.dot(vector) * (1 - cos));
    return vector.multiply(cos).add(cross).add(along).normalize();
}
