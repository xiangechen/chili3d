// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, Material, Transaction, type XYZLike } from "@chili3d/core";
import type { Tool, ToolResult } from "../llm/types";

const Z_UP: XYZLike = { x: 0, y: 0, z: 1 };

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

function getDocument(): IDocument | undefined {
    return globalThis.app.activeView?.document;
}

export function parseColor(v: unknown): number {
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
        return Number.parseInt([...s].map((c) => c + c).join(""), 16);
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) return Number.parseInt(s, 16);
    const named: Record<string, number> = {
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
    return named[s.toLowerCase()] ?? 0xcccccc;
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
            const dataUrl = view.toImage();
            const comma = dataUrl.indexOf(",");
            const mediaType = dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";")) || "image/png";
            return {
                content: JSON.stringify({ ok: true, mediaType }),
                images: [{ mediaType, data: dataUrl.slice(comma + 1) }],
            };
        },
    };
}

function setMaterialTool(): Tool {
    return {
        name: "set_material",
        description:
            "Set the material color of a node by id. color is a hex string (#ff0000), a name (red), or a number (0xff0000).",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "Node id" },
                color: { type: "string", description: "Color, e.g. '#ff0000' or 'red'" },
            },
            required: ["id", "color"],
        },
        handler: async (args) => {
            const doc = getDocument();
            if (!doc) return textResult({ error: I18n.translate("ai.error.noDocument") });
            const id = args["id"] as string;
            const node = doc.modelManager.findNodes((n) => n.id === id)[0];
            if (!node || !("materialId" in node)) {
                return textResult({ error: `node not found or has no material: ${id}` });
            }
            const color = parseColor(args["color"]);
            // Material.color is number | string; normalize both sides before comparing.
            let material = doc.modelManager.materials.find((m) => parseColor(m.color) === color);
            if (!material) {
                material = new Material({ document: doc, name: `AI ${color.toString(16)}`, color });
                doc.modelManager.materials.push(material);
            }
            Transaction.execute(doc, "AI set material", () => {
                (node as { materialId: string | string[] }).materialId = material.id;
            });
            doc.visual.update();
            return textResult({ id, color, materialId: material.id });
        },
    };
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
            "Isolate nodes by id: hide everything else in the viewport without changing node visibility. Pass an empty array to clear the isolation and show everything again. Combine with fit_content to focus on the isolated nodes.",
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
        handler: async (args) => {
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
            view.isolate(nodes);
            view.update();
            return textResult({ ok: true, isolated: ids });
        },
    };
}

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
        handler: async (args) => {
            const view = globalThis.app.activeView;
            if (!view) return textResult({ error: "no active view" });
            const a = args as { view?: string; azimuth?: number; elevation?: number };

            const camera = view.cameraController;
            const target = camera.cameraTarget;
            const position = camera.cameraPosition;
            const dx = position.x - target.x;
            const dy = position.y - target.y;
            const dz = position.z - target.z;
            const distance = Math.hypot(dx, dy, dz) || 1;

            let eye: XYZLike;
            let up: XYZLike = Z_UP;
            if (a.view !== undefined) {
                const preset = VIEW_PRESETS[a.view];
                if (!preset) {
                    return textResult({
                        error: `unknown view "${a.view}", expected one of ${Object.keys(VIEW_PRESETS).join("|")}`,
                    });
                }
                ({ eye, up } = presetEye(preset, target, distance));
            } else {
                if (a.azimuth === undefined && a.elevation === undefined) {
                    return textResult({ error: "provide view or azimuth/elevation" });
                }
                eye = orbitEye(a, dx, dy, dz, target, distance);
            }

            camera.lookAt(eye, target, up);
            view.update();
            return textResult({ ok: true, eye: toPlainPoint(eye) });
        },
    };
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
        handler: async (args) => {
            const view = globalThis.app.activeView;
            if (!view) return textResult({ error: "no active view" });
            const camera = view.cameraController;
            const type = args["type"] as string | undefined;
            if (type !== undefined && type !== "perspective" && type !== "orthographic") {
                return textResult({
                    error: `unknown camera type "${type}", expected perspective|orthographic`,
                });
            }
            camera.cameraType =
                type ?? (camera.cameraType === "perspective" ? "orthographic" : "perspective");
            view.update();
            return textResult({ ok: true, cameraType: camera.cameraType });
        },
    };
}

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
