// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, ShapeTypes } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { SweepedNode } from "../../src/bodys/sweep";
import { createMockDocument } from "../_helpers";
import { createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

describe("SweepedNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize profile, path, and round when path is already a wire", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({ wire: () => Result.ok(wire as any) });

            const pathWire: any = wire;
            const profileEdge: any = { ...wire, shapeType: ShapeTypes.edge };
            const node = new SweepedNode({
                document: doc,
                profile: [profileEdge],
                path: pathWire,
                round: true,
            });
            expect(node.profile.length).toBe(1);
            expect(node.path.shapeType).toBe(ShapeTypes.wire);
            expect(node.round).toBe(true);
        });

        test("should set name from display()", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.name).toBe("body.sweep");
        });

        test("should default round to false", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.round).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.sweep", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.display()).toBe("body.sweep");
        });
    });

    describe("getters", () => {
        test("should return profile, path, round", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({ wire: () => Result.ok(wire as any) });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: true });
            expect(node.round).toBe(true);
            expect(node.path).toBe(w);
        });
    });

    describe("setters", () => {
        test("setting profile should update value", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const newProf = [{ ...w }];
            node.profile = newProf as any;
            expect(node.profile).toBe(newProf);
        });

        test("setting path should update value", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const newPath = { ...w };
            node.path = newPath as any;
            expect(node.path).toBe(newPath);
        });

        test("setting round should update value", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            node.round = true;
            expect(node.round).toBe(true);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on profile change", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.profile = [w] as any;
            expect(events).toContain("profile");
        });

        test("should emit on path change", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            // Must use a different object reference to trigger change detection
            node.path = { ...w } as any;
            expect(events).toContain("path");
        });

        test("should emit on round change", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.ok(createMockShape()),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.round = true;
            expect(events).toContain("round");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.sweep with correct parameters", () => {
            const wire = createMockWire();
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: true });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(calledWith[0]).toEqual([w]);
            expect(calledWith[1]).toBe(w);
            expect(calledWith[2]).toBe(true);
        });

        test("should return Result.err when shapeFactory.sweep fails", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({
                wire: () => Result.ok(wire as any),
                sweep: () => Result.err("sweep creation failed"),
            });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });

    describe("ensureWire", () => {
        test("should return same wire when given a wire", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({ wire: () => Result.ok(wire as any) });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const result = (node as any).ensureWire(w);
            expect(result.shapeType).toBe(ShapeTypes.wire);
        });

        test("should convert edge to wire via shapeFactory.wire", () => {
            const mockWire = { shapeType: ShapeTypes.wire };
            setupShapeFactoryMock({
                wire: () => Result.ok(mockWire as any),
            });
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            const edgeInput: any = { shapeType: ShapeTypes.edge };
            const result = (node as any).ensureWire(edgeInput);
            expect(result.shapeType).toBe(ShapeTypes.wire);
        });
    });
});
