// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShape, IShapeConverter, Result, gc } from "chili-core";
import { OccHelps } from "./occHelps";
import { OccShape } from "./occShape";

export class OccShapeConverter implements IShapeConverter {
    convertToBrep(shape: IShape): Result<string> {
        if (!(shape instanceof OccShape)) return Result.err("shape is not an OccShape");
        const fileName = "blob.brep";
        const progress = new occ.Message_ProgressRange_1();
        occ.BRepTools.Write_3(shape.shape, fileName, progress);
        const file = occ.FS.readFile("/" + fileName, { encoding: "utf8" });
        occ.FS.unlink("/" + fileName);

        progress.delete();
        return Result.ok(file);
    }

    convertFromBrep(brep: string): Result<IShape> {
        return gc((c) => {
            const fileName = `blob.brep`;
            occ.FS.createDataFile("/", fileName, brep, true, true, true);
            const progress = c(new occ.Message_ProgressRange_1());
            const builder = c(new occ.BRep_Builder());
            const shape = new occ.TopoDS_Shape();
            occ.BRepTools.Read_2(shape, fileName, builder, progress);
            occ.FS.unlink("/" + fileName);
            return Result.ok(OccHelps.wrapShape(shape));
        });
    }

    convertToIGES(...shapes: IShape[]): Result<string> {
        return gc((c) => {
            const fileName = "blob.iges";
            let writer = c(new occ.IGESControl_Writer_1());
            const progress = c(new occ.Message_ProgressRange_1());
            for (const s of shapes) {
                if (s instanceof OccShape) {
                    writer.AddShape(s.shape, progress);
                } else {
                    throw new Error("Unsupported shape type");
                }
            }
            writer.ComputeModel();
            let success = writer.Write_2(fileName, false);
            const file = occ.FS.readFile("/" + fileName, { encoding: "utf8" });
            occ.FS.unlink("/" + fileName);
            return success ? Result.ok(file) : Result.err("export IGES error");
        });
    }

    convertFromIGES(data: Uint8Array) {
        return this.convertFrom("iges", data);
    }

    convertToSTEP(...shapes: IShape[]): Result<string> {
        return gc((c) => {
            const fileName = "blob.step";
            let writer = c(new occ.STEPControl_Writer_1());
            const progress = c(new occ.Message_ProgressRange_1());
            for (const s of shapes) {
                if (s instanceof OccShape) {
                    let status = writer.Transfer(s.shape, 0 as any, true, progress);
                    if (status !== occ.IFSelect_ReturnStatus.IFSelect_RetDone) {
                        return Result.err("Transfer failed");
                    }
                } else {
                    return Result.err("Unsupported shape type");
                }
            }
            let result = writer.Write(fileName);
            let stepFileText = occ.FS.readFile("/" + fileName, { encoding: "utf8" });
            occ.FS.unlink("/" + fileName);
            if (result === occ.IFSelect_ReturnStatus.IFSelect_RetDone) {
                return Result.ok(stepFileText);
            } else {
                return Result.err("WRITE STEP FILE FAILED.");
            }
        });
    }

    convertFromSTEP(data: Uint8Array) {
        return this.convertFrom("step", data);
    }

    /**
     * 如果原 IWire 仅由一个 IEdge 组成，则从 IWre 反序列化时，会变为 IEdge。暂时认为不是 bug！！！
     * @param format
     * @param data
     * @returns
     */
    private convertFrom(format: "step" | "iges", data: Uint8Array): Result<IShape[]> {
        return gc((c) => {
            const fileName = `blob.${format}`;
            let reader = c(
                format === "step" ? new occ.STEPControl_Reader_1() : new occ.IGESControl_Reader_1(),
            );
            occ.FS.createDataFile("/", fileName, data, true, true, true);
            let readResult = reader.ReadFile(fileName);
            occ.FS.unlink("/" + fileName);
            if (readResult === occ.IFSelect_ReturnStatus.IFSelect_RetDone) {
                const progress = c(new occ.Message_ProgressRange_1());
                reader.TransferRoots(progress);
                let shapes: IShape[] = [];
                for (let i = 1; i <= reader.NbShapes(); i++) {
                    let shape = reader.Shape(i);
                    if (shape instanceof occ.TopoDS_Shape) {
                        shapes.push(OccHelps.wrapShape(shape));
                    }
                }
                return Result.ok(shapes);
            } else {
                return Result.err(`Cannot load ${format}`);
            }
        });
    }
}
