// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type EdgeMeshData,
    type I18nKeys,
    type IDocument,
    type IShape,
    type IShapeMeshData,
    type ISubShape,
    Material,
    Matrix4,
    NodeSelectionHandler,
    type Orientation,
    type OrientedBoundingBox,
    ParameterShapeNode,
    type Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { ThreeVisual } from "../src/threeVisual";
import { TestView } from "./testView";

/**
 * A single-triangle face used as the sub shape of {@link TestPanel}.
 * Only the members exercised by the detect* code paths are implemented.
 */
class TestPanelFace implements ISubShape {
    readonly shapeType = ShapeTypes.face;
    readonly index = 0;
    matrix: Matrix4 = Matrix4.identity();
    volume(): number {
        return 0;
    }

    constructor(
        readonly id: string,
        readonly parent: IShape,
        readonly points: [XYZLike, XYZLike, XYZLike],
    ) {}

    boundingBox(): BoundingBox {
        const xs = this.points.map((p) => p.x);
        const ys = this.points.map((p) => p.y);
        const zs = this.points.map((p) => p.z);
        return new BoundingBox(
            { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
            { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        );
    }

    isEqual(other: IShape): boolean {
        return other === this;
    }
    isSame(other: IShape): boolean {
        return other === this;
    }
    isPartner(other: IShape): boolean {
        return other === this;
    }
    orientation(): Orientation {
        return "forward";
    }
    dispose(): void {}

    transformed(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    transformedMul(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    edgesMeshPosition(): EdgeMeshData {
        throw new Error("Method not implemented.");
    }
    isClosed(): boolean {
        throw new Error("Method not implemented.");
    }
    isNull(): boolean {
        throw new Error("Method not implemented.");
    }
    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        throw new Error("Method not implemented.");
    }
    findSubShapes(subshapeType: ShapeType): IShape[] {
        throw new Error("Method not implemented.");
    }
    directSubShapes(): IShape[] {
        throw new Error("Method not implemented.");
    }
    section(shape: IShape | Plane): IShape {
        throw new Error("Method not implemented.");
    }
    split(shapes: IShape[], tolerance?: number): IShape {
        throw new Error("Method not implemented.");
    }
    reserve(): void {
        throw new Error("Method not implemented.");
    }
    clone(): IShape {
        throw new Error("Method not implemented.");
    }
    hlr(position: XYZLike, direction: XYZLike, xDir: XYZLike): IShape {
        throw new Error("Method not implemented.");
    }
    orientedBoundingBox(): OrientedBoundingBox {
        throw new Error("Method not implemented.");
    }
    extremaDistance(other: IShape): number {
        throw new Error("Method not implemented.");
    }
    checkShape(): boolean {
        throw new Error("Method not implemented.");
    }
    checkFaces(): { index: number; isValid: boolean; status: string[] }[] {
        throw new Error("Method not implemented.");
    }
    fixShape(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    fixSmallFace(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    fixSolid(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    shellSewing(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    setTolerance(tolerance: number): void {
        throw new Error("Method not implemented.");
    }
    get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }
}

/**
 * A solid-like root shape whose face mesh is a single triangle, so each
 * raycast produces exactly one intersection per node.
 */
class TestPanel implements IShape {
    readonly shapeType = ShapeTypes.solid;
    readonly face: TestPanelFace;
    matrix: Matrix4 = Matrix4.identity();
    volume(): number {
        return 0;
    }

    constructor(
        readonly id: string,
        readonly points: [XYZLike, XYZLike, XYZLike],
    ) {
        this.face = new TestPanelFace(`${id}-face`, this, points);
    }

    get mesh(): IShapeMeshData {
        const [a, b, c] = this.points;
        return {
            edges: undefined,
            vertexs: undefined,
            faces: {
                position: new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0.5, 1]),
                index: new Uint32Array([0, 1, 2]),
                groups: [],
                range: [{ start: 0, count: 3, shape: this.face }],
                color: 0x00ff00,
            },
        };
    }

    boundingBox(): BoundingBox {
        return this.face.boundingBox();
    }

    isEqual(other: IShape): boolean {
        return other === this;
    }
    isSame(other: IShape): boolean {
        return other === this;
    }
    isPartner(other: IShape): boolean {
        return other === this;
    }
    orientation(): Orientation {
        return "forward";
    }
    dispose(): void {}

    transformed(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    transformedMul(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    edgesMeshPosition(): EdgeMeshData {
        throw new Error("Method not implemented.");
    }
    isClosed(): boolean {
        throw new Error("Method not implemented.");
    }
    isNull(): boolean {
        throw new Error("Method not implemented.");
    }
    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        throw new Error("Method not implemented.");
    }
    findSubShapes(subshapeType: ShapeType): IShape[] {
        throw new Error("Method not implemented.");
    }
    directSubShapes(): IShape[] {
        throw new Error("Method not implemented.");
    }
    section(shape: IShape | Plane): IShape {
        throw new Error("Method not implemented.");
    }
    split(shapes: IShape[], tolerance?: number): IShape {
        throw new Error("Method not implemented.");
    }
    reserve(): void {
        throw new Error("Method not implemented.");
    }
    clone(): IShape {
        throw new Error("Method not implemented.");
    }
    hlr(position: XYZLike, direction: XYZLike, xDir: XYZLike): IShape {
        throw new Error("Method not implemented.");
    }
    orientedBoundingBox(): OrientedBoundingBox {
        throw new Error("Method not implemented.");
    }
    extremaDistance(other: IShape): number {
        throw new Error("Method not implemented.");
    }
    checkShape(): boolean {
        throw new Error("Method not implemented.");
    }
    checkFaces(): { index: number; isValid: boolean; status: string[] }[] {
        throw new Error("Method not implemented.");
    }
    fixShape(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    fixSmallFace(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    fixSolid(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    shellSewing(tolerance: number): IShape {
        throw new Error("Method not implemented.");
    }
    setTolerance(tolerance: number): void {
        throw new Error("Method not implemented.");
    }
}

class TestPanelNode extends ParameterShapeNode {
    constructor(
        document: IDocument,
        readonly panelId: string,
        readonly points: [XYZLike, XYZLike, XYZLike],
    ) {
        super({ document });
    }

    override display(): I18nKeys {
        return "body.editableShape";
    }

    generateShape(): Result<IShape> {
        return Result.ok(new TestPanel(this.panelId, this.points));
    }

    get panel(): TestPanel {
        return this.shape.value as TestPanel;
    }
}

const NEAR_POINTS: [XYZLike, XYZLike, XYZLike] = [
    { x: -8, y: -6, z: 10 },
    { x: 8, y: -6, z: 10 },
    { x: 0, y: 9, z: 10 },
];
const FAR_POINTS: [XYZLike, XYZLike, XYZLike] = [
    { x: -8, y: -6, z: -10 },
    { x: 8, y: -6, z: -10 },
    { x: 0, y: 9, z: -10 },
];
const SIDE_POINTS: [XYZLike, XYZLike, XYZLike] = [
    { x: 22, y: -6, z: 0 },
    { x: 38, y: -6, z: 0 },
    { x: 30, y: 9, z: 0 },
];

function createSceneWithPanels() {
    const doc = new TestDocument();
    const visual = new ThreeVisual(doc, new NodeSelectionHandler(doc, true));
    doc.visual = visual;
    doc.modelManager.materials.push(new Material({ document: doc, name: "test", color: 0x00ff00 }));
    const view = new TestView(doc, visual.context);
    // The camera matrices are stale until the first render/update; sync them so
    // worldToScreen, raycasting and SelectionBox all use the same camera pose.
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);
    visual.context.scene.updateMatrixWorld(true);

    const near = new TestPanelNode(doc, "near", NEAR_POINTS);
    const far = new TestPanelNode(doc, "far", FAR_POINTS);
    const side = new TestPanelNode(doc, "side", SIDE_POINTS);
    visual.context.addNode([near, far, side]);

    const center = view.worldToScreen(XYZ.zero);
    const sideCenter = view.worldToScreen(new XYZ({ x: 30, y: 1.5, z: 0 }));
    const empty = view.worldToScreen(new XYZ({ x: -40, y: 40, z: 0 }));

    return { doc, visual, view, near, far, side, center, sideCenter, empty };
}

describe("ThreeView detect — positive hits with real geometry", () => {
    test("detectShapes hits the nearest panel and returns its shape identity", () => {
        const { view, near, center } = createSceneWithPanels();

        const shapes = view.detectShapes(ShapeTypes.shape, center.x, center.y);

        expect(shapes.length).toBe(1);
        expect(shapes[0].shape).toBe(near.panel);
        expect(shapes[0].point?.z).toBeCloseTo(10, 5);
    });

    test("detectShapes returns sub faces of all hit panels ordered near-to-far", () => {
        const { view, near, far, center } = createSceneWithPanels();

        const subs = view.detectShapes(ShapeTypes.face, center.x, center.y);

        expect(subs.length).toBe(2);
        expect(subs[0].shape).toBe(near.panel.face);
        expect(subs[1].shape).toBe(far.panel.face);
        expect(subs[0].point!.z).toBeGreaterThan(subs[1].point!.z);
    });

    test("detectShapes returns empty when the ray hits nothing", () => {
        const { view, empty } = createSceneWithPanels();

        expect(view.detectShapes(ShapeTypes.shape, empty.x, empty.y).length).toBe(0);
        expect(view.detectShapes(ShapeTypes.face, empty.x, empty.y).length).toBe(0);
    });

    test("detectShapes hits the side panel at its own screen position", () => {
        const { view, side, sideCenter } = createSceneWithPanels();

        const shapes = view.detectShapes(ShapeTypes.shape, sideCenter.x, sideCenter.y);

        expect(shapes.length).toBe(1);
        expect(shapes[0].shape).toBe(side.panel);
    });
});

describe("ThreeView detect — shapeFilter and nodeFilter actually apply", () => {
    test("shapeFilter excludes the rejected shape on the sub-shape path", () => {
        const { view, near, far, center } = createSceneWithPanels();

        const filtered = view.detectShapes(ShapeTypes.face, center.x, center.y, {
            allow: (shape) => shape !== near.panel.face,
        });
        expect(filtered.length).toBe(1);
        expect(filtered[0].shape).toBe(far.panel.face);

        const allowed = view.detectShapes(ShapeTypes.face, center.x, center.y, { allow: () => true });
        expect(allowed.length).toBe(2);

        const denied = view.detectShapes(ShapeTypes.face, center.x, center.y, { allow: () => false });
        expect(denied.length).toBe(0);
    });

    test("shapeFilter skips the nearest panel on the whole-shape path", () => {
        const { view, near, far, center } = createSceneWithPanels();

        const shapes = view.detectShapes(ShapeTypes.shape, center.x, center.y, {
            allow: (shape) => shape !== near.panel,
        });

        expect(shapes.length).toBe(1);
        expect(shapes[0].shape).toBe(far.panel);
    });

    test("nodeFilter excludes the rejected node on whole-shape and sub-shape paths", () => {
        const { view, near, far, center } = createSceneWithPanels();
        const nodeFilter = { allow: (node: unknown) => node !== near };

        const shapes = view.detectShapes(ShapeTypes.shape, center.x, center.y, undefined, nodeFilter);
        expect(shapes.length).toBe(1);
        expect(shapes[0].shape).toBe(far.panel);

        const subs = view.detectShapes(ShapeTypes.face, center.x, center.y, undefined, nodeFilter);
        expect(subs.length).toBe(1);
        expect(subs[0].shape).toBe(far.panel.face);
    });

    test("detectVisual applies nodeFilter", () => {
        const { view, visual, near, far, center } = createSceneWithPanels();

        const all = view.detectVisual(center.x, center.y);
        expect(all.length).toBe(2);
        expect(all[0]).toBe(visual.context.getVisual(near));
        expect(all[1]).toBe(visual.context.getVisual(far));

        const filtered = view.detectVisual(center.x, center.y, { allow: (node) => node !== near });
        expect(filtered.length).toBe(1);
        expect(filtered[0]).toBe(visual.context.getVisual(far));
    });
});

describe("ThreeView detect — rectangle selection", () => {
    test("detectVisualRect hits panels inside the rect and applies nodeFilter", () => {
        const { view, visual, near, far, side, center, sideCenter, empty } = createSceneWithPanels();

        const atCenter = view.detectVisualRect(center.x - 10, center.y - 10, center.x + 10, center.y + 10);
        expect(atCenter.length).toBe(2);
        expect(atCenter).toContain(visual.context.getVisual(near));
        expect(atCenter).toContain(visual.context.getVisual(far));

        const atSide = view.detectVisualRect(
            sideCenter.x - 8,
            sideCenter.y - 8,
            sideCenter.x + 8,
            sideCenter.y + 8,
        );
        expect(atSide.length).toBe(1);
        expect(atSide[0]).toBe(visual.context.getVisual(side));

        const atEmpty = view.detectVisualRect(empty.x - 5, empty.y - 5, empty.x + 5, empty.y + 5);
        expect(atEmpty.length).toBe(0);

        const filtered = view.detectVisualRect(center.x - 10, center.y - 10, center.x + 10, center.y + 10, {
            allow: (node) => node !== near,
        });
        expect(filtered.length).toBe(1);
        expect(filtered[0]).toBe(visual.context.getVisual(far));
    });

    test("detectShapesRect returns whole shapes of panels inside the rect", () => {
        const { view, near, far, center, empty } = createSceneWithPanels();

        const shapes = view.detectShapesRect(
            ShapeTypes.shape,
            center.x - 10,
            center.y - 10,
            center.x + 10,
            center.y + 10,
        );
        expect(shapes.length).toBe(2);
        expect(shapes.map((x) => x.shape)).toContain(near.panel);
        expect(shapes.map((x) => x.shape)).toContain(far.panel);

        const atEmpty = view.detectShapesRect(
            ShapeTypes.shape,
            empty.x - 5,
            empty.y - 5,
            empty.x + 5,
            empty.y + 5,
        );
        expect(atEmpty.length).toBe(0);
    });

    test("detectShapesRect applies shapeFilter and nodeFilter on the whole-shape path", () => {
        const { view, near, far, center } = createSceneWithPanels();
        const rect = [center.x - 10, center.y - 10, center.x + 10, center.y + 10] as const;

        const shapeFiltered = view.detectShapesRect(ShapeTypes.shape, ...rect, {
            allow: (shape) => shape !== near.panel,
        });
        expect(shapeFiltered.length).toBe(1);
        expect(shapeFiltered[0].shape).toBe(far.panel);

        const nodeFiltered = view.detectShapesRect(ShapeTypes.shape, ...rect, undefined, {
            allow: (node) => node !== near,
        });
        expect(nodeFiltered.length).toBe(1);
        expect(nodeFiltered[0].shape).toBe(far.panel);
    });

    test("detectShapesRect returns the sub face whose center is inside the rect", () => {
        const { view, near, far, side, center, sideCenter, empty } = createSceneWithPanels();

        const atSide = view.detectShapesRect(
            ShapeTypes.face,
            sideCenter.x - 8,
            sideCenter.y - 8,
            sideCenter.x + 8,
            sideCenter.y + 8,
        );
        expect(atSide.length).toBe(1);
        expect(atSide[0].shape).toBe(side.panel.face);

        const atCenter = view.detectShapesRect(
            ShapeTypes.face,
            center.x - 10,
            center.y - 10,
            center.x + 10,
            center.y + 10,
        );
        expect(atCenter.length).toBe(2);
        expect(atCenter.map((x) => x.shape)).toContain(near.panel.face);
        expect(atCenter.map((x) => x.shape)).toContain(far.panel.face);

        const atEmpty = view.detectShapesRect(
            ShapeTypes.face,
            empty.x - 5,
            empty.y - 5,
            empty.x + 5,
            empty.y + 5,
        );
        expect(atEmpty.length).toBe(0);
    });
});
