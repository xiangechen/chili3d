// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

//@ts-expect-error
import ace from "https://cdn.jsdelivr.net/npm/ace-builds@1.44.0/+esm";
import {
    Config,
    type DialogButton,
    I18n,
    type I18nKeys,
    type IApplication,
    Localize,
    PubSub,
} from "@chili3d/core";
import { div, input, label } from "@chili3d/element";
import style from "./macro.module.css";
import { runMacro } from "./macroRunner";
import type { MacroDefinition, MacroStorage } from "./macroStorage";

const DefaultCode = `// Available variables:
// app - IApplication instance
// You can access:
//   - app.activeView - current active view
//   - app.documents - all open documents
//   - app.visualFactory - visual factory
//   - app.storage - storage interface
//   - shapeFactory - shape factory

// Example: Create a simple box

// const { Plane, EditableShapeNode } = Chili3dCore;
// const { document, cameraController } = app.activeView;
// 
// const box = shapeFactory.box(Plane.XY, 1000, 1000, 1000);
// const node = new EditableShapeNode({
//     document, 
//     name: "box1",
//     shape: box
// });
// document.modelManager.addNode(node);
// cameraController.fitContent();
// document.visual.update();

alert("Hello from macro!");
`;

export class MacroEditor extends HTMLElement {
    private macro: MacroDefinition | undefined;
    private onSaveCallback: (() => void) | undefined;
    private nameInput: HTMLInputElement | null = null;
    private codeTextarea: HTMLDivElement | null = null;
    private editor?: {
        getValue: () => string;
        setTheme: (theme: string) => void;
    };

    constructor(
        readonly app: IApplication,
        readonly storage: MacroStorage,
    ) {
        super();
    }

    show(macro: MacroDefinition | undefined, onSave: () => void): void {
        this.macro = macro;
        this.onSaveCallback = onSave;

        const dom = this.createDom(macro);

        this.embeddingEditor();

        PubSub.default.pub(
            "showDialog",
            (macro ? "macro.editor.titleEdit" : "macro.editor.titleNew") as I18nKeys,
            dom,
            this.buttons(),
        );
    }

    private embeddingEditor() {
        ace.config.set("basePath", "https://cdn.jsdelivr.net/npm/ace-builds@1.44.0/src-min-noconflict");
        this.editor = ace.edit(this.codeTextarea!, {
            mode: "ace/mode/javascript",
            selectionStyle: "text",
        });
        this.editor?.setTheme(this.isDarkTheme() ? "ace/theme/dracula" : "ace/theme/xcode");
    }

    private isDarkTheme() {
        const themeMode = Config.instance.themeMode;
        let theme: "light" | "dark";

        if (themeMode === "system") {
            theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        } else {
            theme = themeMode;
        }

        return theme === "dark";
    }

    private buttons(): DialogButton[] {
        return [
            {
                content: "macro.editor.run" as I18nKeys,
                onclick: async () => await runMacro(this.app, this.editor?.getValue() ?? ""),
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
    }

    private createDom(macro: MacroDefinition | undefined) {
        this.nameInput = input({
            className: style.input,
            value: macro?.name ?? "",
            placeholder: I18n.translate("macro.editor.namePlaceholder" as I18nKeys),
        });

        this.codeTextarea = div({
            id: "macro-editor-code",
            className: style.codeEditor,
            textContent: macro?.code ?? DefaultCode,
            onkeydown: (e) => {
                if (e.key === "Enter") {
                    e.stopPropagation();
                }
            },
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

        const code = this.editor?.getValue() ?? "";
        await this.storage.saveMacro(name, code, this.macro?.id);
        this.onSaveCallback?.();
    }
}

customElements.define("macro-editor", MacroEditor);
