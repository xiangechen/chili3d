// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CommandStore,
    command,
    debounce,
    I18n,
    type IEdge,
    type IFace,
    type INode,
    type INodeVisual,
    type IShape,
    type IStep,
    LENGTH_UNITS,
    type Matrix4,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import {
    type ChamferFeatureData,
    type FeatureData,
    type FilletFeatureData,
    featureHandler,
} from "../features/feature";
import { idHasPrefix } from "../features/trackedId";
import { ParametricBodyNode } from "../parametricBodyNode";
import { outwardNormalAt } from "./arrowHandle";
import type { PickSettledCommand } from "./pickSettled";
import { evaluateChainSnapshot } from "./reselectSession";
import { SELECTED_FACE_STATE } from "./selectedFaceState";
import { type ValueArrowData, type ValueArrowPickHandler, ValueArrowSelectStep } from "./valueArrowPickStep";

/** The corner features whose size this edits. */
type CornerFeatureData = FilletFeatureData | ChamferFeatureData;

/**
 * The fillet/chamfer feature that built the FACE at `faceIndex` on `body`, or undefined when that
 * face is not a corner's own surface.
 *
 * A corner names the surface it builds under its own feature id — `prefixedId(featureId, …)` in
 * `attributeCornerFaces` (see `edgeCorner.ts`) — which is why the prefix is the whole answer and
 * nothing has to be re-evaluated or indexed. Three things the test has to get right:
 *
 * - **The kind is filtered, not just documented.** Shell, thicken, draft and pattern mint FACE ids
 *   under their own feature id too, so without the filter a pick could come back as a feature that
 *   never built a corner at all.
 * - **Every leaf is asked.** `prefixedId` prefixes every component, and a face merged with a
 *   neighbour keeps them all, so a merged face still answers for the corner that first named it.
 * - **Exactly one owner.** A face merged from two corners' surfaces carries both prefixes, and
 *   which of the two the user means is not a question the face can answer.
 *
 * A face with no id at all — the patch at a vertex where three rounds meet, which
 * `attributeCornerFaces` deliberately leaves unnamed because no single input edge owns it — finds
 * no owner, and so cannot be picked. Every other round of that same feature still can, and the
 * edit lands on the whole feature, so nothing is out of reach.
 *
 * `features` is only a shortcut for a caller that already read the list: the `features` getter
 * re-parses the stored JSON on every access, and a pointer move asks this about every face the
 * pointer detects.
 */
export function cornerFeatureOf(
    body: ParametricBodyNode,
    faceIndex: number,
    features: readonly FeatureData[] = body.features,
): CornerFeatureData | undefined {
    if (!body.hasTrackedIds("face")) return undefined;
    const faceId = body.faceIdAt(faceIndex);
    if (faceId === undefined) return undefined;

    const owners = features.filter(
        (feature): feature is CornerFeatureData =>
            (feature.type === "fillet" || feature.type === "chamfer") && idHasPrefix(faceId, feature.id),
    );
    return owners.length === 1 ? owners[0] : undefined;
}

/**
 * The picked face's feature and the body it belongs to — everything the edit needs, so the commit
 * never has to re-read a selection `MultistepCommand` clears as the step ends.
 */
interface CornerTarget {
    readonly body: ParametricBodyNode;
    readonly feature: CornerFeatureData;
}

/** What pressing or pulling a corner face asks of the feature that built it. */
export interface CornerDrag {
    readonly feature: CornerFeatureData;
    /**
     * The size the drag asks that feature to take — a number, since a drag is a number and a size it
     * cannot be added to is not promised. Absent when the drag cannot be expressed as that feature's
     * size at all (see `cornerDragOf`).
     */
    readonly size?: number;
}

/**
 * `cos(theta / 2)` of the wedge a chamfer's flat cut off, from the two faces the flat REPLACED —
 * `sqrt((1 - n1.n2) / 2)` for their outward normals — or undefined when those two cannot be told
 * apart from the flat's other neighbours.
 *
 * They are the neighbours the flat is not perpendicular to. Across the flat's other edges sits
 * whatever closed the chamfer off (a block's top and bottom, the next round along), and the angle
 * between a chamfer's flat and the faces it replaced is `theta / 2` — never a right angle for a
 * chamfer anyone would draw. No answer is preferred to a wrong one: a flat that is not planar (a
 * chamfer along a curved edge is a cone, with no one plane to parallel), or anything but exactly
 * two such neighbours, leaves the drag unexpressed.
 */
