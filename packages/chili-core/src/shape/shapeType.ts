// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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

export class ShapeTypeUtils {
    public static isWhole(type: ShapeType) {
        return (
            type === ShapeType.Shape ||
            type === ShapeType.Compound ||
            type === ShapeType.CompoundSolid ||
            type === ShapeType.Solid ||
            type === ShapeType.Vertex
        );
    }

    public static stringValue(type: ShapeType) {
        switch (type) {
            case ShapeType.Shape:
                return "Shape";
            case ShapeType.Compound:
                return "Compound";
            case ShapeType.CompoundSolid:
                return "CompoundSolid";
            case ShapeType.Solid:
                return "Solid";
            case ShapeType.Shell:
                return "Shell";
            case ShapeType.Face:
                return "Face";
            case ShapeType.Wire:
                return "Wire";
            case ShapeType.Edge:
                return "Edge";
            case ShapeType.Vertex:
                return "Vertex";
            default:
                return "Unknown";
        }
    }

    public static hasCompound(type: ShapeType): boolean {
        return (type & ShapeType.Compound) !== 0;
    }
    public static hasCompoundSolid(type: ShapeType): boolean {
        return (type & ShapeType.CompoundSolid) !== 0;
    }
    public static hasSolid(type: ShapeType): boolean {
        return (type & ShapeType.Solid) !== 0;
    }
    public static hasShell(type: ShapeType): boolean {
        return (type & ShapeType.Shell) !== 0;
    }
    public static hasFace(type: ShapeType): boolean {
        return (type & ShapeType.Face) !== 0;
    }
    public static hasWire(type: ShapeType): boolean {
        return (type & ShapeType.Wire) !== 0;
    }
    public static hasEdge(type: ShapeType): boolean {
        return (type & ShapeType.Edge) !== 0;
    }
    public static hasVertex(type: ShapeType): boolean {
        return (type & ShapeType.Vertex) !== 0;
    }
}
