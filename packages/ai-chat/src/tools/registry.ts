import type { BoundingBox, IDocument, INode, IShape, Material, XYZ } from "@chili3d/core";
import { getApplication, getAppModule, getCore, requireActiveDocument } from "../bridge/parent";
import { schemas, type ToolInput, type ToolName } from "./schemas";

type Vec3 = readonly [number, number, number];

function xyz(v: Vec3): XYZ {
    const core = getCore();
    return new core.XYZ({ x: v[0], y: v[1], z: v[2] });
}

function defaultNormal(): XYZ {
    return getCore().XYZ.unitZ;
}

function nodeSummary(n: INode) {
    return {
        id: n.id,
        name: n.name,
        type: n.constructor?.name ?? "Node",
        visible: n.visible,
    };
}

function findShapeNode(doc: IDocument, id: string): INode {
    const core = getCore();
    const n = doc.modelManager.findNode((x) => x.id === id);
    if (!n) throw new Error(`Node ${id} not found`);
    if (!(n instanceof core.ShapeNode)) {
        throw new Error(`Node ${id} (${n.name}) is not a shape node`);
    }
    return n;
}

function shapeOf(doc: IDocument, id: string): IShape {
    const core = getCore();
    const node = findShapeNode(doc, id) as InstanceType<typeof core.ShapeNode>;
    const shape = node.shape.value;
    if (!shape) throw new Error(`Node ${id} has no geometry yet`);
    return shape;
}

function withTransaction<T>(doc: IDocument, name: string, fn: () => T): T {
    const core = getCore();
    let result!: T;
    core.Transaction.execute(doc, name, () => {
        result = fn();
    });
    doc.visual.update();
    return result;
}

function planeFromName(name: "XY" | "YZ" | "ZX" = "XY") {
    const core = getCore();
    return name === "YZ" ? core.Plane.YZ : name === "ZX" ? core.Plane.ZX : core.Plane.XY;
}

function materialSummary(m: Material) {
    // Access a couple of optional PBR fields via any-cast because only
    // PhysicalMaterial exposes them. Only include the keys when they're
    // actually present — returning `undefined` here leaks into the stored
    // ToolModelMessage.output.value and fails jsonValueSchema next turn
    // (undefined is not a valid JSON value).
    const anyM = m as unknown as { metalness?: number; roughness?: number; opacity?: number };
    const summary: Record<string, unknown> = {
        id: m.id,
        name: m.name,
        color: m.color,
        opacity: anyM.opacity ?? 1,
        kind: m.constructor.name, // "Material" | "PhongMaterial" | "PhysicalMaterial"
    };
    if (anyM.metalness !== undefined) summary.metalness = anyM.metalness;
    if (anyM.roughness !== undefined) summary.roughness = anyM.roughness;
    return summary;
}

function findMaterial(doc: IDocument, id: string): Material {
    const m = doc.modelManager.materials.find((x) => x.id === id);
    if (!m) throw new Error(`Material ${id} not found in active document`);
    return m;
}

function nodesReferencingMaterial(doc: IDocument, materialId: string) {
    return doc.modelManager.findNodes((n) => {
        const mid = (n as unknown as { materialId?: string | string[] }).materialId;
        if (mid === undefined) return false;
        return Array.isArray(mid) ? mid.includes(materialId) : mid === materialId;
    });
}

function requireCameraController() {
    const app = getApplication();
    const view = app.activeView;
    if (!view) throw new Error("No active view to control the camera of");
    return view.cameraController;
}

function collectBoundingBox(doc: IDocument, nodeIds?: string[]): BoundingBox | undefined {
    const core = getCore();
    let box: BoundingBox | undefined;
    const visit = (n: INode) => {
        if (!(n instanceof core.VisualNode)) return;
        const nodeBox = (n as InstanceType<typeof core.VisualNode>).boundingBox();
        if (nodeBox) box = core.BoundingBox.combine(box, nodeBox);
    };
    if (nodeIds && nodeIds.length > 0) {
        for (const id of nodeIds) {
            const n = doc.modelManager.findNode((x) => x.id === id);
            if (n) visit(n);
        }
    } else {
        for (const n of doc.modelManager.findNodes()) visit(n);
    }
    return box;
}

function boundingBoxSize(box: BoundingBox): number {
    const dx = box.max.x - box.min.x;
    const dy = box.max.y - box.min.y;
    const dz = box.max.z - box.min.z;
    return Math.max(Math.hypot(dx, dy, dz), 1); // floor at 1mm so empty docs still frame sanely
}

