// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Dependency-free software renderer: orthographic isometric projection + z-buffer
// triangle rasterization with flat (normal·light) shading. Produces an RGBA buffer
// for png.ts. No GPU, no native canvas — runs anywhere Node runs.

export interface RasterMesh {
    position: ArrayLike<number>;
    index: ArrayLike<number>;
}

export type ViewName = "iso" | "front" | "top" | "right";

export interface RenderOptions {
    width?: number;
    height?: number;
    /** Camera direction. Defaults to "iso" (the classic isometric corner). */
    view?: ViewName;
}

// Forward vector = scene → viewer. Front looks along +Y (projects the XZ face),
// top looks down -Z (projects XY), right looks along -X (projects YZ). The screen
// right/up axes are derived from f below, exactly as for the iso view.
const VIEW_FORWARD: Record<ViewName, V3> = {
    iso: [1, 1, 1],
    front: [0, -1, 0],
    top: [0, 0, 1],
    right: [1, 0, 0],
};

export interface Raster {
    width: number;
    height: number;
    rgba: Uint8Array;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
function normalize(v: V3): V3 {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}
const vertex = (p: ArrayLike<number>, i: number): V3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];

const BACKGROUND: V3 = [240, 240, 245];
const BASE_COLOR: V3 = [170, 178, 196];

/** Render triangle meshes to an RGBA buffer from a fixed isometric viewpoint. */
export function renderMeshesToRgba(meshes: RasterMesh[], options?: RenderOptions): Raster {
    const W = options?.width ?? 512;
    const H = options?.height ?? 512;
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        rgba[i * 4] = BACKGROUND[0];
        rgba[i * 4 + 1] = BACKGROUND[1];
        rgba[i * 4 + 2] = BACKGROUND[2];
        rgba[i * 4 + 3] = 255;
    }

    // Camera basis: f points from the scene toward the viewer.
    const f = normalize(VIEW_FORWARD[options?.view ?? "iso"]);
    let right = cross([0, 0, 1], f);
    right = right[0] === 0 && right[1] === 0 && right[2] === 0 ? [1, 0, 0] : normalize(right);
    const up = normalize(cross(f, right));
    const light = normalize([0.4, 0.5, 1]);

    // Project all vertices to (screenX, screenY) to find the fit transform.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const project = (p: V3): [number, number, number] => [dot(p, right), dot(p, up), dot(p, f)];
    for (const mesh of meshes) {
        const verts = mesh.position.length / 3;
        for (let v = 0; v < verts; v++) {
            const [sx, sy] = project(vertex(mesh.position, v));
            if (sx < minX) minX = sx;
            if (sy < minY) minY = sy;
            if (sx > maxX) maxX = sx;
            if (sy > maxY) maxY = sy;
        }
    }
    if (!Number.isFinite(minX)) {
        return { width: W, height: H, rgba }; // nothing to draw
    }

    const margin = 0.08 * Math.min(W, H);
    const span = Math.max(maxX - minX, maxY - minY, 1e-9);
    const scale = (Math.min(W, H) - 2 * margin) / span;
    const offX = margin + (Math.min(W, H) - 2 * margin - (maxX - minX) * scale) / 2;
    const offY = margin + (Math.min(W, H) - 2 * margin - (maxY - minY) * scale) / 2;
    const toPixel = (sx: number, sy: number): [number, number] => [
        offX + (sx - minX) * scale,
        H - (offY + (sy - minY) * scale), // flip Y so +up is up
    ];

    const zbuf = new Float32Array(W * H).fill(-Infinity);

    for (const mesh of meshes) {
        const { position, index } = mesh;
        const tris = Math.floor(index.length / 3);
        for (let t = 0; t < tris; t++) {
            const wa = vertex(position, index[t * 3]);
            const wb = vertex(position, index[t * 3 + 1]);
            const wc = vertex(position, index[t * 3 + 2]);

            let n = normalize(cross(sub(wb, wa), sub(wc, wa)));
            if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue; // degenerate
            if (dot(n, f) < 0) n = [-n[0], -n[1], -n[2]]; // face the viewer for shading
            const shade = 0.28 + 0.72 * Math.max(0, dot(n, light));

            const pa = project(wa);
            const pb = project(wb);
            const pc = project(wc);
            const [ax, ay] = toPixel(pa[0], pa[1]);
            const [bx, by] = toPixel(pb[0], pb[1]);
            const [cx, cy] = toPixel(pc[0], pc[1]);
            const az = pa[2];
            const bz = pb[2];
            const cz = pc[2];

            const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if (Math.abs(area) < 1e-9) continue;

            const minPX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
            const maxPX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
            const minPY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
            const maxPY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));

            const cr = Math.min(255, BASE_COLOR[0] * shade);
            const cg = Math.min(255, BASE_COLOR[1] * shade);
            const cb = Math.min(255, BASE_COLOR[2] * shade);

            for (let py = minPY; py <= maxPY; py++) {
                for (let px = minPX; px <= maxPX; px++) {
                    const sxp = px + 0.5;
                    const syp = py + 0.5;
                    const w0 = ((bx - sxp) * (cy - syp) - (by - syp) * (cx - sxp)) / area;
                    const w1 = ((cx - sxp) * (ay - syp) - (cy - syp) * (ax - sxp)) / area;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const depth = w0 * az + w1 * bz + w2 * cz;
                    const idx = py * W + px;
                    if (depth <= zbuf[idx]) continue; // larger depth = nearer the viewer
                    zbuf[idx] = depth;
                    rgba[idx * 4] = cr;
                    rgba[idx * 4 + 1] = cg;
                    rgba[idx * 4 + 2] = cb;
                    rgba[idx * 4 + 3] = 255;
                }
            }
        }
    }

    return { width: W, height: H, rgba };
}

const DIVIDER: V3 = [120, 124, 140];

/**
 * Tile equal-size rasters into a `cols`-wide grid, left-to-right then top-to-bottom,
 * with a 1px divider between cells. Returns one combined raster.
 */
export function composeGrid(panels: Raster[], cols: number): Raster {
    const pw = panels[0].width;
    const ph = panels[0].height;
    const rows = Math.ceil(panels.length / cols);
    const W = pw * cols + (cols - 1);
    const H = ph * rows + (rows - 1);
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        rgba[i * 4] = DIVIDER[0];
        rgba[i * 4 + 1] = DIVIDER[1];
        rgba[i * 4 + 2] = DIVIDER[2];
        rgba[i * 4 + 3] = 255;
    }
    panels.forEach((panel, idx) => {
        const ox = (idx % cols) * (pw + 1);
        const oy = Math.floor(idx / cols) * (ph + 1);
        for (let y = 0; y < ph; y++) {
            const dstRow = ((oy + y) * W + ox) * 4;
            const srcRow = y * pw * 4;
            rgba.set(panel.rgba.subarray(srcRow, srcRow + pw * 4), dstRow);
        }
    });
    return { width: W, height: H, rgba };
}
