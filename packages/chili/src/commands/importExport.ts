// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    GeometryModel,
    IApplication,
    ICommand,
    IModel,
    INode,
    IShape,
    PubSub,
    Result,
    command,
    readFileAsync,
} from "chili-core";
import { ImportedBody } from "../bodys/importer";
import { SelectModelStep } from "../step";

let count = 1;

@command({
    name: "file.import",
    display: "command.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        let document = application.activeDocument;
        if (!document) return;
        let shape = await this.readShape(application);
        if (!shape.success) {
            PubSub.default.pub("showToast", "toast.read.error");
            return;
        }
        let body = new ImportedBody(document, shape.value);
        let model = new GeometryModel(document, `Imported ${count++}`, body);
        document.addNode(model);
        document.visual.viewer.update();
    }

    private async readShape(application: IApplication) {
        let data = await readFileAsync(".iges, .igs, .step, .stp", false);
        if (!data.success || data.value.length === 0) {
            return Result.error("toast.read.error");
        }
        let shape: Result<IShape>;
        if (data.value[0].fileName.endsWith(".igs") || data.value[0].fileName.endsWith(".iges")) {
            shape = application.shapeFactory.converter.convertFromIGES(data.value[0].data);
        } else if (data.value[0].fileName.endsWith(".stp") || data.value[0].fileName.endsWith(".step")) {
            shape = application.shapeFactory.converter.convertFromSTEP(data.value[0].data);
        } else {
            throw new Error(`不支持的文件：${data.value[0].fileName}`);
        }
        return shape;
    }
}

abstract class Export implements ICommand {
    async execute(application: IApplication): Promise<void> {
        if (!application.activeDocument) return;
        let type = this.getType();
        let data = await this.convertShapeAsync(application, type);
        if (data) {
            let blob = new Blob([data.data], { type: `application/${type}` });
            this.download(blob, data);
        }
    }

    abstract getType(): "iges" | "step";

    protected download(blob: Blob, data: { name: string; data: string }) {
        let a = document.createElement("a");
        a.style.visibility = "hidden";
        a.href = URL.createObjectURL(blob);
        a.download = data.name;
        a.click();
    }

    protected async convertShapeAsync(application: IApplication, type: "iges" | "step") {
        let models = await this.selectModelsAsync(application);
        if (!models || models.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        let shapes = models.map((x) => x.shape()!);
        let shapeString =
            type === "iges"
                ? application.shapeFactory.converter.convertToIGES(...shapes)
                : application.shapeFactory.converter.convertToSTEP(...shapes);
        if (!shapeString.success) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return;
        }
        return {
            name: `${models[0].name}.${type}`,
            data: shapeString.value,
        };
    }

    private async selectModelsAsync(application: IApplication) {
        let models = application
            .activeDocument!.selection.getSelectedNodes()
            .filter((x) => INode.isModelNode(x)) as IModel[];
        if (models?.length === 0) {
            let controller = new AsyncController();
            let step = new SelectModelStep("prompt.select.models", true);
            let data = await step.execute(application.activeDocument!, controller);
            if (!data?.models) {
                PubSub.default.pub("showToast", "prompt.select.noModelSelected");
                return;
            }
            models = data.models;
        }
        return models;
    }
}

@command({
    name: "file.export.iges",
    display: "command.export.iges",
    icon: "icon-export",
})
export class ExportIGES extends Export {
    override getType(): "iges" | "step" {
        return "iges";
    }
}

@command({
    name: "file.export.stp",
    display: "command.export.step",
    icon: "icon-export",
})
export class ExportStep extends Export {
    override getType(): "iges" | "step" {
        return "step";
    }
}