// Z-up world; "front" looks along +Y towards -Y (standard engineering convention).
const VIEW_DIRECTIONS: Record<
    string,
    { eye: readonly [number, number, number]; up: readonly [number, number, number] }
> = {
    top: { eye: [0, 0, 1], up: [0, 1, 0] },
    bottom: { eye: [0, 0, -1], up: [0, 1, 0] },
    front: { eye: [0, -1, 0], up: [0, 0, 1] },
    back: { eye: [0, 1, 0], up: [0, 0, 1] },
    left: { eye: [-1, 0, 0], up: [0, 0, 1] },
    right: { eye: [1, 0, 0], up: [0, 0, 1] },
    iso: { eye: [1, -1, 1], up: [0, 0, 1] },
};

function normalize(v: readonly [number, number, number]): [number, number, number] {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m === 0 ? [0, 0, 1] : [v[0] / m, v[1] / m, v[2] / m];
}

async function capturedImage(
    sourceDataUrl: string,
    opts: {
        maxSize: number;
        mediaType: "image/jpeg" | "image/png";
        quality: number;
        background: string;
    },
): Promise<{ base64: string; width: number; height: number }> {
    const bitmap = await loadImage(sourceDataUrl);
    const { width, height } = fitInside(bitmap.width, bitmap.height, opts.maxSize);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context for screenshot encoding");
    // The WebGL canvas is created with `alpha: true`, so transparent areas
    // would otherwise flatten to black (JPEG) or show through (PNG). Paint
    // the viewport's actual backdrop first — the DOM behind the canvas uses
    // the same colour, so the composited result matches what the user sees.
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, opts.mediaType, opts.quality),
    );
    if (!blob) throw new Error("toBlob returned null");
    const buf = await blob.arrayBuffer();
    return { base64: bytesToBase64(new Uint8Array(buf)), width, height };
}

function readViewportBackground(): string {
    // The parent sets --viewport-background-color on the mainWindow; fall
    // through to the document root and finally to a neutral grey if none of
    // those resolve (e.g. the iframe is being run standalone for a test).
    try {
        const parent = window.parent.document;
        const mw = parent.querySelector("chili3d-main-window") as HTMLElement | null;
        const cs = getComputedStyle(mw ?? parent.documentElement);
        const val = cs.getPropertyValue("--viewport-background-color").trim();
        if (val) return val;
    } catch {
        // cross-origin or DOM not ready — use the fallback
    }
    return "#ffffff";
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to load viewport image"));
        img.src = src;
    });
}

