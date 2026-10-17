// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";

rs.mock("../src/editor.module.css", () => ({
    root: "ed-root",
    content: "ed-content",
    sidebar: "ed-sidebar",
    sidebarItem: "ed-sidebar-item",
    sidebarItemResizer: "ed-sidebar-item-resizer",
    sidebarResizer: "ed-sidebar-resizer",
    viewport: "ed-viewport",
    viewportContainer: "ed-viewport-container",
    rightPanel: "ed-right-panel",
    chatResizer: "ed-chat-resizer",
    statusbar: "ed-statusbar",
}));

// The sidebar split is what this file drives; everything else the editor builds is a
// placeholder that only has to exist. A placeholder that extends HTMLElement has to be
// registered before it can be `new`ed — the DOM refuses constructors it does not know.
function defineMock(name: string, ctor: CustomElementConstructor) {
    if (!customElements.get(name)) customElements.define(name, ctor);
}

rs.mock("../src/project/index", () => {
    class ProjectViewMock extends HTMLElement {
        constructor(_props: { className: string }) {
            super();
            this.setAttribute("data-pane", "project");
        }
    }
    defineMock("test-project-view", ProjectViewMock);
    return { ProjectView: ProjectViewMock };
});

rs.mock("../src/property/index", () => {
    class PropertyViewMock extends HTMLElement {
        constructor(_props: { className: string }) {
            super();
            this.setAttribute("data-pane", "property");
        }
    }
    defineMock("test-property-view", PropertyViewMock);
    return { PropertyView: PropertyViewMock };
});

rs.mock("../src/viewport/index", () => {
    class LayoutViewportMock extends HTMLElement {}
    defineMock("test-layout-viewport", LayoutViewportMock);
    return { LayoutViewport: LayoutViewportMock };
});

rs.mock("../src/statusbar/index", () => {
    class StatusbarMock extends HTMLElement {}
    defineMock("test-statusbar", StatusbarMock);
    return { Statusbar: StatusbarMock };
});

rs.mock("../src/ribbon/index", () => {
    class RibbonUIMock extends HTMLElement {}
    defineMock("test-ribbon-ui", RibbonUIMock);
    return { RibbonUI: RibbonUIMock };
});

rs.mock("../src/ribbon/commandContext", () => {
    class CommandContextMock extends HTMLElement {
        dispose() {}
    }
    defineMock("test-command-context", CommandContextMock);
    return { CommandContext: CommandContextMock };
});

rs.mock("../src/floatPanel", () => {
    class FloatPanelMock extends HTMLElement {
        dispose() {}
    }
    defineMock("test-float-panel", FloatPanelMock);
    return { FloatPanel: FloatPanelMock };
});

rs.mock("@chili3d/ai", () => {
    class ChatPanelMock extends HTMLElement {
        onClose?: () => void;
        onDock?: () => void;
        readonly header = document.createElement("div");
        setFloating(_floating: boolean) {}
        floatingActions() {
            return [];
        }
        dispose() {}
    }
    defineMock("test-chat-panel", ChatPanelMock);
    return { ChatPanel: ChatPanelMock };
});

import { Editor } from "../src/editor";
import { mustQuery } from "./_helpers/domHelpers";

function rect(top: number, height: number): DOMRect {
    return {
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 360,
        width: 360,
        x: 0,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

function createEditor() {
    const app = createMockApplication();
    const mainWindow = document.createElement("div");
    (app as { mainWindow?: HTMLElement }).mainWindow = mainWindow;
    const editor = new Editor(app, {} as never);
    const project = mustQuery(editor, '[data-pane="project"]');
    const property = mustQuery(editor, '[data-pane="property"]');
    const resizer = project.nextElementSibling;
    expect(resizer).not.toBeNull();
    project.getBoundingClientRect = () => rect(100, 200);
    property.getBoundingClientRect = () => rect(310, 200);
    return { app, editor, project, property, resizer: resizer as HTMLElement };
}

function press(resizer: HTMLElement, clientY: number) {
    resizer.onpointerdown?.(
        new MouseEvent("pointerdown", { clientY, bubbles: true }) as unknown as PointerEvent,
    );
}

function move(clientY: number) {
    document.dispatchEvent(new MouseEvent("pointermove", { clientY }));
}

function release() {
    document.dispatchEvent(new MouseEvent("pointerup"));
}

describe("Editor sidebar split", () => {
    test("starts with both panes at half height", () => {
        const { project, property } = createEditor();

        expect(project.style.flexGrow).toBe("0.5");
        expect(property.style.flexGrow).toBe("0.5");
    });

    test("the divider between the panes is a horizontal drag handle", () => {
        const { resizer } = createEditor();

        expect(resizer.className).toBe("ed-sidebar-item-resizer");
    });

    test("dragging the divider moves the split to the pointer", () => {
        const { app, project, property, resizer } = createEditor();

        press(resizer, 300);
        move(250);

        // (250 - 100) / (200 + 200)
        expect(project.style.flexGrow).toBe("0.375");
        expect(property.style.flexGrow).toBe("0.625");
        expect(app.mainWindow?.style.cursor).toBe("ns-resize");

        release();
        expect(app.mainWindow?.style.cursor).toBe("");
    });

    test("neither pane shrinks below its minimum height", () => {
        const { project, property, resizer } = createEditor();

        press(resizer, 300);
        move(-1000);
        expect(project.style.flexGrow).toBe("0.15");
        expect(property.style.flexGrow).toBe("0.85");

        // 60 / 400 is the smallest share either pane may keep.
        move(10000);
        expect(project.style.flexGrow).toBe("0.85");
        expect(property.style.flexGrow).toBe("0.15");

        release();
    });

    test("stops following the pointer once released", () => {
        const { project, resizer } = createEditor();

        press(resizer, 300);
        move(250);
        release();
        move(350);

        expect(project.style.flexGrow).toBe("0.375");
    });
});
