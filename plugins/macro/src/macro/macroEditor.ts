// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DialogButton, I18n, type I18nKeys, type IApplication, Localize, PubSub } from "@chili3d/core";
import { div, input, label, textarea } from "@chili3d/element";
import style from "./macro.module.css";
import { runMacro } from "./macroRunner";
import type { MacroDefinition, MacroStorage } from "./macroStorage";

const DefaultCode = `// Available variables:
// app - IApplication instance
// You can access:
//   - app.activeView - current active view
//   - app.documents - all open documents
//   - app.visualFactory - visual factory
//   - app.shapeFactory - shape factory
//   - app.storage - storage interface

// Example: Create a simple box

// const { Plane, EditableShapeNode } = Chili3dCore;
// const { document, cameraController } = app.activeView;
// 
// const box = app.shapeFactory.box(Plane.XY, 1000, 1000, 1000);
// const node = new EditableShapeNode(document, "box1", box);
// document.modelManager.addNode(node);
// cameraController.fitContent();
// document.visual.update();

alert("Hello from macro!");
`;

export class MacroEditor extends HTMLElement {
    private macro: MacroDefinition | undefined;
    private onSaveCallback: (() => void) | undefined;
    private nameInput: HTMLInputElement | null = null;
    private codeTextarea: HTMLTextAreaElement | null = null;

    constructor(
        readonly app: IApplication,
        readonly storage: MacroStorage,
    ) {
        super();
    }

    show(macro: MacroDefinition | undefined, onSave: () => void): void {
        this.macro = macro;
        this.onSaveCallback = onSave;

        const buttons: DialogButton[] = [
            {
                content: "macro.editor.run" as I18nKeys,
                onclick: async () => await runMacro(this.app, this.codeTextarea?.value ?? ""),
                shouldClose: () => false,
            },
            {
                content: "common.confirm",
                shouldClose: () => !!this.nameInput?.value.trim(),
                onclick: async () => await this.saveMacro(),
            },
            {
                content: "common.cancel",
            },
        ];

        PubSub.default.pub(
            "showDialog",
            (macro ? "macro.editor.titleEdit" : "macro.editor.titleNew") as I18nKeys,
            this.createDom(macro),
            buttons,
        );
    }

    private createDom(macro: MacroDefinition | undefined) {
        this.nameInput = input({
            className: style.input,
            value: macro?.name ?? "",
            placeholder: I18n.translate("macro.editor.namePlaceholder" as I18nKeys),
        });

        this.codeTextarea = textarea({
            className: style.codeEditor,
            value: macro?.code ?? DefaultCode,
            placeholder: I18n.translate("macro.editor.codePlaceholder" as I18nKeys),
        });

        return div(
            { className: style.editorContainer },
            div(
                { className: style.field },
                label({
                    className: style.inputLabel,
                    textContent: new Localize("macro.editor.name" as I18nKeys),
                }),
                this.nameInput,
            ),
            div(
                { className: style.field },
                label({
                    className: style.inputLabel,
                    textContent: new Localize("macro.editor.code" as I18nKeys),
                }),
                this.codeTextarea,
            ),
        );
    }

    private async saveMacro(): Promise<void> {
        const name = this.nameInput?.value.trim();
        if (!name) {
            alert(I18n.translate("macro.editor.nameRequired" as I18nKeys));
            return;
        }

        const code = this.codeTextarea?.value ?? "";
        await this.storage.saveMacro(name, code, this.macro?.id);
        this.onSaveCallback?.();
    }
}

customElements.define("macro-editor", MacroEditor);
