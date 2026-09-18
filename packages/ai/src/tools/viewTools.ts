// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, Material, Transaction, type XYZLike } from "@chili3d/core";
import type { Tool, ToolResult } from "../llm/types";
import { getDocument } from "./documentContext";

const Z_UP: XYZLike = { x: 0, y: 0, z: 1 };

/** The gray a node shows when no colour was ever set. */
const DEFAULT_MATERIAL_COLOR = 0xcccccc;

/** Preset standard views: dir is the camera offset from the target (Z-up world). */
const VIEW_PRESETS: Record<string, { dir: [number, number, number]; up: XYZLike }> = {
    front: { dir: [0, -1, 0], up: Z_UP },
    back: { dir: [0, 1, 0], up: Z_UP },
    left: { dir: [-1, 0, 0], up: Z_UP },
    right: { dir: [1, 0, 0], up: Z_UP },
    top: { dir: [0, 0, 1], up: { x: 0, y: 1, z: 0 } },
    bottom: { dir: [0, 0, -1], up: { x: 0, y: -1, z: 0 } },
    iso: { dir: [1, -1, 1], up: Z_UP },
};

const NAMED_COLORS: Record<string, number> = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    white: 0xffffff,
    black: 0x000000,
    gray: 0x888888,
    grey: 0x888888,
    yellow: 0xffff00,
    orange: 0xff8800,
};

export function parseColor(v: unknown): number {
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
        return Number.parseInt([...s].map((c) => c + c).join(""), 16);
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) return Number.parseInt(s, 16);
    return NAMED_COLORS[s.toLowerCase()] ?? DEFAULT_MATERIAL_COLOR;
}

/**
 * The tool's colour input, where an unrecognized value is an error rather than the silent gray
 * `parseColor` falls back to (that fallback is for reading back colours already stored).
 */
export function parseToolColor(v: unknown): number | string {
    const names = Object.keys(NAMED_COLORS).join(", ");
    if (typeof v === "number") {
        if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
        return "color as a number must be an integer in 0x000000..0xffffff";
    }
    const s = String(v).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s) || /^[0-9a-fA-F]{6}$/.test(s)) return parseColor(v);
    if (NAMED_COLORS[s.toLowerCase()] !== undefined) return parseColor(v);
    return `unknown color "${v}" — use a hex string ("#ff0000"), one of ${names}, or a number like 0xff0000`;
}

export function buildViewTools(): Tool[] {
    return [
        captureScreenshotTool(),
        setMaterialTool(),
        fitContentTool(),
        isolateViewTool(),
        rotateViewTool(),
        setCameraTypeTool(),
    ];
}

/**
 * The viewport image as a tool result: the JSON payload plus the screenshot itself, so the model
 * sees the result and the picture in one step. Shared with `click_view`, whose whole point after a
 * select is to show the highlight.
 */
export function imageResult(view: { toImage(): string }, payload: Record<string, unknown>): ToolResult {
    const dataUrl = view.toImage();
    const comma = dataUrl.indexOf(",");
    const mediaType = dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";")) || "image/png";
    return {
        content: JSON.stringify({ ...payload, mediaType }),
        images: [{ mediaType, data: dataUrl.slice(comma + 1) }],
    };
}

function textResult(value: unknown): ToolResult {
    return { content: JSON.stringify(value) };
}

function captureScreenshotTool(): Tool {
    return {
        name: "capture_screenshot",
        description: "Capture the current viewport as an image so you can see the model's current state.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
            const view = globalThis.app.activeView;
            if (!view) return textResult({ error: "no active view" });
            return imageResult(view, { ok: true });
        },
    };
}

