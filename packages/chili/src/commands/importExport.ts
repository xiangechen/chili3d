// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    download,
    I18n,
    IApplication,
    ICommand,
    Property,
    PubSub,
    readFilesAsync,
} from "chili-core";
import { SelectNodeStep } from "../step";
import { importFiles } from "../utils";

@command({
    name: "file.import",
    display: "command.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        let extenstions = application.dataExchange.importFormats().join(",");
        let files = await readFilesAsync(extenstions, true);
        if (!files.isOk || files.value.length === 0) {
            alert(files.error);
            return;
        }

        importFiles(application, files.value);
    }
}

@command({
    name: "file.export",
    display: "command.export",
    icon: "icon-export",
})
export class Export extends CancelableCommand {
    @Property.define("file.format")
    public get formats() {
        return this.getPrivateValue("formats", this.initCombobox());
    }
    public set formats(value: Combobox<string>) {
        this.setProperty("formats", value);
    }

    private initCombobox() {
        let box = new Combobox<string>();
        box.items.push(...this.application.dataExchange.exportFormats());
        return box;
    }

    protected async executeAsync() {
        let nodes = await this.selectNodesAsync();
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        PubSub.default.pub(
            "showPermanent",
            async () => {
                let format = this.formats.selectedItem;
                if (format === undefined) return;

                let data = await this.application.dataExchange.export(format, nodes);
                if (!data) {
                    return;
                }

                PubSub.default.pub("showToast", "toast.downloading");
                download(data, `${nodes[0].name}${format}`);
            },
            "toast.excuting{0}",
            I18n.translate("command.export"),
        );
    }

    private async selectNodesAsync() {
        let controller = new AsyncController();
        let step = new SelectNodeStep("prompt.select.models", true);
        let data = await step.execute(this.application.activeView?.document!, controller);
        if (!data?.nodes) {
            PubSub.default.pub("showToast", "prompt.select.noModelSelected");
            return undefined;
        }
        return data.nodes;
    }
}
