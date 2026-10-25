// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CurveUtils,
    EditableShapeNode,
    I18n,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeFilter,
    type ISubEdgeShape,
    MultistepCommand,
    PreviewVisual,
    PubSub,
    Result,
    retargetInstanceSources,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type ValueArrowData,
    type ValueArrowPickHandler,
    ValueArrowSelectStep,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";

const SOLID_PARENT_TYPES: ShapeType[] = [ShapeTypes.solid, ShapeTypes.compound, ShapeTypes.compoundSolid];
const PLANAR_PARENT_TYPES: ShapeType[] = [ShapeTypes.face, ShapeTypes.wire, ShapeTypes.edge];
const SUPPORTED_PARENT_TYPES: ShapeType[] = [...SOLID_PARENT_TYPES, ...PLANAR_PARENT_TYPES];

/**
 * Whether the parent body holds planar geometry. A compound is classified by
 * its content: containing a solid makes it 3D, otherwise (faces, wires or
 * edges inside) it is treated as 2D.
 */
function isPlanarParent(parent: IShape): boolean {
    if (PLANAR_PARENT_TYPES.includes(parent.shapeType)) return true;
    return parent.shapeType === ShapeTypes.compound && parent.findSubShapes(ShapeTypes.solid).length === 0;
}

/**
 * The face an edge belongs to: the parent itself when it is a face, or the
 * containing face inside a compound; undefined for wire/edge parents.
 */
