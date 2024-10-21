// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    EditableShapeNode,
    GeometryNode,
    I18n,
    IApplication,
    ICommand,
    IDocument,
    IShape,
    NodeLinkedList,
    PubSub,
    Result,
    ShapeNode,
    Transaction,
    command,
    download,
    readFilesAsync,
} from "chili-core";
import { SelectModelStep } from "../step";

let count = 1;

@command({
    name: "file.import",
    display: "command.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        if (!application.activeView?.document) return;
        PubSub.default.pub(
            "showPermanent",
            async () => {
                let shape = await this.readShape(application);
                Transaction.excute(application.activeView?.document!, "import model", () => {
                    this.addImportedShape(application.activeView?.document!, shape);
                });
                application.activeView?.cameraController.fitContent();
            },
            "toast.excuting{0}",
            I18n.translate("command.import"),
        );
    }

    private readonly addImportedShape = (
        document: IDocument,
        shape: [string | undefined, Result<IShape[]>],
    ) => {
        if (!shape[1].isOk) {
            PubSub.default.pub("showToast", "toast.read.error");
            return;
        }
        let shapes = shape[1].ok().map((x) => {
            return new EditableShapeNode(document, `Imported ${count++}`, x);
        });
        let nodeList = new NodeLinkedList(document, shape[0]!);
        document.addNode(nodeList);
        nodeList.add(...shapes);
        document.visual.update();
    };

    private async readShape(application: IApplication): Promise<[string | undefined, Result<IShape[]>]> {
        let data = await readFilesAsync(".iges, .igs, .step, .stp", false);
        if (!data.isOk || data.ok().length === 0) {
            return [undefined, data.parse()];
        }

        let shape: Result<IShape[]>;
        let name = data.ok()[0].name.toLowerCase();
        let content = new Uint8Array(await data.ok()[0].arrayBuffer());

        if (name.endsWith(".igs") || name.endsWith(".iges")) {
            shape = application.shapeFactory.converter.convertFromIGES(content);
        } else if (name.endsWith(".stp") || name.endsWith(".step")) {
            shape = application.shapeFactory.converter.convertFromSTEP(content);
        } else {
            throw new Error(`不支持的文件：${name}`);
        }
        return [name, shape];
    }
}

abstract class Export implements ICommand {
    async execute(application: IApplication): Promise<void> {
        if (!application.activeView?.document) return;
        let type = this.getType();
        let models = await this.selectModelsAsync(application);
        if (!models || models.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        PubSub.default.pub(
            "showPermanent",
            async () => {
                let shapes = models.map((x) => (x as ShapeNode).shape.ok());
                let shapeString = await this.convertAsync(application, type, ...shapes);
                if (!shapeString.isOk) {
                    PubSub.default.pub("showToast", "toast.converter.error");
                    return;
                }
                PubSub.default.pub("showToast", "toast.downloading");
                download([shapeString.ok()], `${models[0].name}.${type}`);
            },
            "toast.excuting{0}",
            "",
        );
    }

    private async convertAsync(
        application: IApplication,
        type: string,
        ...shapes: IShape[]
    ): Promise<Result<string>> {
        await new Promise((r, j) => {
            setTimeout(r, 50);
        }); // 等待弹窗完成
        return type === "iges"
            ? application.shapeFactory.converter.convertToIGES(...shapes)
            : application.shapeFactory.converter.convertToSTEP(...shapes);
    }

    abstract getType(): "iges" | "step";

    private async selectModelsAsync(application: IApplication) {
        let models = application.activeView?.document.selection
            .getSelectedNodes()
            .filter((x) => x instanceof GeometryNode);
        if (models?.length === 0) {
            let controller = new AsyncController();
            let step = new SelectModelStep("prompt.select.models", true);
            let data = await step.execute(application.activeView?.document!, controller);
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
