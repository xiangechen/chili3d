// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type IDocument,
    type INode,
    type INodeLinkedList,
    type IShape,
    type IShapeFactory,
    type IView,
    Line,
    Matrix4,
    Plane,
    Result,
    type SnapResult,
    Transaction,
    type VisualNode,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";

// `rs` is provided as a global by Rstest, but import explicitly for clarity.
import { rs } from "@rstest/core";

/**
 * Helpers for driving geometry-create / measure commands without the WASM
 * kernel or the full step engine. A command's real logic lives in
 * `geometryNode()` (or `executeMainTask`) plus its private preview / validator
 * callbacks; by seeding `stepDatas` directly and stubbing `Transaction.execute`
 * we can exercise that logic as a pure function of its inputs.
 */

/** Standard XY plane anchored at the origin (matches the default workplane). */
export const PLANE_XY = Plane.XY;

export interface SeedStepOptions {
    /** SnapType, defaults to "input" so rect/center-rect branches are reachable. */
    type?: SnapResult["type"];
    point?: XYZ;
    plane?: Plane | undefined;
}

/**
 * Build a minimal SnapResult suitable for point/length steps. `view.workplane`
 * is the XY plane so `rectDataFromTemp` / `findPlane` have something to read,
 * and `view.direction()` returns -Z so `ViewUtils.raycastClosestPlane` works.
 */
export function pointStepResult(opts: SeedStepOptions = {}): SnapResult {
    return {
        view: {
            workplane: Plane.XY,
            direction: () => XYZ.unitNZ,
            up: () => XYZ.unitY,
            cameraController: {
                cameraPosition: XYZ.zero,
                cameraType: "orthographic",
            },
        } as unknown as IView,
        type: opts.type ?? "input",
        point: opts.point,
        plane: opts.plane,
        shapes: [],
    };
}

/**
 * Replace `Transaction.execute` with a pass-through that runs the callback
 * immediately, so create commands' `executeMainTask` can be observed without
 * snapshot machinery. Returns a restore function.
 */
export function stubTransactionRun(): () => void {
    const original = Transaction.execute;
    Transaction.execute = ((_doc: unknown, _label: string, fn: () => void) => {
        fn();
    }) as typeof Transaction.execute;
    return () => {
        Transaction.execute = original;
    };
}

/**
 * Wire a command instance to a mock application/document so `cmd.document`
 * resolves and `executeMainTask` can mutate `modelManager.addNode`.
 * Returns the mock document plus the list of added nodes for assertions.
 */
export function wireCommand<C>(cmd: C): { doc: IDocument; addedNodes: unknown[] } {
    const addedNodes: unknown[] = [];
    const doc = {
        modelManager: {
            addNode: (...nodes: unknown[]) => addedNodes.push(...nodes),
            currentNode: undefined,
            rootNode: makeParent({ id: "root" }),
            materials: [{ id: "mat-default" }],
        },
        visual: {
            update: rs.fn(),
            highlighter: { addState: rs.fn(), removeState: rs.fn() },
            context: {
                displayMesh: rs.fn(() => "visual-id"),
                displayLineSegments: rs.fn(() => "visual-id"),
                setPosition: rs.fn(),
                removeMesh: rs.fn(),
                getNode: rs.fn(),
                removeNode: rs.fn(),
                getVisual: rs.fn(),
                setVisible: rs.fn(),
                redrawNode: rs.fn(),
            },
        },
        // `history.disabled = true` makes Transaction.add a no-op so property
        // setters on created nodes (e.g. isFace) don't need real history wiring.
        history: { disabled: true, add: rs.fn() },
        selection: {
            clearSelection: rs.fn(),
            getSelectedVisualNodes: (): VisualNode[] => [],
            getSelectedShapes: (): VisualShapeData[] => [],
        },
        picker: {
            pickNode: rs.fn(async () => [] as VisualNode[]),
        },
    } as unknown as IDocument;

    (cmd as any)._application = {
        activeView: {
            document: doc,
            workplane: Plane.XY,
            direction: () => XYZ.unitNZ,
            htmlText: rs.fn(),
        },
    };
    return { doc, addedNodes };
}

/** Convenience: seed `cmd.stepDatas` with the given list. */
export function seedStepDatas<C>(cmd: C, datas: SnapResult[]): void {
    (cmd as any).stepDatas = datas;
}

