// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Plane as CorePlane,
    defaultFontService,
    EditableShapeNode,
    type FaceMeshData,
    type IShape,
    type ISubShape,
    MultiShapeNode,
    Result,
    SectionPlaneNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    BoxGeometry,
    BufferGeometry,
    type Camera,
    DataTexture,
    Group,
    type InterleavedBufferAttribute,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    NotEqualStencilFunc,
    type Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Plane,
    Points,
    PointsMaterial,
    ReplaceStencilOp,
    Scene,
    type Vector2,
    Vector3,
    type WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { AnnotationBatch } from "../src/annotationBatch";
import { Constants } from "../src/constants";
import { SectionViewRenderer } from "../src/sectionViewRenderer";
import { ThreeGeometry } from "../src/threeGeometry";
import { TopRenderOrder } from "../src/threeGeometryFactory";
import { ThreeSectionPlaneObject } from "../src/threeSectionPlaneObject";
import { ThreeComponentObject, ThreeMeshObject } from "../src/threeVisualObject";
import {
    createTestComponentNode,
    createTestGeometryNode,
    createTestMeshNode,
    createThreeMockVisualContext,
} from "./mocks";

function createCamera() {
    const camera = new PerspectiveCamera();
    camera.layers.enableAll();
    camera.position.set(0, 0, 10);
    return camera;
}

function createRenderer() {
    return {
        autoClear: true,
        clippingPlanes: [] as Plane[],
        clear: rs.fn(),
        clearStencil: rs.fn(),
        getSize: rs.fn((target: Vector2) => target.set(800, 600)),
        render: rs.fn((_object: Object3D, _camera: Camera) => {}),
    };
}

const sectionVisuals = new WeakMap<SectionViewRenderer, ThreeSectionPlaneObject | undefined>();

function setSectionVisual(section: SectionViewRenderer, visual: ThreeSectionPlaneObject | undefined): void {
    sectionVisuals.set(section, visual);
}

function renderSingle(
    section: SectionViewRenderer,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    plane: CorePlane | undefined,
    clippingPlane: Plane | undefined,
): void {
    const sections =
        plane && clippingPlane ? [{ plane, clippingPlane, visual: sectionVisuals.get(section) }] : [];
    section.render(renderer, scene, camera, sections);
}

function hatchRepeat(mesh: Mesh): number {
    const map = (mesh.material as MeshBasicMaterial).map;
    if (!map) throw new Error("Section cap has no hatch texture");
    return map.repeat.x;
}

function addBox(
    context: ReturnType<typeof createThreeMockVisualContext>,
    layer: number = Constants.Layers.Solid,
) {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    mesh.layers.set(layer);
    context.visualShapes.add(mesh);
    return mesh;
}

function mixedFace(closedRoot: IShape, openRoot: IShape): FaceMeshData {
    const closedFace = { parent: closedRoot } as unknown as ISubShape;
    const openFace = { parent: openRoot } as unknown as ISubShape;
    return {
        position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
        normal: new Float32Array(18).fill(1),
        uv: new Float32Array(12),
        index: new Uint32Array([0, 1, 2, 3, 4, 5]),
        range: [
            { start: 0, count: 3, shape: closedFace },
            { start: 3, count: 3, shape: openFace },
        ],
        groups: [],
        color: 0xff0000,
    };
}

