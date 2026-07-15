// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { VisualNode } from "@chili3d/core";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { ThreeMeshExporter } from "../src/meshExporter";
import { createMockVisualContext } from "./mocks";

describe("ThreeMeshExporter", () => {
    let meshesToDispose: Mesh[] = [];

    afterEach(() => {
        for (const mesh of meshesToDispose) {
            mesh.geometry?.dispose();
            (mesh.material as MeshBasicMaterial)?.dispose();
        }
        meshesToDispose = [];
    });

    test("exportToObj returns a Result", () => {
        const context = createMockVisualContext();
        const exporter = new ThreeMeshExporter(context);

        const result = exporter.exportToObj([]);
        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBeDefined();
    });

    test("exportToStl returns a Result with binary mode", () => {
        const context = createMockVisualContext();
        const exporter = new ThreeMeshExporter(context);

        const result = exporter.exportToStl([], false);
        expect(result.isOk).toBe(true);
    });

    test("exportToStl returns a Result with ascii mode", () => {
        const context = createMockVisualContext();
        const exporter = new ThreeMeshExporter(context);

        const result = exporter.exportToStl([], true);
        expect(result.isOk).toBe(true);
    });

    test("exportToPly returns ok for empty input", () => {
        const context = createMockVisualContext();
        const exporter = new ThreeMeshExporter(context);

        const result = exporter.exportToPly([], false);
        expect(result.isOk).toBe(true);
    });

    test("export includes meshes from visual objects", () => {
        const mockNode = { id: "test-node-1" } as unknown as VisualNode;
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3));
        geo.computeBoundingBox();

        const mesh = new Mesh(geo, new MeshBasicMaterial());
        meshesToDispose.push(mesh);

        const parent = new Group();
        parent.add(mesh);

        const visualMap = new Map<VisualNode, Mesh>();
        visualMap.set(mockNode, parent as any);

        const context = createMockVisualContext(visualMap);
        const exporter = new ThreeMeshExporter(context);

        const result = exporter.exportToObj([mockNode]);
        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBeDefined();
    });
});