/**
 * A fake IShape that satisfies the small slice node constructors and preview
 * callbacks touch: edgesMeshPosition / toFace / mesh.edges / dispose.
 */
const fakeMesh = { edges: { type: "edges", positions: [], lineWidth: 0, color: 0 } };
const fakeShape = {
    edgesMeshPosition: () => ({ type: "edges", positions: [] }),
    toFace: () => Result.ok(fakeShape),
    mesh: fakeMesh,
    dispose: () => {},
};
const okResult = (): Result<IShape> => Result.ok(fakeShape as unknown as IShape);

/**
 * Override the global `app` with a stub whose `shapeProvider.factory` returns a
 * fake disposable shape for every method. Required because node constructors
 * (e.g. CircleNode setting `isFace`) re-run `generateShape`, which reads the
 * global `shapeFactory` getter → `app.shapeProvider.factory`.
 *
 * Returns a restore function; call it in `afterEach`/`finally`. Unlike
 * `setCurrentApplication` (which is one-shot), this can be installed and torn
 * down per test since `application.ts` declares the `app` getter with
 * `configurable: true`.
 */
export function stubGlobalApp(): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");

    const stubFactory = new Proxy(
        {},
        {
            get: () => () => okResult(),
        },
    ) as unknown as IShapeFactory;

    const stubApp = {
        shapeProvider: { factory: stubFactory, converter: {} as any },
    } as unknown as IApplication;

    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => stubApp,
    });

    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "app", previous);
        }
    };
}

/**
 * Install the global stub app once for a whole test file (use in `beforeAll`).
 * Pairs with the unexported module flag so repeated calls are cheap, but each
 * install is still restorable via the returned function.
 */
export function ensureGlobalStubApp(): () => void {
    return stubGlobalApp();
}

/**
 * Minimal linked-list parent satisfying the INodeLinkedList slice the commands
 * touch: add/remove/insertAfter/insertBefore. Records all add() args so tests
 * can assert which new nodes were appended to the document tree.
 */
export interface TrackingParent extends INodeLinkedList {
    added: unknown[];
    removed: unknown[];
    insertedAfter: Array<{ target: unknown; node: unknown }>;
}
export function makeParent(opts: Partial<TrackingParent> = {}): TrackingParent {
    const parent: TrackingParent = {
        id: opts.id ?? "root",
        added: [],
        removed: [],
        insertedAfter: [],
        add(...items: INode[]) {
            parent.added.push(...items);
        },
        remove(...items: INode[]) {
            parent.removed.push(...items);
        },
        transfer(...items: INode[]) {
            parent.added.push(...items);
        },
        insertAfter(target: INode | undefined, node: INode) {
            parent.insertedAfter.push({ target, node });
        },
        insertBefore(target: INode | undefined, node: INode) {
            parent.insertedAfter.push({ target, node });
        },
        move(_child: INode, _newParent: INodeLinkedList, _newPreviousSibling?: INode) {},
        size: () => 0,
        firstChild: undefined,
        lastChild: undefined,
        // LinkedList fields expected by Node hierarchy (parent/previousSibling/etc).
        parent: undefined,
        previousSibling: undefined,
        nextSibling: undefined,
        name: "root",
        visible: true,
        parentVisible: true,
        clone() {
            return parent as any;
        },
        ...opts,
    } as unknown as TrackingParent;
    return parent;
}

/**
 * Mock of an IShape that records its `transformedMul` / `transformed` calls
 * (so transform-preview and the geometry-input reads work) and returns itself
 * (or a configurable result) for the few methods modify commands touch.
 */
export interface MockShape extends IShape {
    calls: Map<string, unknown[][]>;
}
export function mockShape(overrides: Partial<IShape> = {}): MockShape {
    const calls = new Map<string, unknown[][]>();
    const track =
        <K extends string>(name: K) =>
        (...args: unknown[]) => {
            const existing = calls.get(name) ?? [];
            existing.push(args);
            calls.set(name, existing);
            return shape;
        };
    const shape = {
        shapeType: 0,
        mesh: fakeMesh,
        matrix: Matrix4.identity(),
        isEqual: () => false,
        dispose: () => {},
        transformedMul: track("transformedMul"),
        transformed: track("transformed"),
        ...overrides,
    } as unknown as MockShape;
    shape.calls = calls;
    return shape;
}

/**
 * Build a VisualShapeData record (a step's `shapes[i]`) wrapping a mock shape
 * plus an `owner.node` the command can mutate. The owner is shared so that
 * `getNode`, `addState`, `removeState` calls all see the same node.
 */