describe("SectionViewRenderer", () => {
    beforeEach(() => {
        rs.spyOn(defaultFontService, "ensureLoaded").mockImplementation(() => {});
        rs.spyOn(defaultFontService, "layout").mockImplementation((text) => {
            if (text.length === 0) return new Float32Array(0);
            return new Float32Array([-0.5, -0.25, 0.5, -0.25, 0.5, 0.25, -0.5, -0.25, 0.5, 0.25, -0.5, 0.25]);
        });
    });

    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("renders a hatched stencil cap and cut edges, then restores renderer state", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);
        const gpuClippingPlane = clippingPlane.clone();
        gpuClippingPlane.constant += 1e-4;
        renderer.clippingPlanes = [gpuClippingPlane];

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            clippingPlane,
        );

        expect(renderer.render).toHaveBeenCalledTimes(4);
        expect(renderer.clear).toHaveBeenCalledOnce();
        expect(renderer.clearStencil).toHaveBeenCalledOnce();
        expect(renderer.autoClear).toBe(true);
        expect(renderer.clippingPlanes).toEqual([gpuClippingPlane]);
        for (const call of renderer.render.mock.calls.slice(0, 2)) {
            const stencilScene = call[0] as Scene;
            const material = (stencilScene.children[0] as Mesh).material as MeshBasicMaterial;
            expect(material.depthWrite).toBe(false);
            expect(material.depthTest).toBe(false);
            expect(material.stencilFail).toBe(material.stencilZPass);
            expect(material.stencilZFail).toBe(material.stencilZPass);
        }
        const capScene = renderer.render.mock.calls[2][0] as Scene;
        const cap = capScene.children[0] as Mesh;
        const material = cap.material as MeshBasicMaterial;
        expect(material.map).toBeInstanceOf(DataTexture);
        expect(material.depthWrite).toBe(true);
        expect(material.depthTest).toBe(true);
        expect(material.stencilFunc).toBe(NotEqualStencilFunc);
        expect(renderer.render.mock.calls[3][0]).toBe(context.scene);
        const edges = capScene.children[1] as LineSegments2;
        expect(edges.visible).toBe(true);
        expect(edges.geometry.attributes["instanceStart"].count).toBeGreaterThan(0);

        section.dispose();
    });

    test("draws a selectable rectangular frame around the intersecting content", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const document = createMockDocument();
        const node = new SectionPlaneNode({ document, plane: CorePlane.XY, name: "Section A" });
        const visual = new ThreeSectionPlaneObject(node);
        context.visualShapes.add(visual);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        setSectionVisual(section, visual);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const frame = visual.wholeVisual()[0];
        expect(frame.visible).toBe(true);
        expect(frame.geometry.attributes["instanceStart"].count).toBe(4);
        const start = frame.geometry.attributes["instanceStart"].array.slice(0, 6);
        [-1.1, -1.1, 0, 1.1, -1.1, 0].forEach((value, index) => {
            expect(start[index]).toBeCloseTo(value, 6);
        });
        expect(frame.material.depthTest).toBe(false);
        const label = visual.getObjectByName("sectionPlaneLabel") as Mesh<BufferGeometry, MeshBasicMaterial>;
        expect(label).toBeInstanceOf(Mesh);
        expect(label.visible).toBe(true);
        expect(label.geometry.getAttribute("position").count).toBe(6);
        expect(label.material.depthTest).toBe(false);
        expect(label.position.x).toBeCloseTo(-1.056, 6);
        expect(label.position.y).toBeCloseTo(1.056, 6);
        expect(label.scale.x).toBeCloseTo(0.11, 6);
        node.name = "Renamed section";
        expect(defaultFontService.layout).toHaveBeenLastCalledWith("Renamed section");
        expect(renderer.render.mock.calls.at(-2)?.[0]).toBe(frame);
        expect(renderer.render.mock.calls.at(-1)?.[0]).toBe(label);

        const defaultMaterial = frame.material;
        visual.highlight();
        expect(frame.material).not.toBe(defaultMaterial);
        expect(frame.material.depthTest).toBe(false);
        visual.unhighlight();
        expect(frame.material).toBe(defaultMaterial);
        section.dispose();
        visual.dispose();
    });

    test("keeps the label upright and reuses the frame buffer when the section flips", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const document = createMockDocument();
        const visual = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.XY }));
        context.visualShapes.add(visual);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        setSectionVisual(section, visual);
        const camera = createCamera();
        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );
        const label = visual.getObjectByName("sectionPlaneLabel") as Mesh;
        const initialPosition = label.position.clone();
        const initialQuaternion = label.quaternion.clone();
        const frame = visual.wholeVisual()[0] as LineSegments2;
        const instanceStart = frame.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute;
        const buffer = instanceStart.data;
        const initialVersion = buffer.version;

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            new CorePlane({ origin: XYZ.zero, normal: XYZ.unitNZ, xvec: XYZ.unitX }),
            new Plane(new Vector3(0, 0, -1), 0),
        );

        expect(label.position.distanceTo(initialPosition)).toBeLessThan(1e-6);
        expect(label.quaternion.equals(initialQuaternion)).toBe(true);
        expect(instanceStart.data).toBe(buffer);
        expect(buffer.version).toBeGreaterThan(initialVersion);
        section.dispose();
        visual.dispose();
    });

    test("sizes the frame from the whole visible scene, including solids away from the plane", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const far = addBox(context);
        far.position.set(10, 0, 20);
        const hidden = addBox(context);
        hidden.position.set(100, 0, 0);
        hidden.visible = false;
        const document = createMockDocument();
        const visual = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.XY }));
        context.visualShapes.add(visual);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        setSectionVisual(section, visual);
        const render = () =>
            renderSingle(
                section,
                renderer as unknown as WebGLRenderer,
                context.scene,
                createCamera(),
                CorePlane.XY,
                new Plane(new Vector3(0, 0, 1), 0),
            );

        render();

        const frame = visual.wholeVisual()[0];
        const initial = frame.geometry.attributes["instanceStart"].array.slice(0, 6);
        [-1.24, -1.24, 0, 11.24, -1.24, 0].forEach((value, index) => {
            expect(initial[index]).toBeCloseTo(value, 6);
        });

        far.position.x = 20;
        render();
        const moved = frame.geometry.attributes["instanceStart"].array.slice(0, 6);
        expect(moved[3]).toBeCloseTo(21.44, 5);
        section.dispose();
        visual.dispose();
    });

    test("renders every active section and clips each cap by the other planes", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const document = createMockDocument();
        const first = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.XY }));
        const second = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.YZ }));
        context.visualShapes.add(first, second);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const clippingXY = new Plane(new Vector3(0, 0, 1), 0);
        const clippingYZ = new Plane(new Vector3(1, 0, 0), 0);
        renderer.clippingPlanes = [clippingXY, clippingYZ];
        const clippingAtCaps: Plane[][] = [];
        const clippingAtRender: Plane[][] = [];
        const clippingAtStencils: Plane[][] = [];
        renderer.render.mockImplementation((object, _camera) => {
            clippingAtRender.push([...renderer.clippingPlanes]);
            if (
                object instanceof Scene &&
                object.children.length === 1 &&
                object.children[0] instanceof Mesh
            ) {
                const material = object.children[0].material as MeshBasicMaterial;
                if (material.clippingPlanes) clippingAtStencils.push([...material.clippingPlanes]);
            }
            if (
                object instanceof Scene &&
                object.children.length === 2 &&
                object.children[0] instanceof Mesh
            ) {
                clippingAtCaps.push([...renderer.clippingPlanes]);
            }
        });

        section.render(renderer as unknown as WebGLRenderer, context.scene, createCamera(), [
            { plane: CorePlane.XY, clippingPlane: clippingXY, visual: first },
            { plane: CorePlane.YZ, clippingPlane: clippingYZ, visual: second },
        ]);

        expect(renderer.clearStencil).toHaveBeenCalledTimes(2);
        expect([0, 1, 3, 4].map((index) => clippingAtRender[index])).toEqual([[], [], [], []]);
        expect(clippingAtStencils).toEqual([[clippingXY], [clippingXY], [clippingYZ], [clippingYZ]]);
        expect(clippingAtCaps).toEqual([[clippingYZ], [clippingXY]]);
        expect(first.wholeVisual()[0].visible).toBe(true);
        expect(second.wholeVisual()[0].visible).toBe(true);
        expect(renderer.render.mock.calls.slice(-4).map((call) => call[0])).toEqual([
            first.wholeVisual()[0],
            first.getObjectByName("sectionPlaneLabel"),
            second.wholeVisual()[0],
            second.getObjectByName("sectionPlaneLabel"),
        ]);
        expect(renderer.clippingPlanes).toEqual([clippingXY, clippingYZ]);
        section.dispose();
        first.dispose();
        second.dispose();
    });

    test("keeps independent render caches for coincident sections across frames", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const document = createMockDocument();
        const first = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.XY }));
        const second = new ThreeSectionPlaneObject(new SectionPlaneNode({ document, plane: CorePlane.XY }));
        context.visualShapes.add(first, second);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        const sections = [
            {
                plane: CorePlane.XY,
                clippingPlane: new Plane(new Vector3(0, 0, 1), 0),
                visual: first,
            },
            {
                plane: CorePlane.XY,
                clippingPlane: new Plane(new Vector3(0, 0, 1), 0),
                visual: second,
            },
        ];

        section.render(renderer as unknown as WebGLRenderer, context.scene, camera, sections);

        expect(first.wholeVisual()[0].visible).toBe(true);
        expect(second.wholeVisual()[0].visible).toBe(true);
        const firstCalls = renderer.render.mock.calls.map((call) => call[0] as Scene);
        const firstEdges = firstCalls[2].children[1] as LineSegments2;
        const secondEdges = firstCalls[5].children[1] as LineSegments2;
        const firstEdgeGeometry = firstEdges.geometry;
        const secondEdgeGeometry = secondEdges.geometry;
        renderer.render.mockClear();

        section.render(renderer as unknown as WebGLRenderer, context.scene, camera, sections);

        const secondCalls = renderer.render.mock.calls.map((call) => call[0] as Scene);
        expect(secondCalls[0]).toBe(firstCalls[0]);
        expect(secondCalls[2]).toBe(firstCalls[2]);
        expect(secondCalls[3]).toBe(firstCalls[3]);
        expect(secondCalls[5]).toBe(firstCalls[5]);
        expect((secondCalls[2].children[1] as LineSegments2).geometry).toBe(firstEdgeGeometry);
        expect((secondCalls[5].children[1] as LineSegments2).geometry).toBe(secondEdgeGeometry);
        section.dispose();
        first.dispose();
        second.dispose();
    });

    test("draws on-top interaction meshes after the section without clipping them", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const overlay = new Group();
        const arrow = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        arrow.renderOrder = TopRenderOrder;
        const solidSibling = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial());
        overlay.add(arrow, solidSibling);
        context.tempShapes.add(overlay);
        const litOverlay = new Group();
        const litPreview = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial());
        litPreview.renderOrder = TopRenderOrder;
        litOverlay.add(litPreview);
        context.tempShapes.add(litOverlay);
        const renderer = createRenderer();
        let arrowVisibleInMain = true;
        let siblingVisibleInMain = true;
        let groupVisibleInMain = true;
        let litVisibleInMain = true;
        let clippingAtOverlay: Plane[] = [];
        renderer.render.mockImplementation((object, _camera) => {
            if (object === context.scene) {
                arrowVisibleInMain = arrow.visible;
                siblingVisibleInMain = solidSibling.visible;
                groupVisibleInMain = overlay.visible;
                litVisibleInMain = litOverlay.visible;
            }
            if (object === arrow) clippingAtOverlay = [...renderer.clippingPlanes];
        });
        const section = new SectionViewRenderer(context);
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);
        renderer.clippingPlanes = [clippingPlane];

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            clippingPlane,
        );

        expect(arrowVisibleInMain).toBe(false);
        expect(siblingVisibleInMain).toBe(true);
        expect(groupVisibleInMain).toBe(true);
        expect(litVisibleInMain).toBe(true);
        expect(renderer.render.mock.calls.at(-1)?.[0]).toBe(arrow);
        expect(renderer.render.mock.calls.some((call) => call[0] === litOverlay)).toBe(false);
        expect(renderer.render.mock.calls.some((call) => call[0] === overlay)).toBe(false);
        expect(clippingAtOverlay).toEqual([]);
        expect(arrow.visible).toBe(true);
        expect(renderer.clippingPlanes).toEqual([clippingPlane]);
        section.dispose();
    });

    test("draws unlit line and point handles without applying the section clip", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const overlay = new Group();
        const arc = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial());
        arc.geometry.setPositions([0, 0, 0, 1, 1, 1]);
        arc.renderOrder = TopRenderOrder;
        overlay.add(arc);
        context.tempShapes.add(overlay);
        const pointOverlay = new Group();
        const point = new Points(new BufferGeometry().setFromPoints([new Vector3()]), new PointsMaterial());
        point.renderOrder = TopRenderOrder;
        pointOverlay.add(point);
        context.tempShapes.add(pointOverlay);
        const renderer = createRenderer();
        let renderedOverlay = false;
        let renderedPoint = false;
        renderer.render.mockImplementation((object, _camera) => {
            if (object === arc) renderedOverlay = true;
            if (object === point) renderedPoint = true;
        });
        const section = new SectionViewRenderer(context);
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);
        renderer.clippingPlanes = [clippingPlane];

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            clippingPlane,
        );

        expect(renderedOverlay).toBe(true);
        expect(renderedPoint).toBe(true);
        expect(renderer.clippingPlanes).toEqual([clippingPlane]);
        section.dispose();
    });

    test("clears coplanar solid triangles from the cap stencil", () => {
        const context = createThreeMockVisualContext();
        const solid = addBox(context);
        solid.position.z = 1;
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        expect(renderer.render).toHaveBeenCalledTimes(5);
        const maskScene = renderer.render.mock.calls[2][0] as Scene;
        const mask = maskScene.children[0] as Mesh;
        expect(mask.geometry.attributes["position"].count).toBe(6);
        const material = mask.material as MeshBasicMaterial;
        expect(material.stencilRef).toBe(0);
        expect(material.stencilZPass).toBe(ReplaceStencilOp);
        expect(material.depthTest).toBe(false);
        expect(material.colorWrite).toBe(false);
        section.dispose();
    });

    test("does not mask a nearby parallel face on a large solid", () => {
        const context = createThreeMockVisualContext();
        const solid = addBox(context);
        solid.geometry.dispose();
        solid.geometry = new BoxGeometry(1000, 1000, 1000);
        solid.position.z = -499.98;
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        expect(renderer.render).toHaveBeenCalledTimes(4);
        expect(renderer.render.mock.calls.at(-1)?.[0]).toBe(context.scene);
        section.dispose();
    });

    test("renders only the main scene when clipping is disabled", () => {
        const context = createThreeMockVisualContext();
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            new PerspectiveCamera(),
            undefined,
            undefined,
        );

        expect(renderer.render).toHaveBeenCalledOnce();
        expect(renderer.render).toHaveBeenCalledWith(context.scene, expect.any(PerspectiveCamera));
        section.dispose();
    });

    test("offsets cut edges toward the camera and reuses stencil meshes when only the plane moves", () => {
        const context = createThreeMockVisualContext();
        const mesh = addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        camera.position.set(0, 0, -10);
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            clippingPlane,
        );

        const firstStencil = (renderer.render.mock.calls[0][0] as Scene).children[0];
        const firstEdges = (renderer.render.mock.calls[2][0] as Scene).children[1] as LineSegments2;
        const firstEdgeGeometry = firstEdges.geometry;
        expect(firstEdges.geometry.attributes["instanceStart"].array[2]).toBeLessThan(0);

        renderer.render.mockClear();
        const movedPlane = CorePlane.XY.translateTo(new XYZ(0, 0, 0.5));
        clippingPlane.constant = -0.5;
        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            movedPlane,
            clippingPlane,
        );

        expect((renderer.render.mock.calls[0][0] as Scene).children[0]).toBe(firstStencil);
        const movedEdges = (renderer.render.mock.calls[2][0] as Scene).children[1] as LineSegments2;
        expect(movedEdges.geometry).not.toBe(firstEdgeGeometry);

        renderer.render.mockClear();
        mesh.position.x = 1;
        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            movedPlane,
            clippingPlane,
        );
        expect((renderer.render.mock.calls[0][0] as Scene).children[0]).not.toBe(firstStencil);
        section.dispose();
    });

    test("keeps hatch density constant when a perspective camera zooms", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);
        const render = () =>
            renderSingle(
                section,
                renderer as unknown as WebGLRenderer,
                context.scene,
                camera,
                CorePlane.XY,
                clippingPlane,
            );

        render();
        const firstCap = (renderer.render.mock.calls[2][0] as Scene).children[0] as Mesh;
        const firstRepeat = hatchRepeat(firstCap);
        const firstEdges = (renderer.render.mock.calls[2][0] as Scene).children[1] as LineSegments2;
        renderer.render.mockClear();
        camera.position.z = 20;
        render();

        const secondCap = (renderer.render.mock.calls[2][0] as Scene).children[0] as Mesh;
        const secondRepeat = hatchRepeat(secondCap);
        const secondEdges = (renderer.render.mock.calls[2][0] as Scene).children[1] as LineSegments2;
        expect(secondRepeat).toBeCloseTo(firstRepeat / 2);
        expect(secondEdges.geometry).toBe(firstEdges.geometry);
        section.dispose();
    });

    test("keeps hatch density constant when an orthographic camera zooms", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
        camera.layers.enableAll();
        camera.position.z = 10;
        const clippingPlane = new Plane(new Vector3(0, 0, 1), 0);
        const render = () =>
            renderSingle(
                section,
                renderer as unknown as WebGLRenderer,
                context.scene,
                camera,
                CorePlane.XY,
                clippingPlane,
            );

        render();
        const cap = (renderer.render.mock.calls[2][0] as Scene).children[0] as Mesh;
        const firstRepeat = hatchRepeat(cap);
        camera.zoom = 2;
        render();

        expect(hatchRepeat(cap)).toBeCloseTo(firstRepeat * 2);
        section.dispose();
    });

    test("omits solid meshes when the camera is in wireframe mode", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        camera.layers.disableAll();
        camera.layers.enable(Constants.Layers.Wireframe);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        expect(renderer.render).toHaveBeenCalledOnce();
        section.dispose();
    });

    test("caps only isolated meshes and ignores non-isolated solids", () => {
        const context = createThreeMockVisualContext();
        const isolated = addBox(context, Constants.Layers.Isolation);
        addBox(context);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        camera.layers.disableAll();
        camera.layers.enable(Constants.Layers.Default);
        camera.layers.enable(Constants.Layers.Isolation);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(isolated.geometry);
        section.dispose();
    });

    test("excludes open MeshNode surfaces from stencil geometry", () => {
        const context = createThreeMockVisualContext();
        const solid = addBox(context);
        const surface = new ThreeMeshObject(context, createTestMeshNode({ meshType: "surface" }));
        context.visualShapes.add(surface);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(solid.geometry);
        section.dispose();
    });

    test("excludes component surface channels while retaining solid face channels", () => {
        const context = createThreeMockVisualContext();
        const solid = addBox(context);
        const node = createTestComponentNode();
        node.component.mesh.surface.position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        node.component.mesh.surface.normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
        node.component.mesh.surface.uv = new Float32Array([0, 0, 1, 0, 0, 1]);
        node.component.mesh.surface.index = new Uint32Array([0, 1, 2]);
        const component = new ThreeComponentObject(node, context);
        context.visualShapes.add(component);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(2);
        expect(stencilScene.children.map((child) => (child as Mesh).geometry)).toEqual([
            solid.geometry,
            component.faces?.geometry,
        ]);
        section.dispose();
    });

    test("filters open ShapeNode ranges out of a component's solid face channel", () => {
        const context = createThreeMockVisualContext();
        addBox(context);
        const closedRoot = { isClosed: () => true, shapeType: ShapeTypes.solid } as unknown as IShape;
        const openRoot = { isClosed: () => false, shapeType: ShapeTypes.face } as unknown as IShape;
        const node = createTestComponentNode();
        node.component.mesh.face = mixedFace(closedRoot, openRoot);
        const component = new ThreeComponentObject(node, context);
        context.visualShapes.add(component);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(2);
        expect((stencilScene.children[1] as Mesh).geometry.index?.count).toBe(3);
        section.dispose();
    });

    test("retains closed MultiShape members and ignores open bounds in the cap layout", () => {
        const context = createThreeMockVisualContext();
        const closedRoot = { isClosed: () => true, shapeType: ShapeTypes.solid } as unknown as IShape;
        const openRoot = { isClosed: () => false, shapeType: ShapeTypes.face } as unknown as IShape;
        const node = createTestGeometryNode({ hasEdges: false, hasVertexs: false });
        Object.setPrototypeOf(node, MultiShapeNode.prototype);
        const face = mixedFace(closedRoot, openRoot);
        face.position.fill(10000, 9);
        node.mesh.faces = face;
        Object.defineProperty(node, "shapes", { value: [closedRoot, openRoot], configurable: true });
        const mixed = new ThreeGeometry(node, context);
        context.visualShapes.add(mixed);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry.index?.count).toBe(3);
        const capScene = renderer.render.mock.calls[3][0] as Scene;
        expect((capScene.children[0] as Mesh).position.x).toBeCloseTo(0.5, 6);
        section.dispose();
    });

    test("includes solid ShapeNodes even when their kernel closed flag is false", () => {
        const context = createThreeMockVisualContext();
        const node = createTestGeometryNode({ hasEdges: false, hasVertexs: false });
        Object.setPrototypeOf(node, EditableShapeNode.prototype);
        Object.defineProperty(node, "shape", {
            value: Result.ok({ isClosed: () => false, shapeType: ShapeTypes.solid }),
            configurable: true,
        });
        const solid = new ThreeGeometry(node, context);
        context.visualShapes.add(solid);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(solid.faces()?.geometry);
        section.dispose();
    });

    test.each([
        { shapeType: ShapeTypes.face, closed: false },
        { shapeType: ShapeTypes.shell, closed: true },
    ])(
        "excludes non-solid ShapeNode geometry (shapeType $shapeType, closed $closed)",
        ({ shapeType, closed }) => {
            const context = createThreeMockVisualContext();
            const solid = addBox(context);
            const node = createTestGeometryNode({ hasEdges: false, hasVertexs: false });
            Object.setPrototypeOf(node, EditableShapeNode.prototype);
            Object.defineProperty(node, "shape", {
                value: Result.ok({ isClosed: () => closed, shapeType }),
                configurable: true,
            });
            const nonSolid = new ThreeGeometry(node, context);
            context.visualShapes.add(nonSolid);
            const renderer = createRenderer();
            const section = new SectionViewRenderer(context);

            renderSingle(
                section,
                renderer as unknown as WebGLRenderer,
                context.scene,
                createCamera(),
                CorePlane.XY,
                new Plane(new Vector3(0, 0, 1), 0),
            );

            const stencilScene = renderer.render.mock.calls[0][0] as Scene;
            expect(stencilScene.children).toHaveLength(1);
            expect((stencilScene.children[0] as Mesh).geometry).toBe(solid.geometry);
            section.dispose();
        },
    );

    test("centers the cap on intersecting geometry far from the plane origin", () => {
        const context = createThreeMockVisualContext();
        const mesh = addBox(context);
        mesh.position.x = 10000;
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const capScene = renderer.render.mock.calls[2][0] as Scene;
        const cap = capScene.children[0] as Mesh;
        expect(cap.position.x).toBeCloseTo(10000, 6);
        expect(cap.position.y).toBeCloseTo(0, 6);
        expect(cap.position.z).toBeCloseTo(0, 6);
        section.dispose();
    });

    test("uses the cap center depth for perspective hatch density", () => {
        const context = createThreeMockVisualContext();
        const mesh = addBox(context);
        mesh.position.x = 10000;
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();
        camera.position.set(10100, 100, 100);
        camera.lookAt(10000, 0, 0);
        camera.updateMatrixWorld();

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const capScene = renderer.render.mock.calls[2][0] as Scene;
        const cap = capScene.children[0] as Mesh;
        const depth = cap.position.clone().sub(camera.position).dot(camera.getWorldDirection(new Vector3()));
        const worldHeight = 2 * depth * Math.tan((camera.fov * Math.PI) / 360);
        const expectedRepeat = cap.scale.x / ((worldHeight * 16) / 600);
        expect(hatchRepeat(cap)).toBeCloseTo(expectedRepeat, 6);
        section.dispose();
    });

    test("skips meshes whose world bounds do not cross the section plane", () => {
        const context = createThreeMockVisualContext();
        const near = addBox(context);
        const far = addBox(context);
        far.position.z = 20;
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);
        const camera = createCamera();

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );
        let stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(near.geometry);

        renderer.render.mockClear();
        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            camera,
            CorePlane.XY.translateTo(new XYZ(0, 0, 20)),
            new Plane(new Vector3(0, 0, 1), -20),
        );
        stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(far.geometry);
        section.dispose();
    });

    test("excludes annotation triangles from stencil and cut-edge geometry", () => {
        const context = createThreeMockVisualContext();
        const solid = addBox(context);
        const batch = new AnnotationBatch(context, () => {});
        const annotation = batch.pickObjects()[1] as Mesh;
        annotation.geometry.dispose();
        annotation.geometry = new BoxGeometry(2, 2, 2);
        annotation.visible = true;
        context.visualShapes.add(batch);
        const renderer = createRenderer();
        const section = new SectionViewRenderer(context);

        renderSingle(
            section,
            renderer as unknown as WebGLRenderer,
            context.scene,
            createCamera(),
            CorePlane.XY,
            new Plane(new Vector3(0, 0, 1), 0),
        );

        const stencilScene = renderer.render.mock.calls[0][0] as Scene;
        expect(stencilScene.children).toHaveLength(1);
        expect((stencilScene.children[0] as Mesh).geometry).toBe(solid.geometry);
        section.dispose();
        batch.dispose();
    });
});
