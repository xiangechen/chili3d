// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    download,
    getCurrentApplication,
    I18n,
    type IApplication,
    type ICommand,
    PropertyUtils,
    PubSub,
    property,
    readFilesAsync,
    SelectNodeStep,
} from "@chili3d/core";
import { importFiles } from "../utils";

@command({
    key: "file.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const extenstions = application.dataExchange.importFormats().join(",");
        const files = await readFilesAsync(extenstions, true);
        if (!files.isOk || files.value.length === 0) {
            alert(files.error);
            return;
        }
        importFiles(application, files.value);
    }
}

@command({
    key: "file.export",
    icon: "icon-export",
})
export class Export extends CancelableCommand {
    @property("file.format", {
        combobox: new Combobox<string>(),
    })
    public get format() {
        return this.getPrivateValue("format", ".step");
    }
    public set format(value: string) {
        this.setProperty("format", value);
    }

    constructor() {
        super();
        const property = PropertyUtils.getProperty(Export.prototype, "format")!;
        property.combobox!.items.clear();
        property.combobox!.items.push(...getCurrentApplication().dataExchange.exportFormats());
    }

    protected async executeAsync() {
        const nodes = await this.selectNodesAsync();
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        PubSub.default.pub(
            "showPermanent",
            async () => {
                const data = await this.application.dataExchange.export(this.format, nodes);
                if (!data) return;

                let suffix = this.format;

                if (suffix === ".stl binary") {
                    suffix = ".stl";
                } else if (suffix === ".ply binary") {
                    suffix = ".ply";
                }

                PubSub.default.pub("showToast", "toast.downloading");
                download(data, `${nodes[0].name}${suffix}`);
            },
            "toast.excuting{0}",
            I18n.translate("command.file.export"),
        );
    }

    private async selectNodesAsync() {
        this.controller = new AsyncController();
        const step = new SelectNodeStep("prompt.select.models", { multiple: true, keepSelection: true });
        const data = await step.execute(this.application.activeView?.document!, this.controller);
        if (!data?.nodes) {
            PubSub.default.pub("showToast", "prompt.select.noModelSelected");
            return undefined;
        }
        return data.nodes;
    }
}