function faceContaining(parent: IShape, sub: ISubEdgeShape): IFace | undefined {
    if (parent.shapeType === ShapeTypes.face) return parent as IFace;
    if (parent.shapeType !== ShapeTypes.compound) return undefined;

    const faces = parent.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.find((face) => (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((e) => e.isEqual(sub)));
}

/** Two adjacent sub-edges of a wire, ordered along the wire flow. */
export interface OrderedCorner {
    edge1: IEdge;
    edge2: IEdge;
    index1: number;
    index2: number;
}

/** Order the two sub-edges along the wire flow (handles the closed-wire wrap). */
export function orderCornerEdges(
    allEdges: IEdge[],
    sub1: ISubEdgeShape,
    sub2: ISubEdgeShape,
): OrderedCorner | undefined {
    const n = allEdges.length;
    let index1 = allEdges.findIndex((x) => x.isEqual(sub1));
    let index2 = allEdges.findIndex((x) => x.isEqual(sub2));
    if (index1 < 0 || index2 < 0) return undefined;

    let [edge1, edge2] = [sub1, sub2] as IEdge[];
    if ((index1 + 1) % n !== index2) {
        [edge1, edge2] = [edge2, edge1];
        [index1, index2] = [index2, index1];
    }
    return { edge1, edge2, index1, index2 };
}

/**
 * Replace a shape node by an EditableShapeNode holding the new shape, keeping
 * the name, material, transform and position in the node tree. When the node
 * already is an EditableShapeNode only its shape is swapped.
 */
export function replaceShapeNode(node: ShapeNode, shape: IShape) {
    if (node instanceof EditableShapeNode) {
        node.shape = Result.ok(shape);
    } else {
        const model = new EditableShapeNode({
            document: node.document,
            name: node.name,
            shape,
            materialId: node.materialId,
        });
        model.transform = node.transform;

        (node.parent ?? node.document.modelManager.rootNode).add(model);
        // The source id changes here; keep its instances pointing at the definition.
        retargetInstanceSources(node.document, node.id, model.id);
        node.parent?.remove(node);
    }

    node.document.visual.update();
}

/** Splice the corner triple into the wire edges in place of the two old edges. */
function spliceCornerEdges(allEdges: IEdge[], corner: OrderedCorner, triple: IEdge[]): IEdge[] {
    const [trimmed1, cornerEdge, trimmed2] = triple;
    const { index1, index2 } = corner;
    if (index1 === allEdges.length - 1) {
        // closed-wire wrap: the corner spans the last and the first edge
        return [trimmed2, ...allEdges.slice(1, -1), trimmed1, cornerEdge];
    }
    return [...allEdges.slice(0, index1), trimmed1, cornerEdge, trimmed2, ...allEdges.slice(index2 + 1)];
}

/**
 * Base class for the chamfer and fillet commands. Both reshape the corner of
 * the selected edges - on a solid or a compound of solids (3D), on a face or
 * a compound of faces (2D), on a wire, or between two standalone edge
 * bodies - and differ only in the actual shape operation, provided by the
 * `applyTo*` methods.
 */
export abstract class EdgeCornerCommand extends MultistepCommand {
    /** Apply the operation to the selected edges of a solid or compound. */
    protected abstract applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape>;

    /** Apply the operation to the corner between two edges of a face. */
    protected abstract applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape>;

    /** Trim two adjacent edges and return [trimmed1, cornerEdge, trimmed2]. */
    protected abstract applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]>;

    /** The radius/length the corner is built with, as the preview and the arrow see it. */
    protected abstract get cornerValue(): number;
    protected abstract set cornerValue(value: number);

    private readonly preview = new PreviewVisual();
    private activeHandler: ValueArrowPickHandler | undefined;
    /** Only a running command has an application to preview into. */
    private previewActive = false;

    /**
     * Live preview of the corner on the picked body: the same kernel call the commit makes,
     * so what is shown is what will be built. The body is ghosted (faceTransparent) while the
     * preview is up — a rounded/chamfered surface is recessed into the solid and an opaque
     * original would hide it. A value or edge set the kernel refuses simply shows nothing.
     */
    private readonly updatePreview = () => {
        this.activeHandler?.refreshArrow();
        const picked = this.pickedBodyEdges();
        if (picked === undefined) return;
        const value = this.cornerValue;
        if (!Number.isFinite(value) || value <= 0) return;

        const node = picked.edges[0].owner.node as ShapeNode;
        if (!node.shape.isOk) return;
        const indexes = picked.edges.map((x) => (x.shape as ISubEdgeShape).index);
        const result = this.applyToBody(node.shape.value, indexes);
        if (!result.isOk) return;

        const world = result.value.transformedMul(picked.edges[0].transform);
        result.value.dispose();
        const { faces, edges } = world.mesh;
        world.dispose();
        if (faces === undefined) return;

        this.preview.show(
            this.document,
            [faces, edges].filter((x) => x !== undefined),
            { ghost: [picked.edges[0].owner], opacity: 1 },
        );
    };

    /** The selected edges of one 3D body (a planar parent is a 2D corner, which has no arrow). */
    private pickedBodyEdges(): { edges: VisualShapeData[] } | undefined {
        const selected = this.document.selection.getSelectedShapes();
        const firstParent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (firstParent === undefined || isPlanarParent(firstParent)) return undefined;

        const node = selected[0].owner.node;
        const edges = selected.filter(
            (x) =>
                x.shape.shapeType === ShapeTypes.edge &&
                x.owner.node === node &&
                ((x.shape as ISubEdgeShape).parent?.isPartner(firstParent) ?? false),
        );
        return edges.length === 0 ? undefined : { edges };
    }

    private removePreview() {
        this.preview.hide(this.document);
    }

    /** Subclasses call this when their value changes so the preview and arrow follow it. */
    protected refreshCornerPreview() {
        if (!this.previewActive) return;
        this.updatePreview();
    }

    /**
     * Arrow placement for the value drag: anchored at the first picked edge's midpoint,
     * pointing out of the body — radially for circular edges, otherwise along the
     * edge-midpoint-to-body-center direction projected perpendicular to the tangent.
     */
    private readonly arrowData = (): ValueArrowData | undefined => {
        const value = this.cornerValue;
        const picked = this.pickedBodyEdges();
        if (!Number.isFinite(value) || picked === undefined) return undefined;

        const world = (picked.edges[0].shape as IEdge).transformedMul(picked.edges[0].transform) as IEdge;
        try {
            const midParam = (world.firstParameter() + world.lastParameter()) / 2;
            const direction = this.arrowDirection(world, midParam, picked.edges[0]);
            if (direction === undefined) return undefined;
            return { anchor: world.pointAt(midParam), direction, value: Math.max(value, 0) };
        } finally {
            world.dispose();
        }
    };

    private arrowDirection(edge: IEdge, midParam: number, data: VisualShapeData): XYZ | undefined {
        const basis = edge.curve.basisCurve;
        if (CurveUtils.isCircle(basis)) {
            return edge.pointAt(midParam).sub(basis.center).normalize();
        }

        const tangent = edge.curve.d1(midParam).vec.normalize();
        const node = data.owner.node as ShapeNode;
        if (tangent === undefined || !node.shape.isOk) return undefined;

        const center = data.transform.ofPoint(BoundingBox.center(node.shape.value.boundingBox()));
        const outward = edge.pointAt(midParam).sub(center);
        const perpendicular = outward.sub(tangent.multiply(outward.dot(tangent))).normalize();
        if (perpendicular !== undefined) return perpendicular;

        // Degenerate (the midpoint-to-center line runs along the edge): any perpendicular.
        const side = Math.abs(tangent.dot(XYZ.unitZ)) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        return tangent.cross(side).normalize();
    }

    private readonly setValueFromArrow = (value: number) => {
        this.cornerValue = value;
    };

    protected override async executeAsync(): Promise<void> {
        this.previewActive = true;
        this.document.selection.onShapeChanged.sub(this.updatePreview);
        try {
            await super.executeAsync();
        } finally {
            this.document.selection.onShapeChanged.remove(this.updatePreview);
            this.removePreview();
            this.previewActive = false;
        }
    }

    protected override executeMainTask() {
        const value = this.cornerValue;
        if (!Number.isFinite(value) || value <= 0) {
            PubSub.default.pub("showToast", "error.input.invalidNumber");
            return;
        }

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shapes = this.stepDatas[0].shapes;
            const parent = (shapes[0].shape as ISubEdgeShape).parent;

            if (parent.shapeType === ShapeTypes.edge) {
                this.modifyStandaloneEdges(shapes);
                return;
            }

            this.modifyNode(shapes, parent);
        });
    }

    private modifyNode(shapes: VisualShapeData[], parent: IShape) {
        const node = shapes[0].owner.node as ShapeNode;
        const newShape = this.computeNewShape(shapes, parent, node);
        if (!newShape.isOk) {
            PubSub.default.pub("displayError", newShape.error);
            return;
        }

        replaceShapeNode(node, newShape.value);
    }

    private computeNewShape(shapes: VisualShapeData[], parent: IShape, node: ShapeNode): Result<IShape> {
        if (isPlanarParent(parent)) {
            return this.computePlanarShape(shapes, parent);
        }

        const edgeIndexes = shapes.map((x) => (x.shape as ISubEdgeShape).index);
        return this.applyToBody(node.shape.value, edgeIndexes);
    }

    private computePlanarShape(shapes: VisualShapeData[], parent: IShape): Result<IShape> {
        if (shapes.length !== 2) {
            return Result.err(I18n.translate("error.select.twoEdges"));
        }

        const face = faceContaining(parent, shapes[0].shape as ISubEdgeShape);
        return face !== undefined
            ? this.applyToFace(face, shapes[0].shape as IEdge, shapes[1].shape as IEdge)
            : this.modifyWireCorner(
                  parent,
                  shapes[0].shape as ISubEdgeShape,
                  shapes[1].shape as ISubEdgeShape,
              );
    }

    /** Modify the corner between two adjacent edges of a wire and rebuild the wire. */
    private modifyWireCorner(wire: IShape, sub1: ISubEdgeShape, sub2: ISubEdgeShape): Result<IShape> {
        const allEdges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        const corner = orderCornerEdges(allEdges, sub1, sub2);
        if (corner === undefined) return Result.err("Edges must belong to the wire.");

        const triple = this.applyToEdgePair(corner.edge1, corner.edge2);
        if (!triple.isOk) return triple.parse();

        return shapeFactory.wire(spliceCornerEdges(allEdges, corner, triple.value));
    }

    /** Apply the corner between two standalone edge bodies, keeping them as separate edges. */
    private modifyStandaloneEdges(shapes: VisualShapeData[]) {
        if (shapes.length !== 2) {
            PubSub.default.pub("displayError", I18n.translate("error.select.twoEdges"));
            return;
        }

        const [edge1, edge2] = shapes.map((x) => {
            const edge = x.shape.transformedMul(x.transform) as IEdge;
            this.disposeStack.add(edge);
            return edge;
        });

        const triple = this.applyToEdgePair(edge1, edge2);
        if (!triple.isOk) {
            PubSub.default.pub("displayError", triple.error);
            return;
        }

        this.replaceStandaloneNodes(shapes, triple.value);
    }

    /**
     * Replace the two standalone edge nodes by their trimmed versions and add
     * the corner edge as a third standalone edge. The triple's geometry is in
     * world space (the transforms were baked in), so no transform is copied.
     */
    private replaceStandaloneNodes(shapes: VisualShapeData[], triple: IEdge[]) {
        const [trimmed1, cornerEdge, trimmed2] = triple;
        const node1 = shapes[0].owner.node as ShapeNode;
        const node2 = shapes[1].owner.node as ShapeNode;
        const container1 = node1.parent ?? this.document.modelManager.rootNode;
        const container2 = node2.parent ?? this.document.modelManager.rootNode;

        const replacement1 = this.standaloneEdgeNode(node1, trimmed1);
        const replacement2 = this.standaloneEdgeNode(node2, trimmed2);
        container1.add(replacement1);
        container2.add(replacement2);
        container1.add(this.standaloneEdgeNode(node1, cornerEdge, `${node1.name}_1`));
        // Each old edge node is replaced one-for-one; instances follow the same edge.
        retargetInstanceSources(this.document, node1.id, replacement1.id);
        if (node2 !== node1) retargetInstanceSources(this.document, node2.id, replacement2.id);
        node1.parent?.remove(node1);
        node2.parent?.remove(node2);
        this.document.visual.update();
    }

    private standaloneEdgeNode(source: ShapeNode, shape: IEdge, name?: string) {
        return new EditableShapeNode({
            document: this.document,
            name: name ?? source.name,
            shape,
            materialId: source.materialId,
        });
    }

    /**
     * The first selected edge determines the main shape; subsequent edges can
     * only be picked on the same shape (same TShape as the first edge's parent).
     * A standalone edge body can only be paired with another standalone edge.
     * 2D operations (face, wire, standalone edges) apply to exactly two edges.
     */
    private readonly _edgeFilter: IShapeFilter = {
        allow: (shape) => this.canPickEdge(shape as ISubEdgeShape),
    };

    private canPickEdge(shape: ISubEdgeShape): boolean {
        const parent = shape.parent;
        if (parent === undefined || !SUPPORTED_PARENT_TYPES.includes(parent.shapeType)) return false;

        const selected = this.document.selection.getSelectedShapes();
        const firstParent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (firstParent === undefined) return true;
        if (!this.isSameMainShape(parent, firstParent)) return false;

        const is3d = !isPlanarParent(firstParent);
        if (!is3d && selected.length >= 2) {
            // allow re-picking an already selected edge so it can be toggled off
            return selected.some((x) => x.shape.isEqual(shape));
        }
        return true;
    }

    /** A standalone edge only pairs with standalone edges; body edges must share the first edge's body. */
    private isSameMainShape(parent: IShape, firstParent: IShape): boolean {
        if (firstParent.shapeType === ShapeTypes.edge) {
            return parent.shapeType === ShapeTypes.edge;
        }
        return parent.shapeType !== ShapeTypes.edge && parent.isPartner(firstParent);
    }

    protected override getSteps() {
        return [
            new ValueArrowSelectStep(
                {
                    shapeType: ShapeTypes.edge,
                    shapeFilter: this._edgeFilter,
                    canFinish: this._canFinish,
                    // A preselection seeds the pick — the edges are kept and the arrow is
                    // available — but it does not answer it: the value is still the command's
                    // default, and Onshape opens the fillet for confirmation rather than
                    // committing a radius the user never saw.
                    preselectionAnswers: false,
                },
                { arrowData: this.arrowData, setValue: this.setValueFromArrow },
                (handler) => (this.activeHandler = handler),
                "prompt.select.edges",
            ),
        ];
    }

    /** A 2D operation needs exactly two edges - finish the pick once both are selected. */
    private readonly _canFinish = (selected: VisualShapeData[]) => {
        const parent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (parent === undefined) return false;
        return isPlanarParent(parent) && selected.length === 2;
    };
}