function setMaterialTool(): Tool {
    return {
        name: "set_material",
        description:
            "Set the appearance of a node by id: color, opacity and/or surface texture. Pass at least one of the three; the omitted ones keep their current value. Materials are shared between nodes, so a material with exactly these values is reused when one exists and created otherwise — the other nodes are never changed.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "Node id" },
                color: {
                    anyOf: [{ type: "string" }, { type: "number" }],
                    description: `Color: "#ff0000", a name (${Object.keys(NAMED_COLORS).join("/")}), or 0xRRGGBB`,
                },
                opacity: {
                    type: "number",
                    description: "0 = fully transparent, 1 = opaque (0..1)",
                },
                texture: {
                    type: "string",
                    description:
                        'Surface texture as an image data URL ("data:image/png;base64,..."), an http(s)/blob URL or a same-origin path; "" removes the texture',
                },
            },
            required: ["id"],
        },
        handler: setMaterialHandler,
    };
}

const setMaterialHandler: Tool["handler"] = async (args) => {
    const doc = getDocument();
    if (!doc) return textResult({ error: I18n.translate("ai.error.noDocument") });
    const id = args["id"] as string;
    const node = doc.modelManager.findNodes((n) => n.id === id)[0];
    if (!node || !("materialId" in node)) {
        return textResult({ error: `node not found or has no material: ${id}` });
    }

    const appearance = resolveAppearance(doc, node, args);
    if (typeof appearance === "string") return textResult({ error: appearance });

    const material = ensureMaterial(doc, appearance.color, appearance.opacity, appearance.texture);
    Transaction.execute(doc, "AI set material", () => {
        (node as { materialId: string | string[] }).materialId = material.id;
    });
    doc.visual.update();
    return textResult({
        id,
        ...appearance,
        texture: appearance.texture === "" ? null : appearance.texture,
        materialId: material.id,
    });
};

/** color / opacity / texture to apply, or the message saying why the arguments do not work. */
function resolveAppearance(
    doc: IDocument,
    node: unknown,
    args: Record<string, unknown>,
): { color: number; opacity: number; texture: string } | string {
    if (args["color"] === undefined && args["opacity"] === undefined && args["texture"] === undefined) {
        return "provide at least one of color, opacity, texture";
    }
    // An omitted field keeps what the node already has, so setting only the opacity does not
    // silently reset the colour of a node that was styled before.
    const current = materialOf(doc, node);
    const color = resolveColor(args["color"], current);
    if ("error" in color) return color.error;
    const opacity = resolveOpacity(args["opacity"], current);
    if ("error" in opacity) return opacity.error;
    const texture = resolveTexture(args["texture"], current);
    if ("error" in texture) return texture.error;
    return { color: color.value, opacity: opacity.value, texture: texture.value };
}

type Resolved<T> = { value: T } | { error: string };

function resolveColor(arg: unknown, current: Material | undefined): Resolved<number> {
    if (arg !== undefined) {
        const color = parseToolColor(arg);
        return typeof color === "string" ? { error: color } : { value: color };
    }
    // An omitted colour keeps the node's own, in the numeric form ensureMaterial compares in.
    return { value: current === undefined ? DEFAULT_MATERIAL_COLOR : parseColor(current.color) };
}

function resolveOpacity(arg: unknown, current: Material | undefined): Resolved<number> {
    const opacity = arg === undefined ? (current?.opacity ?? 1) : arg;
    return typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
        ? { value: opacity }
        : { error: `opacity must be a number in [0,1], got ${describe(opacity)}` };
}

function resolveTexture(arg: unknown, current: Material | undefined): Resolved<string> {
    const texture = arg === undefined ? (current?.map.image ?? "") : arg;
    if (typeof texture !== "string") return { error: "texture must be a string" };
    if (texture === "" || isTextureSource(texture)) return { value: texture };
    return {
        error: `texture must be an image data URL ("data:image/png;base64,..."), an http(s)/blob URL, a path, or "" to remove it — got ${describe(texture)}`,
    };
}

/** The material the node points at, so an omitted argument can keep its current value. */
function materialOf(doc: IDocument, node: unknown): Material | undefined {
    const materialId = (node as { materialId?: string | string[] }).materialId;
    const first = Array.isArray(materialId) ? materialId[0] : materialId;
    return doc.modelManager.materials.find((m) => m.id === first);
}

