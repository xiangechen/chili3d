// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    Mesh,
    MeshBasicMaterial,
    Plane,
    Vector3,
} from "three";
import { coplanarFacePositions, sectionEdgePositions } from "../src/sectionEdges";

describe("sectionEdgePositions", () => {
    test("computes the interpolated segment of a triangle", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 0, 0, 1], 3));
        const mesh = new Mesh(geometry, new MeshBasicMaterial());
        mesh.updateMatrixWorld(true);

        const positions = sectionEdgePositions([mesh], new Plane(new Vector3(0, 0, 1), 0));

        expect(Array.from(positions)).toEqual([0.5, 0, 0, -0.5, 0, 0]);
    });

    test("returns deduplicated box boundary segments and applies the normal offset", () => {
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.updateMatrixWorld(true);

        const positions = sectionEdgePositions([mesh], new Plane(new Vector3(0, 0, 1), 0), 0.1);

        expect(positions).toHaveLength(48);
        for (let i = 0; i < positions.length; i += 3) {
            expect(Math.abs(positions[i])).toBeLessThanOrEqual(1);
            expect(Math.abs(positions[i + 1])).toBeLessThanOrEqual(1);
            expect(positions[i + 2]).toBeCloseTo(0.1);
            expect(Math.abs(positions[i]) === 1 || Math.abs(positions[i + 1]) === 1).toBe(true);
        }
    });

    test("returns only triangles coplanar with the section in world space", () => {
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(10, 0, 3);
        mesh.updateMatrixWorld(true);

        const coplanar = coplanarFacePositions([mesh], new Plane(new Vector3(0, 0, 1), -4));
        const nearlyCoplanar = coplanarFacePositions([mesh], new Plane(new Vector3(0, 0, 1), -4.00005));
        const missed = coplanarFacePositions([mesh], new Plane(new Vector3(0, 0, 1), 0));

        expect(coplanar).toHaveLength(18);
        expect(nearlyCoplanar).toHaveLength(18);
        for (let i = 2; i < coplanar.length; i += 3) expect(coplanar[i]).toBeCloseTo(4);
        expect(missed).toHaveLength(0);
    });

    test("uses world transforms and returns nothing when the plane misses", () => {
        const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
        mesh.position.set(10, 0, 0);
        mesh.updateMatrixWorld(true);
        const plane = new Plane(new Vector3(1, 0, 0), -10);

        const positions = sectionEdgePositions([mesh], plane, 0.2);
        const missed = sectionEdgePositions([mesh], new Plane(new Vector3(0, 0, 1), -10));

        expect(positions).toHaveLength(48);
        for (let i = 0; i < positions.length; i += 3) expect(positions[i]).toBeCloseTo(10.2);
        expect(missed).toHaveLength(0);
    });
});