export function shapeData(opts: {
    shape?: Partial<IShape>;
    transform?: Matrix4;
    point?: XYZ;
    indexes?: number[];
    node?: unknown;
    owner?: Partial<{ node: unknown; getNode: (o: unknown) => unknown }>;
}): VisualShapeData {
    const node = opts.node ?? {};
    const shape = mockShape(opts.shape ?? {});
    const transform = opts.transform ?? Matrix4.identity();
    return {
        shape,
        transform,
        point: opts.point,
        indexes: opts.indexes ?? [],
        owner: opts.owner ?? {
            node,
            getNode: () => node,
        },
    } as unknown as VisualShapeData;
}

/**
 * Mock VisualNode used by transform commands (Move/Rotate/Mirror): needs
 * transform getter/setter, clone(), mesh (with position/edges), parent,
 * and an `insertAfter`-capable parent. `kind` picks the branch in
 * `ensureSelectedModels` (mesh / geometry / component).
 */
export function mockVisualNode(
    kind: "mesh" | "geometry" | "component",
    opts: {
        parent?: TrackingParent;
        position?: number[];
        edgesPosition?: number[];
        boundingBoxPosition?: number[];
        shape?: Partial<IShape>;
    } = {},
): { node: VisualNode; parent: TrackingParent } {
    const parent = opts.parent ?? makeParent();
    const transform = Matrix4.identity();
    const cloneNode: any = {
        parent: undefined,
        transform: Matrix4.identity(),
    };
    const node: any = {
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
        get transform() {
            return transform;
        },
        set transform(_value: Matrix4) {
            // mutate-in-place so consumers that captured `transform` see updates.
            (transform as any)._array = (_value as any)._array;
        },
        clone() {
            return cloneNode;
        },
        worldTransform() {
            return transform;
        },
    };
    if (kind === "mesh") {
        node.mesh = { position: opts.position ?? new Float32Array([0, 0, 0]) };
    } else if (kind === "geometry") {
        node.mesh = { edges: { position: opts.edgesPosition ?? new Float32Array([0, 0, 0]) } };
    } else {
        node.boundingBox = () => ({
            position: opts.boundingBoxPosition ?? new Float32Array([0, 0, 0, 1, 1, 1]),
        });
    }
    return { node: node as VisualNode, parent };
}

/**
 * Build a step result carrying a list of `nodes` (used by GetOrSelectNodeStep
 * consumers: Explode / Repair / Group / removeSubShapes / removeFeature).
 */
export function nodeStepResult(
    nodes: VisualNode[],
    opts: { shapes?: VisualShapeData[]; point?: XYZ } = {},
): SnapResult {
    return {
        view: {
            workplane: Plane.XY,
            direction: () => XYZ.unitNZ,
            up: () => XYZ.unitY,
            cameraController: { cameraPosition: XYZ.zero, cameraType: "orthographic" as const },
        } as unknown as IView,
        type: "node",
        nodes,
        shapes: opts.shapes ?? [],
        point: opts.point,
    };
}

/**
 * Build a step result carrying shapes (used by SelectShapeStep consumers:
 * fillet / chamfer / section / break / split / thickSolid / sew). Each entry
 * gets the same parent so `node.parent?.remove` and `parent.add` work.
 */
export function shapeStepResult(
    entries: Array<{ shape?: Partial<IShape>; node?: unknown; point?: XYZ; transform?: Matrix4 }>,
    opts: { plane?: Plane; point?: XYZ } = {},
): SnapResult {
    const parent = makeParent();
    const shapes = entries.map((e) => {
        const node = (e.node ?? { parent, previousSibling: undefined, nextSibling: undefined }) as any;
        return shapeData({ shape: e.shape, point: e.point, transform: e.transform, node });
    });
    return {
        view: {
            workplane: Plane.XY,
            direction: () => XYZ.unitNZ,
            up: () => XYZ.unitY,
            cameraController: { cameraPosition: XYZ.zero, cameraType: "orthographic" as const },
        } as unknown as IView,
        type: "shape",
        shapes,
        plane: opts.plane,
        point: opts.point,
    };
}

/** A Line centered on origin along Z — convenient for revolve-axis tests. */
export function zAxisLine(): Line {
    return new Line({ point: XYZ.zero, direction: XYZ.unitZ });
}