/** A string the texture loader can actually fetch; anything else is a typo the model should see. */
function isTextureSource(texture: string): boolean {
    return /^(data:image\/|https?:\/\/|blob:|\/|\.{1,2}\/)/.test(texture);
}

function describe(value: unknown): string {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Finds the document's material with exactly these values, creating one when none matches. */
function ensureMaterial(doc: IDocument, color: number, opacity: number, texture: string): Material {
    // Material.color is number | string; normalize both sides before comparing.
    const existing = doc.modelManager.materials.find(
        (m) => parseColor(m.color) === color && m.opacity === opacity && m.map.image === texture,
    );
    if (existing) return existing;

    const material = new Material({ document: doc, name: `AI ${color.toString(16)}`, color });
    material.opacity = opacity;
    material.map.image = texture;
    doc.modelManager.materials.push(material);
    return material;
}

function fitContentTool(): Tool {
    return {
        name: "fit_content",
        description:
            "Zoom the viewport camera to fit content. When nodes are selected, it fits only the selection; otherwise it fits all visible content. Call after creating or modifying models so the result is in view.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
            const view = globalThis.app.activeView;
            if (!view) return textResult({ error: "no active view" });
            view.cameraController.fitContent();
            view.update();
            return textResult({ ok: true });
        },
    };
}

function isolateViewTool(): Tool {
    return {
        name: "isolate_view",
        description:
            "Show only the given nodes: hide everything else in the viewport without changing node visibility. Replaces any previous isolation, so pass just the set you want visible; an empty array clears the isolation and shows everything again.",
        parameters: {
            type: "object",
            properties: {
                ids: {
                    type: "array",
                    items: { type: "string" },
                    description: "Node ids to isolate; an empty array clears the isolation",
                },
            },
            required: ["ids"],
        },
        handler: isolateViewHandler,
    };
}

const isolateViewHandler: Tool["handler"] = async (args) => {
    const doc = getDocument();
    const view = globalThis.app.activeView;
    if (!doc || !view) {
        return textResult({ error: I18n.translate("ai.error.noDocument") });
    }
    const ids = (args as { ids?: unknown }).ids;
    if (!Array.isArray(ids)) {
        return textResult({ error: "ids must be an array of node ids" });
    }
    if (ids.length === 0) {
        view.unisolate();
        view.update();
        return textResult({ ok: true, isolated: [] });
    }
    const nodes = ids.map((id) => doc.modelManager.findNodes((n) => n.id === String(id))[0]);
    const missing = ids.filter((_, i) => !nodes[i]);
    if (missing.length) {
        return textResult({ error: `nodes not found: ${missing.join(", ")}` });
    }
    // `view.isolate` accumulates (the viewport treats a second call as widening the isolation),
    // but this tool is documented as "isolate these nodes", so each call replaces the set.
    view.unisolate();
    view.isolate(nodes);
    view.update();
    return textResult({ ok: true, isolated: ids });
};

function rotateViewTool(): Tool {
    return {
        name: "rotate_view",
        description:
            "Rotate the viewport camera around the current target, keeping its distance. Either a preset standard view, or relative orbit angles in degrees (azimuth orbits around the Z axis, elevation climbs above the XY plane). Combine with capture_screenshot to inspect the model from another angle.",
        parameters: {
            type: "object",
            properties: {
                view: {
                    type: "string",
                    enum: ["front", "back", "left", "right", "top", "bottom", "iso"],
                    description: "Preset standard view; takes precedence over azimuth/elevation",
                },
                azimuth: {
                    type: "number",
                    description: "Relative horizontal orbit in degrees, around the Z axis",
                },
                elevation: { type: "number", description: "Relative vertical orbit in degrees" },
            },
        },
        handler: rotateViewHandler,
    };
}

