import { IShape, IShapeConverter, Result } from "chili-core";
import { OccShape } from "./shape";
import { OcctHelper } from "./helper";

export class OccShapeConverter implements IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string> {
        throw new Error("Method not implemented.");
    }
    convertFromIGES(iges: string): Result<IShape[]> {
        throw new Error("Method not implemented.");
    }
    convertToSTEP(...shapes: IShape[]): Result<string> {
        throw new Error("Method not implemented.");
    }
    convertFromSTEP(step: string): Result<IShape[]> {
        throw new Error("Method not implemented.");
    }
    convertToBrep(shape: IShape): Result<string> {
        if (shape instanceof OccShape) {
            return Result.ok(wasm.Converter.convertToBrep(shape.shape));
        }
        return Result.err("Shape is not an OccShape");
    }
    convertFromBrep(brep: string): Result<IShape> {
        let shape = wasm.Converter.convertFromBrep(brep);
        return Result.ok(OcctHelper.wrapShape(shape));
    }
}
