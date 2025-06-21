// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
    @Property.define("file.format")
    public get formats() {
        return this.getPrivateValue("formats", this.initCombobox());
    }
    public set formats(value: Combobox<string>) {
        this.setProperty("formats", value);
    }

    private initCombobox() {
        const box = new Combobox<string>();
        box.items.push(...this.application.dataExchange.exportFormats());
        return box;
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
                const format = this.formats.selectedItem;
                if (format === undefined) return;

                const data = await this.application.dataExchange.export(format, nodes);
                if (!data) return;

                let suffix = format;

                if (suffix == ".stl binary") {
                    suffix = ".stl";
                } else if (suffix == ".ply binary") {
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
