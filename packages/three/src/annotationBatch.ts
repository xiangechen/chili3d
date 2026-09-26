// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Every annotation under one parent drawn as two objects: one LineSegments2 for
 * all the dimension lines and one Mesh for all the triangles (text glyphs and
 * solid arrowheads), so draw calls stay constant however many annotations a
 * document holds — the batching dxf-render and mlightcad both converge on.
 * Annotations write their slices in parent space (their own transforms baked
 * in), highlight is a color rewrite, and picking maps a segment/triangle index
 * back to its annotation.
 */

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Object3D } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Constants } from "./constants";
import type { ThreeVisualContext } from "./threeVisualContext";

/** One annotation's contribution to the batch of its parent. */
export interface IBatchedAnnotation {
    /** False while hidden or degenerate: the annotation contributes no geometry at all. */
    readonly batchVisible: boolean;
    /** The color its slices draw in — the annotation's own, or the highlight color. */
    readonly batchColor: number;
    /** Push flat xyz endpoint pairs (parent space), two points per segment. */
    buildLineSegments(target: number[]): void;
    /** Push flat xyz corners (parent space), three points per triangle — text glyphs, arrowheads. */
    buildTriangles(target: number[]): void;
}

export class AnnotationBatch extends Object3D {
    private readonly _lines: LineSegments2;
    private readonly _triangles: Mesh;
    private readonly _writers = new Set<IBatchedAnnotation>();
    private _segmentOwners: IBatchedAnnotation[] = [];
    private _triangleOwners: IBatchedAnnotation[] = [];
    private _queued = false;
    private _disposed = false;

    constructor(
        private readonly context: ThreeVisualContext,
        private readonly onEmpty: () => void,
    ) {
        super();
        this.name = "AnnotationBatch";
        this.matrixAutoUpdate = false;

        const lineMaterial = new LineMaterial({ linewidth: 1, vertexColors: true, side: DoubleSide });
        this._lines = new LineSegments2(new LineSegmentsGeometry(), lineMaterial);
        this._triangles = new Mesh(
            new BufferGeometry(),
            new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
        );
        // Annotations are not body geometry: enable every content layer so they
        // stay visible and pickable in solid, wireframe and combined modes alike.
        for (const object of [this._lines, this._triangles]) {
            object.layers.enable(Constants.Layers.Wireframe);
            object.layers.enable(Constants.Layers.Solid);
            object.visible = false;
        }
        this.add(this._lines, this._triangles);
    }

    register(writer: IBatchedAnnotation): void {
        this._writers.add(writer);
        this.markDirty();
    }

    unregister(writer: IBatchedAnnotation): void {
        if (!this._writers.delete(writer)) return;
        this.markDirty();
        if (this._writers.size === 0) {
            // Deferred: an annotation batch is often torn down while its parent's
            // subtree is still being traversed, and removing ourselves now would
            // skip siblings in that traversal.
            queueMicrotask(() => {
                if (this._writers.size > 0 || this._disposed) return;
                this.parent?.remove(this);
                this.onEmpty();
                this.dispose();
            });
        }
    }

    markDirty(): void {
        if (this._queued || this._disposed) return;
        this._queued = true;
        queueMicrotask(() => {
            this._queued = false;
            if (!this._disposed) this.rebuild();
        });
    }

    /** The objects hover raycasts run against; a hit's faceIndex feeds `annotationOf`. */
    pickObjects(): Object3D[] {
        return [this._lines, this._triangles];
    }

    /** The annotation a raycast hit belongs to: segment index on the lines, triangle index on the mesh. */
    annotationOf(object: Object3D, faceIndex: number | undefined): IBatchedAnnotation | undefined {
        if (faceIndex === undefined) return undefined;
        if (object === this._lines) return this._segmentOwners[faceIndex];
        if (object === this._triangles) return this._triangleOwners[faceIndex];
        return undefined;
    }

    private rebuild(): void {
        const linePositions: number[] = [];
        const lineColors: number[] = [];
        const trianglePositions: number[] = [];
        const triangleColors: number[] = [];
        const segmentOwners: IBatchedAnnotation[] = [];
        const triangleOwners: IBatchedAnnotation[] = [];
        const color = new Color();

        for (const writer of this._writers) {
            if (!writer.batchVisible) continue;
            color.setHex(writer.batchColor);

            const segmentsBefore = linePositions.length / 6;
            writer.buildLineSegments(linePositions);
            const segments = linePositions.length / 6 - segmentsBefore;
            for (let i = 0; i < segments * 2; i++) lineColors.push(color.r, color.g, color.b);
            segmentOwners.push(...new Array(segments).fill(writer));

            const trianglesBefore = trianglePositions.length / 9;
            writer.buildTriangles(trianglePositions);
            const triangles = trianglePositions.length / 9 - trianglesBefore;
            for (let i = 0; i < triangles * 3; i++) triangleColors.push(color.r, color.g, color.b);
            triangleOwners.push(...new Array(triangles).fill(writer));
        }

        this.setLineGeometry(linePositions, lineColors);
        this.setTriangleGeometry(trianglePositions, triangleColors);
        this._segmentOwners = segmentOwners;
        this._triangleOwners = triangleOwners;
        this.context.visual?.update?.();
    }

    private setLineGeometry(positions: number[], colors: number[]): void {
        const geometry = this._lines.geometry;
        geometry.dispose();
        geometry.setPositions(positions);
        geometry.setColors(colors);
        this._lines.visible = positions.length > 0;
        if (this._lines.visible) geometry.computeBoundingSphere();
    }

    private setTriangleGeometry(positions: number[], colors: number[]): void {
        const geometry = this._triangles.geometry;
        geometry.dispose();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
        this._triangles.visible = positions.length > 0;
        if (this._triangles.visible) geometry.computeBoundingSphere();
    }

    dispose(): void {
        this._disposed = true;
        this._lines.geometry.dispose();
        (this._lines.material as LineMaterial).dispose();
        this._triangles.geometry.dispose();
        (this._triangles.material as MeshBasicMaterial).dispose();
    }
}