function chamferHalfCosine(node: ParametricBodyNode, flat: IFace): number | undefined {
    if (!flat.surface().isPlanar()) return undefined;
    const body = node.shape.isOk ? node.shape.value : undefined;
    if (body === undefined) return undefined;

    const normal = flat.normal(0, 0)[1];
    const flatEdges = flat.findSubShapes(ShapeTypes.edge) as IEdge[];
    const shares = (face: IFace) =>
        (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((e) => flatEdges.some((f) => f.isSame(e)));
    const replaced = (body.findSubShapes(ShapeTypes.face) as IFace[]).filter(
        (face) => !face.isSame(flat) && Math.abs(face.normal(0, 0)[1].dot(normal)) > 1e-3 && shares(face),
    );
    if (replaced.length !== 2) return undefined;

    const [first, second] = replaced.map((face) => face.normal(0, 0)[1]);
    return Math.sqrt(Math.max(0, 1 - first.dot(second)) / 2);
}

/**
 * What dragging a corner face by `distance` means, or undefined when no corner feature built it.
 *
 * A round is a cylinder about its own axis, so moving its surface out by the drag IS that much
 * radius: `radius + distance`, both ways. A chamfer's flat comes out of the same reading applied
 * to the wedge it cuts: the flat's plane sits `distance * cos(theta / 2)` from the edge it cut off,
 * and moving that plane OUT by `t` is a chamfer `t / cos(theta / 2)` SMALLER — the body grows, the
 * cut shrinks. Measured, on a 90-degree box corner and on a 63-degree one: the flat moves exactly
 * `cos(theta / 2)` per unit of chamfer distance, to six decimals.
 *
 * The two ASYMMETRIC modes stay unpromised: there the flat's plane is fixed by both parameters at
 * once, and neither alone is the parallel offset a drag is. They keep `size` absent and the caller
 * asks the user, exactly as an unresolvable size does.
 *
 * `resolve` is how a stored size (which may be an expression) becomes a number to add the drag to.
 * A size that will not resolve is left unpromised too.
 */
export function cornerDragOf(
    picked: VisualShapeData,
    distance: number,
    resolve: (value: ParameterValue) => number | undefined,
): CornerDrag | undefined {
    const node = picked.owner.node;
    if (!(node instanceof ParametricBodyNode)) return undefined;
    // Reads no BUILT geometry: `cornerFeatureOf` answers undefined for a body that cannot name the
    // face, so a body whose chain failed simply finds no feature — and a decision function the
    // preview and the hand-off both call has no business building a shape to ask. The chamfer
    // branch reads the body's shape as it stands, which is not building one.
    const feature = cornerFeatureOf(node, picked.indexes[0]);
    if (feature === undefined) return undefined;
    if (feature.type === "fillet") {
        const radius = resolve(feature.radius);
        return radius === undefined ? { feature } : { feature, size: radius + distance };
    }
    if ((feature.mode ?? "equal") !== "equal") return { feature };

    const size = resolve(feature.distance);
    const halfCosine = size === undefined ? undefined : chamferHalfCosine(node, picked.shape as IFace);
    if (size === undefined || halfCosine === undefined || !(halfCosine > 1e-6)) return { feature };
    return { feature, size: size - distance / halfCosine };
}

/**
 * The chain as it would build with this corner feature's size replaced, in `transform`'s world
 * placement — the edit, without writing it. The local result is disposed; the returned shape is the
 * caller's to dispose.
 *
 * The kernel call is the one every other preview here makes: the same chain the feature would be
 * rebuilt from, so a preview equals the confirm.
 */
export function cornerRebuilt(
    body: ParametricBodyNode,
    feature: CornerFeatureData,
    size: ParameterValue,
    transform: Matrix4,
): IShape | undefined {
    const key = feature.type === "fillet" ? "radius" : "distance";
    const edited = body.features.map((candidate) =>
        candidate.id === feature.id
            ? (featureHandler(candidate.type)?.setParameter(candidate, key, size) ?? candidate)
            : candidate,
    );
    const shape = evaluateChainSnapshot(body, edited);
    if (!shape.isOk) return undefined;

    const world = shape.value.transformedMul(transform);
    shape.value.dispose();
    return world;
}

/**
 * Edits the size of a fillet/chamfer feature already in a body's list, by picking one of the
 * surfaces that feature built (Onshape's "Modify Fillet"). The FEATURE is what changes, not the
 * surface: the chain re-evaluates the way it does for any other parameter edit, so the features
 * after it follow, the change is one undo step, and the document keeps saying how the shape was
 * built rather than only what it looks like now.
 *
 * One step, like every other value-dragging pick here: the pick stays open while the arrow and the
 * value row edit the size, and the picker's own confirm ends it. Nothing is written until that
 * confirm, so the picked face keeps its index and id for the whole gesture and picking another
 * face instead is always possible.
 */
abstract class ModifyCornerFeatureCommand extends MultistepCommand implements PickSettledCommand {
    /** The corner kind this command edits; a pick of the other one is refused, not re-routed. */
    protected abstract readonly cornerType: "fillet" | "chamfer";

    /**
     * Set by the command that opens this one (Press Pull) when its own pick and confirm already
     * answered this command's, which also means it handed over the size to write — see
     * `seedValue`, which must not then put the feature's own size back on the row.
     */
    pickSettled = false;

    /** The parameter this writes — the same key the feature panel edits. */
    protected get sizeKey(): "radius" | "distance" {
        return this.cornerType === "fillet" ? "radius" : "distance";
    }

    protected abstract get value(): ParameterValue;
    protected abstract set value(value: ParameterValue);

    /** The size as the preview and the arrow need it; undefined when the expression will not resolve. */
    protected get valueNumber(): number | undefined {
        const resolved = this.resolveParameter(this.value, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    private target: CornerTarget | undefined;
    /** The target's size when it was picked — the arrow's anchor is measured from it. */
    private seed = 0;
    private activeHandler: ValueArrowPickHandler | undefined;
    private previewId: number | undefined;
    private previewOwner: INodeVisual | undefined;
    private active = true;

    /**
     * Rebuilding the whole chain is the expensive part of a drag, so it trails the pointer while
     * the arrow stays synchronous (see `refresh`). `debounce` has no cancel, which is what
     * `active` is for: a rebuild queued as the command ends must not display a mesh nobody owns.
     */
    private readonly rebuildPreview = debounce(() => this.showPreview(), 20);

    protected override async executeAsync(): Promise<void> {
        const selection = this.document.selection;
        selection.onShapeChanged.sub(this.onSelectionChanged);
        this.active = true;
        try {
            // The selection may already hold the answer: a settled hand-off puts the face in place
            // before this command runs, and its own step then confirms without touching the
            // selection, so nothing else would ever tell this command what it is editing.
            this.onSelectionChanged();
            await super.executeAsync();
        } finally {
            this.active = false;
            selection.onShapeChanged.remove(this.onSelectionChanged);
            this.removePreview();
        }
    }

    /** A new face may mean a new feature to edit, so the target is re-read before anything else. */
    private readonly onSelectionChanged = () => {
        const picked = this.document.selection.getSelectedShapes().at(0);
        const body = picked?.owner.node;
        if (picked === undefined || !(body instanceof ParametricBodyNode) || !body.shape.isOk) {
            // Deliberately leaves the target standing. Only corner faces are admitted to the pick,
            // so a selection that resolves to nothing is unreachable — while an EMPTY one happens
            // at the end of every pick: `MultistepCommand.executeSteps` clears the selection
            // before `executeMainTask` runs, and the confirm would otherwise have nothing to write
            // to. The arrow reads the selection itself, so it bows out on its own either way.
            this.refresh();
            return;
        }

        const feature = cornerFeatureOf(body, picked.indexes[0]);
        if (feature === undefined) {
            this.target = undefined;
            this.refresh();
            return;
        }
        if (feature.type !== this.cornerType) {
            this.target = undefined;
            PubSub.default.pub("showToast", "toast.modifyCorner.wrongKind:{0}", this.featureName(feature));
            this.refresh();
            return;
        }
        // Re-seeding only on a NEW target is what preserves a size the user just dragged or typed:
        // picking a second face of the same feature must not undo their edit.
        if (feature.id !== this.target?.feature.id) {
            this.target = { body, feature };
            this.seedValue(feature);
        }
        this.refresh();
    };

    /** The localized name of the corner kind a feature belongs to, for the refusal's wording. */
    private featureName(feature: CornerFeatureData): string {
        const display = featureHandler(feature.type)?.display;
        return typeof display === "string" ? I18n.translate(display) : feature.type;
    }

    /** The size this command edits, read off whichever corner kind the feature is. */
    private sizeOf(feature: CornerFeatureData): ParameterValue {
        return feature.type === "fillet" ? feature.radius : feature.distance;
    }

    /** The feature's own value, expression and all — the row shows what the feature holds. */
    private seedValue(feature: CornerFeatureData): void {
        const size = this.sizeOf(feature);
        const resolved = this.resolveParameter(size, LENGTH_UNITS);
        this.seed = resolved.isOk ? resolved.value : 0;
        // A settled hand-off already decided the size (Press Pull's drag, translated into this
        // feature's terms), and that is what the confirm writes — the feature's own size must not
        // overwrite it. The seed above still comes from the feature: it is where the arrow's foot
        // is measured from.
        if (!this.pickSettled) this.value = size;
    }

    private readonly setValueFromArrow = (value: number) => {
        this.value = value;
    };

    /** The arrow and the preview both follow the current target and size. */
    protected refresh(): void {
        this.activeHandler?.refreshArrow();
        this.rebuildPreview();
    }

    /**
     * Where the arrow stands and which size it drags: on the picked face, pointing out of the
     * material along the normal AT THE PICK, offset back by the size the feature had — so the
     * arrow's foot sits on the round's surface and travels with the size as it changes, which is
     * what makes the drag read as "this is how big the round is".
     */
    private readonly arrowData = (): ValueArrowData | undefined => {
        const value = this.valueNumber;
        const picked = this.document.selection.getSelectedShapes().at(0);
        if (value === undefined || picked === undefined) return undefined;

        const point = this.pickPoint(picked);
        if (point === undefined) return undefined;
        const direction = this.outwardDirection(picked, point);
        if (direction === undefined) return undefined;
        return { anchor: point.sub(direction.multiply(this.seed)), direction, value: Math.max(value, 0) };
    };

    /** The picked face's outward normal where the pointer landed, in world coordinates. */
    private outwardDirection(picked: VisualShapeData, point: XYZ): XYZ | undefined {
        const world = (picked.shape as unknown as IFace).transformedMul(picked.transform) as IFace;
        try {
            return outwardNormalAt(world, point);
        } finally {
            world.dispose();
        }
    }

    /** The world point the face was picked at, falling back to its middle when a pick carries none. */
    private pickPoint(picked: VisualShapeData): XYZ | undefined {
        if (picked.point !== undefined) return picked.point;
        const face = picked.shape as unknown as IFace;
        try {
            return picked.transform.ofPoint(BoundingBox.center(face.boundingBox()));
        } catch {
            // A degenerate face has no middle to anchor on; no arrow beats an arrow in the wrong place.
            return undefined;
        }
    }

    /**
     * Only the surfaces a corner built may be picked, so the pointer never highlights — and never
     * lets the user click — something this command cannot act on. The body is checked here rather
     * than by an `IShapeFilter` because this is the only detection hook that sees WHICH body a
     * detected sub-shape came from, and the id has to be looked up on that body.
     */
    private readonly admitDetected = (detected: VisualShapeData[]): VisualShapeData[] => {
        // `body.features` re-parses the stored JSON, so it is read once per body per move.
        const readFeatures = new Map<ParametricBodyNode, readonly FeatureData[]>();
        const admitted: VisualShapeData[] = [];
        for (const picked of detected) {
            const node = picked.owner.node;
            if (!(node instanceof ParametricBodyNode)) continue;
            // The pick never spans two bodies — a feature's size belongs to one — so once a face
            // has answered, the rest of the gesture stays on its body.
            const locked = this.target?.body;
            if (locked !== undefined && node !== locked) continue;
            const features = readFeatures.get(node) ?? node.features;
            readFeatures.set(node, features);
            if (cornerFeatureOf(node, picked.indexes[0], features) !== undefined) admitted.push(picked);
        }
        return admitted;
    };

    protected override getSteps(): IStep[] {
        return [
            new ValueArrowSelectStep(
                {
                    shapeType: ShapeTypes.face,
                    // One target at a time: the arrow follows the face just clicked, and clicking
                    // another one retargets instead of accumulating.
                    replaceSelection: true,
                    // The pick does not END on a preselected face unless the hand-off that opened
                    // this command already made it and confirmed it: the size is what is being
                    // decided, and the pick is where it is dragged and confirmed.
                    preselectionAnswers: this.pickSettled,
                    admitDetected: this.admitDetected,
                    highlightState: VisualStates.faceHighlight,
                    selectedState: SELECTED_FACE_STATE,
                },
                { allow: (node: INode) => node instanceof ParametricBodyNode },
                { arrowData: this.arrowData, setValue: this.setValueFromArrow },
                (handler) => (this.activeHandler = handler),
                "prompt.select.cornerFaces",
            ),
        ];
    }

    protected override executeMainTask(): void {
        const target = this.target;
        if (target === undefined) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        // The same refusal the extrude and fillet commits make: the feature keeps the expression
        // the user typed, and one that no longer resolves would fail the next rebuild and take
        // every feature after it down the chain with it.
        const resolved = this.resolveParameter(this.value, LENGTH_UNITS);
        if (!resolved.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", resolved.error);
            return;
        }
        // A feature can be deleted from the panel while the pick is open — the panel is not modal
        // — and then there is nothing left to write to.
        if (!target.body.features.some((feature) => feature.id === target.feature.id)) {
            PubSub.default.pub("showToast", "toast.modifyCorner.noTarget");
            return;
        }

        // Labelled by the key the command is registered under, the way the other feature commands
        // label their writes — the name a reader of the history sees is the one the ribbon shows.
        const label = CommandStore.getComandData(this)?.key ?? this.cornerType;
        Transaction.execute(this.document, `excute ${label}`, () => {
            target.body.setFeatureParameter(target.feature.id, this.sizeKey, this.value);
            // Keep the body selected, the way a re-pick does: the feature panel stays open on the
            // row that just changed, rather than closing back to the document.
            this.document.selection.setSelectedNodes([target.body], false);
            this.document.visual.update();
        });
    }

    private showPreview(): void {
        if (!this.active) return;
        this.removePreview();
        const target = this.target;
        const size = this.valueNumber;
        // A size of zero is not a small round, it is a shape the kernel refuses; showing nothing
        // is the honest preview of it.
        if (target === undefined || size === undefined || size <= 0) return;

        const shape = cornerRebuilt(target.body, target.feature, this.value, target.body.worldTransform());
        if (shape === undefined) return;
        const owner = this.document.visual.context.getVisual(target.body) as INodeVisual | undefined;
        const previewId = this.displayWorldMesh(shape);
        if (previewId === undefined) return;

        // The body is GHOSTED, not hidden: a hidden node cannot be picked, and picking another
        // face instead is the whole point of leaving the gesture open.
        if (owner !== undefined) {
            this.previewOwner = owner;
            this.document.visual.highlighter.addState(owner, VisualStates.faceTransparent, ShapeTypes.shape);
        }
        this.previewId = previewId;
        this.document.visual.update();
    }

    /**
     * Displays `shape` — a chain result in world space — as one temporary mesh, and returns its id.
     * The shape is disposed either way: it does not outlive the call, the mesh data having been
     * handed to the viewport first (the same discipline the re-pick previews keep).
     */
    private displayWorldMesh(shape: IShape): number | undefined {
        try {
            const { faces, edges } = shape.mesh;
            const datas = [faces, edges].filter((x) => x !== undefined);
            return datas.length > 0
                ? this.document.visual.context.displayMesh(datas, { meshOpacity: 1 })
                : undefined;
        } finally {
            shape.dispose();
        }
    }

    private removePreview(): void {
        if (this.previewOwner !== undefined) {
            this.document.visual.highlighter.removeState(
                this.previewOwner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
            this.previewOwner = undefined;
        }
        if (this.previewId !== undefined) {
            this.document.visual.context.removeMesh(this.previewId);
            this.previewId = undefined;
        }
    }
}

/** The size of an existing fillet, picked by clicking one of the rounds it built. */
@command({ key: "feature.modifyFillet", icon: "icon-fillet" })
export class ModifyFilletFeatureCommand extends ModifyCornerFeatureCommand {
    protected readonly cornerType = "fillet" as const;

    @property("circle.radius", { unit: LENGTH_UNITS })
    get value(): ParameterValue {
        return this.getPrivateValue("value", 2);
    }
    set value(value: ParameterValue) {
        this.setProperty("value", value, () => this.refresh());
    }
}

/** The size of an existing chamfer, picked by clicking one of its faces. */
@command({ key: "feature.modifyChamfer", icon: "icon-chamfer" })
export class ModifyChamferFeatureCommand extends ModifyCornerFeatureCommand {
    protected readonly cornerType = "chamfer" as const;

    @property("common.length", { unit: LENGTH_UNITS })
    get value(): ParameterValue {
        return this.getPrivateValue("value", 1);
    }
    set value(value: ParameterValue) {
        this.setProperty("value", value, () => this.refresh());
    }
}