function fitInside(w: number, h: number, max: number) {
    if (w <= max && h <= max) return { width: w, height: h };
    const scale = Math.min(max / w, max / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function bytesToBase64(bytes: Uint8Array): string {
    // btoa on the full string is fine for our sizes (< a few MB). Chunking
    // keeps us below String.fromCharCode's argument-length limit.
    const CHUNK = 0x8000;
    let s = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
}

// Translate a plane's origin by a given XYZ. Plane is immutable but exposes
// translateTo in newer code paths; to stay compatible we build a fresh Plane.
function planeAt(origin: XYZ, normal?: XYZ) {
    const core = getCore();
    const n = normal ?? defaultNormal();
    // Pick any X axis that isn't parallel to the normal.
    const xvec = Math.abs(n.dot(core.XYZ.unitX)) > 0.99 ? core.XYZ.unitY : core.XYZ.unitX;
    return new core.Plane({ origin, normal: n, xvec });
}

type Executor<T extends ToolName> = (input: ToolInput<T>) => Promise<unknown> | unknown;

type Registry = { [K in ToolName]: Executor<K> };

export const registry: Registry = {
    new_document: async ({ name }) => {
        const app = getApplication();
        const doc = await app.newDocument(name ?? `Untitled ${app.documents.size + 1}`);
        return { documentId: doc.id, name: doc.name };
    },

    save_document: async () => {
        const doc = requireActiveDocument();
        await doc.save();
        return { ok: true };
    },

    get_document_state: () => {
        const doc = requireActiveDocument();
        const root = doc.modelManager.rootNode;
        const nodes: ReturnType<typeof nodeSummary>[] = [];
        let cur = root.firstChild;
        while (cur) {
            nodes.push(nodeSummary(cur));
            cur = cur.nextSibling;
        }
        return {
            id: doc.id,
            name: doc.name,
            topLevelNodes: nodes,
            nodeCount: nodes.length,
        };
    },

    get_application_state: () => {
        const app = getApplication();
        const activeId = app.activeView?.document?.id;
        const documents = Array.from(app.documents).map((d) => ({
            id: d.id,
            name: d.name,
            active: d.id === activeId,
        }));
        return { documents, activeDocumentId: activeId };
    },

    get_selection: () => {
        const doc = requireActiveDocument();
        const selected = doc.selection.getSelectedNodes();
        return { nodes: selected.map(nodeSummary), count: selected.length };
    },

    select_nodes: ({ nodeIds, toggle }) => {
        const doc = requireActiveDocument();
        const nodes = nodeIds
            .map((id) => doc.modelManager.findNode((n) => n.id === id))
            .filter((n): n is INode => !!n);
        const count = doc.selection.setSelection(nodes, toggle ?? false);
        return { selected: count };
    },

    fit_view: () => {
        // Don't route through PubSub — "act.alignCamera" looks plausible but
        // actually creates an Act bookmark from the camera, it doesn't fit.
        // Calling the camera controller directly matches what the viewport's
        // built-in "Fit Content" button does (viewport/viewport.ts).
        requireCameraController().fitContent();
        return { ok: true };
    },

    get_camera_state: () => {
        const cc = requireCameraController();
        return {
            eye: cc.cameraPosition.toArray(),
            target: cc.cameraTarget.toArray(),
            up: cc.cameraUp.toArray(),
            type: cc.cameraType,
        };
    },

    set_camera: ({ eye, target, up, type }) => {
        const cc = requireCameraController();
        const eyeXYZ = eye ? xyz(eye as Vec3) : cc.cameraPosition;
        const targetXYZ = target ? xyz(target as Vec3) : cc.cameraTarget;
        const upXYZ = up ? xyz(up as Vec3) : cc.cameraUp;
        cc.lookAt(eyeXYZ, targetXYZ, upXYZ);
        if (type) cc.cameraType = type;
        return {
            eye: eyeXYZ.toArray(),
            target: targetXYZ.toArray(),
            up: upXYZ.toArray(),
            type: cc.cameraType,
        };
    },

    view_from: ({ direction, nodeIds, padding }) => {
        const doc = requireActiveDocument();
        const cc = requireCameraController();
        const box = collectBoundingBox(doc, nodeIds);
        const core = getCore();
        const center = box ? core.BoundingBox.center(box) : core.XYZ.zero;
        const radius = box ? boundingBoxSize(box) : 100;
        const scale = (padding ?? 1.5) * radius;
        const dir = normalize(VIEW_DIRECTIONS[direction].eye);
        const upRaw = VIEW_DIRECTIONS[direction].up;
        const eye = new core.XYZ({
            x: center.x + dir[0] * scale,
            y: center.y + dir[1] * scale,
            z: center.z + dir[2] * scale,
        });
        const up = new core.XYZ({ x: upRaw[0], y: upRaw[1], z: upRaw[2] });
        cc.lookAt(eye, center, up);
        return {
            direction,
            eye: eye.toArray(),
            target: center.toArray(),
            framedNodeCount: nodeIds?.length ?? null,
        };
    },

    capture_view: async ({ maxSize, format, quality }) => {
        const app = getApplication();
        const view = app.activeView;
        if (!view) throw new Error("No active view to capture");
        const mediaType = format === "png" ? "image/png" : "image/jpeg";
        const img = await capturedImage(view.toImage(), {
            maxSize: maxSize ?? 1280,
            mediaType,
            quality: quality ?? 0.82,
            background: readViewportBackground(),
        });
        const cc = requireCameraController();
        return {
            image: { mediaType, data: img.base64, width: img.width, height: img.height },
            camera: {
                eye: cc.cameraPosition.toArray(),
                target: cc.cameraTarget.toArray(),
                up: cc.cameraUp.toArray(),
                type: cc.cameraType,
            },
        };
    },

    frame_nodes: ({ nodeIds, padding }) => {
        const doc = requireActiveDocument();
        const cc = requireCameraController();
        const core = getCore();
        const box = collectBoundingBox(doc, nodeIds);
        if (!box) throw new Error("None of the given nodes have geometry yet");
        const center = core.BoundingBox.center(box);
        const radius = boundingBoxSize(box);
        const scale = (padding ?? 1.5) * radius;
        // Keep the current viewing direction — just move the eye so the box
        // is framed. We compute the unit vector from target to current eye
        // and place the new eye along that same axis at `scale` distance.
        const cur = cc.cameraPosition;
        const dir = normalize([
            cur.x - cc.cameraTarget.x,
            cur.y - cc.cameraTarget.y,
            cur.z - cc.cameraTarget.z,
        ]);
        const eye = new core.XYZ({
            x: center.x + dir[0] * scale,
            y: center.y + dir[1] * scale,
            z: center.z + dir[2] * scale,
        });
        cc.lookAt(eye, center, cc.cameraUp);
        return {
            framed: nodeIds.length,
            target: center.toArray(),
            eye: eye.toArray(),
        };
    },

    create_box: ({ dx, dy, dz, origin, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        const plane = planeAt(xyz((origin ?? [0, 0, 0]) as Vec3));
        return withTransaction(doc, "ai.create_box", () => {
            const node = new app.BoxNode({ document: doc, plane, dx, dy, dz });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_sphere: ({ center, radius, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        return withTransaction(doc, "ai.create_sphere", () => {
            const node = new app.SphereNode({ document: doc, center: xyz(center as Vec3), radius });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_cylinder: ({ center, radius, height, normal, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        const n = normal ? xyz(normal as Vec3) : defaultNormal();
        return withTransaction(doc, "ai.create_cylinder", () => {
            const node = new app.CylinderNode({
                document: doc,
                normal: n,
                center: xyz(center as Vec3),
                radius,
                dz: height,
            });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_cone: ({ center, radius, height, normal, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        const n = normal ? xyz(normal as Vec3) : defaultNormal();
        return withTransaction(doc, "ai.create_cone", () => {
            const node = new app.ConeNode({
                document: doc,
                normal: n,
                center: xyz(center as Vec3),
                radius,
                dz: height,
            });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_rect: ({ origin, dx, dy, plane, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        const base = planeFromName(plane ?? "XY");
        const core = getCore();
        const moved = new core.Plane({
            origin: xyz(origin as Vec3),
            normal: base.normal,
            xvec: base.xvec,
        });
        return withTransaction(doc, "ai.create_rect", () => {
            const node = new app.RectNode({ document: doc, plane: moved, dx, dy });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_circle: ({ center, radius, normal, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        const n = normal ? xyz(normal as Vec3) : defaultNormal();
        return withTransaction(doc, "ai.create_circle", () => {
            const node = new app.CircleNode({
                document: doc,
                normal: n,
                center: xyz(center as Vec3),
                radius,
            });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    create_line: ({ start, end, name }) => {
        const app = getAppModule();
        const doc = requireActiveDocument();
        return withTransaction(doc, "ai.create_line", () => {
            const node = new app.LineNode({
                document: doc,
                start: xyz(start as Vec3),
                end: xyz(end as Vec3),
            });
            if (name) node.name = name;
            doc.modelManager.addNode(node);
            return nodeSummary(node);
        });
    },

    delete_nodes: ({ nodeIds }) => {
        const doc = requireActiveDocument();
        const nodes =
            nodeIds.length > 0
                ? nodeIds
                      .map((id) => doc.modelManager.findNode((n) => n.id === id))
                      .filter((n): n is INode => !!n)
                : doc.selection.getSelectedNodes();
        if (nodes.length === 0) return { deleted: 0 };
        withTransaction(doc, "ai.delete", () => {
            nodes.forEach((n) => n.parent?.remove(n));
        });
        return { deleted: nodes.length };
    },

    move_nodes: ({ nodeIds, offset }) => {
        const doc = requireActiveDocument();
        const core = getCore();
        const nodes = nodeIds
            .map((id) => doc.modelManager.findNode((n) => n.id === id))
            .filter((n): n is InstanceType<typeof core.VisualNode> => n instanceof core.VisualNode);
        if (nodes.length === 0) throw new Error("No matching nodes to move");
        const translation = core.Matrix4.fromTranslation(offset[0], offset[1], offset[2]);
        withTransaction(doc, "ai.move", () => {
            for (const n of nodes) {
                n.transform = translation.multiply(n.transform);
            }
        });
        return { moved: nodes.map(nodeSummary) };
    },

    boolean_union: ({ nodeIds }) => {
        return booleanOp(nodeIds[0], nodeIds.slice(1), "fuse", "ai.boolean_union");
    },

    boolean_subtract: ({ subjectNodeId, toolNodeIds }) => {
        return booleanOp(subjectNodeId, toolNodeIds, "cut", "ai.boolean_subtract");
    },

    boolean_intersect: ({ nodeIds }) => {
        return booleanOp(nodeIds[0], nodeIds.slice(1), "common", "ai.boolean_intersect");
    },

    list_materials: () => {
        const doc = requireActiveDocument();
        const mats: ReturnType<typeof materialSummary>[] = [];
        doc.modelManager.materials.forEach((m) => mats.push(materialSummary(m)));
        return { materials: mats, count: mats.length };
    },

    create_material: ({ name, color, opacity, kind, metalness, roughness }) => {
        const core = getCore();
        const doc = requireActiveDocument();
        return withTransaction(doc, "ai.create_material", () => {
            let material: Material;
            const opts = { document: doc, name, color };
            if (kind === "phong") {
                material = new core.PhongMaterial(opts);
            } else if (kind === "physical") {
                const pm = new core.PhysicalMaterial(opts);
                if (metalness !== undefined) pm.metalness = metalness;
                if (roughness !== undefined) pm.roughness = roughness;
                material = pm;
            } else {
                material = new core.Material(opts);
            }
            if (opacity !== undefined) material.opacity = opacity;
            doc.modelManager.materials.push(material);
            return materialSummary(material);
        });
    },

    update_material: ({ materialId, name, color, opacity }) => {
        const doc = requireActiveDocument();
        const material = findMaterial(doc, materialId);
        return withTransaction(doc, "ai.update_material", () => {
            if (name !== undefined) material.name = name;
            if (color !== undefined) material.color = color;
            if (opacity !== undefined) material.opacity = opacity;
            return materialSummary(material);
        });
    },

    assign_material: ({ nodeIds, materialId }) => {
        const core = getCore();
        const doc = requireActiveDocument();
        findMaterial(doc, materialId); // validate early — throws if unknown
        const nodes = nodeIds
            .map((id) => doc.modelManager.findNode((n) => n.id === id))
            .filter((n): n is INode => !!n);
        const geometryNodes = nodes.filter((n) => n instanceof core.GeometryNode) as InstanceType<
            typeof core.GeometryNode
        >[];
        if (geometryNodes.length === 0) {
            throw new Error("No geometry nodes found among the given ids");
        }
        withTransaction(doc, "ai.assign_material", () => {
            for (const n of geometryNodes) {
                n.materialId = materialId;
            }
        });
        return {
            assigned: geometryNodes.map((n) => ({ id: n.id, name: n.name })),
        };
    },

    delete_material: ({ materialId }) => {
        const doc = requireActiveDocument();
        const material = findMaterial(doc, materialId);
        const users = nodesReferencingMaterial(doc, materialId);
        if (users.length > 0) {
            throw new Error(
                `Cannot delete material: ${users.length} node(s) still reference it (${users
                    .slice(0, 5)
                    .map((n) => n.name)
                    .join(", ")}${users.length > 5 ? ", …" : ""}). Reassign them first.`,
            );
        }
        withTransaction(doc, "ai.delete_material", () => {
            doc.modelManager.materials.remove(material);
        });
        return { deleted: materialId };
    },

    execute_command: ({ key }) => {
        const core = getCore();
        // CommandKeys is a string-literal union; the AI supplies an arbitrary
        // key at runtime, so we cast. Unknown keys are simply ignored by the
        // CommandService with a log, so this is safe.
        core.PubSub.default.pub("executeCommand", key as never);
        return { dispatched: key };
    },
};

function booleanOp(subjectId: string, toolIds: string[], kind: "fuse" | "cut" | "common", txName: string) {
    const app = getAppModule();
    const doc = requireActiveDocument();
    const subject = shapeOf(doc, subjectId);
    const tools = toolIds.map((id) => shapeOf(doc, id));
    const factory = doc.application.shapeFactory;
    const r =
        kind === "fuse"
            ? factory.booleanFuse([subject], tools)
            : kind === "cut"
              ? factory.booleanCut([subject], tools)
              : factory.booleanCommon([subject], tools);
    if (!r.isOk) throw new Error(`Boolean ${kind} failed: ${r.error}`);
    return withTransaction(doc, txName, () => {
        const node = new app.BooleanNode({ document: doc, booleanShape: r.value });
        const all = [subjectId, ...toolIds];
        for (const id of all) {
            const n = doc.modelManager.findNode((x) => x.id === id);
            n?.parent?.remove(n);
        }
        doc.modelManager.addNode(node);
        return nodeSummary(node);
    });
}

export async function executeTool<T extends ToolName>(name: T, rawInput: unknown): Promise<unknown> {
    const schema = schemas[name];
    if (!schema) throw new Error(`Unknown tool: ${name}`);
    const input = schema.parse(rawInput) as ToolInput<T>;
    const exec = registry[name] as Executor<T>;
    return await exec(input);
}
