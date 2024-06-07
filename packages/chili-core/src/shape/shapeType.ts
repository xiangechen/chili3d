// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export enum ShapeType {
    Shape = 0b0,
    Compound = 0b1,
    CompoundSolid = 0b10,
    Solid = 0b100,
    Shell = 0b1000,
    Face = 0b10000,
    Wire = 0b100000,
    Edge = 0b1000000,
    Vertex = 0b10000000,
}

export namespace ShapeType {
    export function isWhole(type: ShapeType) {
        return (
            type === ShapeType.Shape ||
            type === ShapeType.Compound ||
            type === ShapeType.CompoundSolid ||
            type === ShapeType.Solid
        );
    }

    export function hasCompound(type: ShapeType): boolean {
        return (type & ShapeType.Compound) !== 0;
    }
    export function hasCompoundSolid(type: ShapeType): boolean {
        return (type & ShapeType.CompoundSolid) !== 0;
    }
    export function hasSolid(type: ShapeType): boolean {
        return (type & ShapeType.Solid) !== 0;
    }
    export function hasShell(type: ShapeType): boolean {
        return (type & ShapeType.Shell) !== 0;
    }
    export function hasFace(type: ShapeType): boolean {
        return (type & ShapeType.Face) !== 0;
    }
    export function hasWire(type: ShapeType): boolean {
        return (type & ShapeType.Wire) !== 0;
    }
    export function hasEdge(type: ShapeType): boolean {
        return (type & ShapeType.Edge) !== 0;
    }
    export function hasVertex(type: ShapeType): boolean {
        return (type & ShapeType.Vertex) !== 0;
    }
}
