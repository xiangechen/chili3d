// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const ShapeTypes = {
    shape: 0b0,
    compound: 0b1,
    compoundSolid: 0b10,
    solid: 0b100,
    shell: 0b1000,
    face: 0b10000,
    wire: 0b100000,
    edge: 0b1000000,
    vertex: 0b10000000,
} as const;

export type ShapeType = (typeof ShapeTypes)[keyof typeof ShapeTypes];

export class ShapeTypeUtils {
    public static isWhole(type: ShapeType) {
        return (
            type === ShapeTypes.shape ||
            type === ShapeTypes.compound ||
            type === ShapeTypes.compoundSolid ||
            type === ShapeTypes.solid ||
            type === ShapeTypes.vertex
        );
    }

    public static stringValue(type: ShapeType) {
        switch (type) {
            case ShapeTypes.shape:
                return "Shape";
            case ShapeTypes.compound:
                return "Compound";
            case ShapeTypes.compoundSolid:
                return "CompoundSolid";
            case ShapeTypes.solid:
                return "Solid";
            case ShapeTypes.shell:
                return "Shell";
            case ShapeTypes.face:
                return "Face";
            case ShapeTypes.wire:
                return "Wire";
            case ShapeTypes.edge:
                return "Edge";
            case ShapeTypes.vertex:
                return "Vertex";
            default:
                return "Unknown";
        }
    }

    public static hasCompound(type: ShapeType): boolean {
        return (type & ShapeTypes.compound) !== 0;
    }
    public static hasCompoundSolid(type: ShapeType): boolean {
        return (type & ShapeTypes.compoundSolid) !== 0;
    }
    public static hasSolid(type: ShapeType): boolean {
        return (type & ShapeTypes.solid) !== 0;
    }
    public static hasShell(type: ShapeType): boolean {
        return (type & ShapeTypes.shell) !== 0;
    }
    public static hasFace(type: ShapeType): boolean {
        return (type & ShapeTypes.face) !== 0;
    }
    public static hasWire(type: ShapeType): boolean {
        return (type & ShapeTypes.wire) !== 0;
    }
    public static hasEdge(type: ShapeType): boolean {
        return (type & ShapeTypes.edge) !== 0;
    }
    public static hasVertex(type: ShapeType): boolean {
        return (type & ShapeTypes.vertex) !== 0;
    }
}
