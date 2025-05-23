// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    EditableShapeNode,
    GeometryNode,
    IDocument,
    IEdge,
    IFace,
    INode,
    IShape,
    IShapeFilter,
    IShell,
    PubSub,
    Result,
    ShapeNode,
    ShapeNodeFilter,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { FaceNode } from "../../bodys/face";
import { WireNode } from "../../bodys/wire";
import { SelectNodeStep } from "../../step";

abstract class ConvertCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        const models = await this.getOrPickModels(this.document);
        if (!models) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.create(this.document, models);
            if (!node.isOk) {
                PubSub.default.pub("showToast", "toast.converter.error");
            } else {
                this.document.rootNode.add(node.value);
                this.document.visual.update();
                PubSub.default.pub("showToast", "toast.success");
            }

            models.forEach((x) => x.parent?.remove(x));
        });
    }

    protected abstract create(document: IDocument, models: INode[]): Result<GeometryNode>;
    protected shapeFilter(): IShapeFilter {
        return {
            allow: (shape: IShape) =>
                shape.shapeType === ShapeType.Edge || shape.shapeType === ShapeType.Wire,
        };
    }

    async getOrPickModels(document: IDocument) {
        const filter = this.shapeFilter();
        let models = this._getSelectedModels(document, filter);
        document.selection.clearSelection();
        if (models.length > 0) return models;

        const step = new SelectNodeStep("prompt.select.models", {
            filter: new ShapeNodeFilter(filter),
            multiple: true,
        });
        this.controller = new AsyncController();
        const data = await step.execute(document, this.controller);
        document.selection.clearSelection();
        return data?.nodes;
    }

    private _getSelectedModels(document: IDocument, filter?: IShapeFilter) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as ShapeNode)
            .filter((x) => {
                if (x === undefined) return false;
                let shape = x.shape.value;
                if (shape === undefined) return false;
                if (filter !== undefined && !filter.allow(shape)) return false;
                return true;
            });
    }
}

@command({
    key: "convert.toWire",
    icon: "icon-toPoly",
})
export class ConvertToWire extends ConvertCommand {
    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const edges = models.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IEdge[];
        const wireBody = new WireNode(document, edges);
        const shape = wireBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);

        return Result.ok(wireBody);
    }
}

@command({
    key: "convert.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends ConvertCommand {
    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const edges = models.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IEdge[];
        const wireBody = new FaceNode(document, edges);
        const shape = wireBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);

        return Result.ok(wireBody);
    }
}

@command({
    key: "convert.toShell",
    icon: "icon-toShell",
})
export class ConvertToShell extends ConvertCommand {
    protected override shapeFilter(): IShapeFilter {
        return {
            allow: (shape: IShape) => shape.shapeType === ShapeType.Face,
        };
    }

    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const faces = models.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IFace[];
        const shape = this.application.shapeFactory.shell(faces);
        faces.forEach((x) => x.dispose());
        if (!shape.isOk) return Result.err(shape.error);

        const shell = new EditableShapeNode(document, "shell", shape);
        return Result.ok(shell);
    }
}

@command({
    key: "convert.toSolid",
    icon: "icon-toSolid",
})
export class ConvertToSolid extends ConvertCommand {
    protected override shapeFilter(): IShapeFilter {
        return {
            allow: (shape: IShape) => shape.shapeType === ShapeType.Shell,
        };
    }

    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const faces = models.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IShell[];
        const shape = this.application.shapeFactory.solid(faces);
        faces.forEach((x) => x.dispose());
        if (!shape.isOk) return Result.err(shape.error);

        const solid = new EditableShapeNode(document, "solid", shape);
        return Result.ok(solid);
    }
}