const rotateViewHandler: Tool["handler"] = async (args) => {
    const view = globalThis.app.activeView;
    if (!view) return textResult({ error: "no active view" });

    const camera = view.cameraController;
    const target = camera.cameraTarget;
    const position = camera.cameraPosition;
    const dx = position.x - target.x;
    const dy = position.y - target.y;
    const dz = position.z - target.z;
    const distance = Math.hypot(dx, dy, dz) || 1;

    const orientation = resolveOrientation(
        args as { view?: string; azimuth?: number; elevation?: number },
        target,
        { x: dx, y: dy, z: dz },
        distance,
    );
    if (typeof orientation === "string") return textResult({ error: orientation });

    camera.lookAt(orientation.eye, target, orientation.up);
    view.update();
    return textResult({ ok: true, eye: toPlainPoint(orientation.eye) });
};

type CameraOrientation = { eye: XYZLike; up: XYZLike };

/** Resolves a preset or relative orbit; returns the message to report when the args are unusable. */
function resolveOrientation(
    a: { view?: string; azimuth?: number; elevation?: number },
    target: XYZLike,
    offset: XYZLike,
    distance: number,
): CameraOrientation | string {
    if (a.view !== undefined) {
        const preset = VIEW_PRESETS[a.view];
        if (!preset) {
            return `unknown view "${a.view}", expected one of ${Object.keys(VIEW_PRESETS).join("|")}`;
        }
        return presetEye(preset, target, distance);
    }
    if (a.azimuth === undefined && a.elevation === undefined) {
        return "provide view or azimuth/elevation";
    }
    return { eye: orbitEye(a, offset.x, offset.y, offset.z, target, distance), up: Z_UP };
}

function setCameraTypeTool(): Tool {
    return {
        name: "set_camera_type",
        description:
            "Switch the viewport camera projection: perspective (natural depth) or orthographic (no foreshortening — suited for technical views and alignment checks). Omit the type to toggle between the two.",
        parameters: {
            type: "object",
            properties: {
                type: {
                    type: "string",
                    enum: ["perspective", "orthographic"],
                    description: "Projection to switch to; omit to toggle",
                },
            },
        },
        handler: setCameraTypeHandler,
    };
}

const setCameraTypeHandler: Tool["handler"] = async (args) => {
    const view = globalThis.app.activeView;
    if (!view) return textResult({ error: "no active view" });
    const camera = view.cameraController;
    const type = args["type"] as string | undefined;
    if (type !== undefined && type !== "perspective" && type !== "orthographic") {
        return textResult({
            error: `unknown camera type "${type}", expected perspective|orthographic`,
        });
    }
    camera.cameraType = type ?? (camera.cameraType === "perspective" ? "orthographic" : "perspective");
    view.update();
    return textResult({ ok: true, cameraType: camera.cameraType });
};

function presetEye(
    preset: { dir: [number, number, number]; up: XYZLike },
    target: XYZLike,
    distance: number,
): { eye: XYZLike; up: XYZLike } {
    const len = Math.hypot(...preset.dir);
    const eye = {
        x: target.x + (preset.dir[0] / len) * distance,
        y: target.y + (preset.dir[1] / len) * distance,
        z: target.z + (preset.dir[2] / len) * distance,
    };
    return { eye, up: preset.up };
}

function orbitEye(
    a: { azimuth?: number; elevation?: number },
    dx: number,
    dy: number,
    dz: number,
    target: XYZLike,
    distance: number,
): XYZLike {
    const azimuth = Math.atan2(dy, dx) + ((a.azimuth ?? 0) * Math.PI) / 180;
    const limit = (Math.PI / 180) * 89.9;
    const elevation = Math.min(
        limit,
        Math.max(-limit, Math.atan2(dz, Math.hypot(dx, dy)) + ((a.elevation ?? 0) * Math.PI) / 180),
    );
    return {
        x: target.x + distance * Math.cos(elevation) * Math.cos(azimuth),
        y: target.y + distance * Math.cos(elevation) * Math.sin(azimuth),
        z: target.z + distance * Math.sin(elevation),
    };
}

function toPlainPoint(p: XYZLike) {
    const round = (v: number) => Math.round(v * 100) / 100;
    return { x: round(p.x), y: round(p.y), z: round(p.z) };
}
