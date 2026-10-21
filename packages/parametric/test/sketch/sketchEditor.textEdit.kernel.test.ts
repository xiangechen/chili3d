// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The text edit path (`editText` → dialog → `applyTextEdit`), driven against the real
// kernel: what is pinned is which edits need the font and which do not (a local-file
// font is session memory — gone from a reopened document — so height and angle edits
// must not ask for it), the no-op confirm recording nothing, and the edit abandoned
// mid-flight by the session ending writing nothing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type Contour2D,
    type DialogButton,
    type FontOutline,
    forgetOutline,
    type ICameraController,
    Plane,
    PubSub,
    rememberOutline,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchData, SketchTextData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    rs.restoreAllMocks();
});

/** A closed 10×10 square as four line segments — the shape a laid-out sidecar stores. */
const SQUARE: Contour2D = {
    start: { x: 0, y: 0 },
    segments: [
        { kind: "line", to: { x: 10, y: 0 } },
        { kind: "line", to: { x: 10, y: 10 } },
        { kind: "line", to: { x: 0, y: 10 } },
        { kind: "line", to: { x: 0, y: 0 } },
    ],
};

/** A one-text-entity sketch. The font is "local-only": an address-less file font that is NOT in the session memory. */
function textData(overrides: Partial<SketchTextData> = {}): SketchData {
    return {
        entities: [
            {
                id: 1,
                type: "text",
                params: [0, 0, 0],
                text: {
                    text: "X",
                    size: 10,
                    fontName: "local-only",
                    fontUrl: "",
                    contours: JSON.stringify([SQUARE]),
                    ...overrides,
                },
            },
        ],
        constraints: [],
    };
}

/** Editor environment: camera, view and visual mocks, mirroring the app shell. */
function setup(data: SketchData) {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc, { viewHandler: { canRotate: true } as any }) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const node = new SketchNode({ document: doc, plane: Plane.XY, data });
    const editor = SketchEditor.enter(node);
    return { doc, node, editor };
}

/** Runs `body` with every toast captured, so a test can say the edit path stayed silent or said so. */
async function withToasts(body: (toasts: unknown[][]) => Promise<void>): Promise<void> {
    const toasts: unknown[][] = [];
    const onToast = (...args: unknown[]) => toasts.push(args);
    PubSub.default.sub("showToast", onToast);
    try {
        await body(toasts);
    } finally {
        PubSub.default.remove("showToast", onToast);
    }
}

describe("sketch text edit", () => {
    test("confirming an untouched edit records no history", async () => {
        const { doc, editor } = setup(textData());
        try {
            const previous = editor.solver.textOf(1);
            expect(previous).toBeDefined();

            await (editor as any).applyTextEdit(1, previous, {
                text: previous!.text,
                size: previous!.size,
                angle: 0,
                fontName: previous!.fontName,
            });

            expect(doc.history.undoCount()).toBe(0);
        } finally {
            editor.exit();
        }
    });

    test("an angle-only edit turns in place: the sidecar is untouched and no font is read", async () => {
        const { doc, editor } = setup(textData());
        try {
            await withToasts(async (toasts) => {
                const previous = editor.solver.textOf(1)!;
                await (editor as any).applyTextEdit(1, previous, {
                    text: previous.text,
                    size: previous.size,
                    angle: Math.PI / 4,
                    fontName: previous.fontName,
                });

                // the local-only font could not have been read — any layout attempt would have toasted
                expect(toasts).toEqual([]);
                expect(editor.solver.entity(1)!.params[2]).toBeCloseTo(Math.PI / 4, 9);
                expect(editor.solver.textOf(1)!.contours).toBe(previous.contours);
                expect(doc.history.undoCount()).toBe(1);
            });
        } finally {
            editor.exit();
        }
    });

    test("a height-only edit scales the stored contours — a local-file font is never read", async () => {
        const { doc, editor } = setup(textData());
        try {
            await withToasts(async (toasts) => {
                const previous = editor.solver.textOf(1)!;
                await (editor as any).applyTextEdit(1, previous, {
                    text: previous.text,
                    size: 25,
                    angle: 0,
                    fontName: previous.fontName,
                });

                expect(toasts).toEqual([]);
                const spec = editor.solver.textOf(1)!;
                expect(spec.size).toBe(25);
                // the 10×10 square multiplied by 25 / 10
                expect(JSON.parse(spec.contours)).toEqual([
                    {
                        start: { x: 0, y: 0 },
                        segments: [
                            { kind: "line", to: { x: 25, y: 0 } },
                            { kind: "line", to: { x: 25, y: 25 } },
                            { kind: "line", to: { x: 0, y: 25 } },
                            { kind: "line", to: { x: 0, y: 0 } },
                        ],
                    },
                ]);
                expect(doc.history.undoCount()).toBe(1);
            });
        } finally {
            editor.exit();
        }
    });

    test("a content edit whose font is not at hand keeps the text as it was, and says so", async () => {
        const { doc, editor } = setup(textData());
        try {
            await withToasts(async (toasts) => {
                const previous = editor.solver.textOf(1)!;
                await (editor as any).applyTextEdit(1, previous, {
                    text: "Y",
                    size: previous.size,
                    angle: 0,
                    fontName: previous.fontName,
                });

                expect(toasts).toEqual([["toast.text.fontFailed"]]);
                const spec = editor.solver.textOf(1)!;
                expect(spec.text).toBe("X");
                expect(spec.contours).toBe(previous.contours);
                expect(doc.history.undoCount()).toBe(0);
            });
        } finally {
            editor.exit();
        }
    });

    test("an edit abandoned mid-flight by the session ending writes nothing", async () => {
        // The font IS at hand this time, so the first await resolves — but the session is
        // disposed while the continuation is still queued, and the write it would do would
        // throw on the freed solver.
        const font: FontOutline = {
            familyName: "cached-font",
            unitsPerEm: 1000,
            missingAdvance: 500,
            glyph: () => undefined,
        };
        rememberOutline("cached-font", "", font);
        const { doc, editor } = setup(textData({ fontName: "cached-font" }));
        try {
            const previous = editor.solver.textOf(1)!;
            const pending = (editor as any).applyTextEdit(1, previous, {
                text: "Y",
                size: 20,
                angle: 0.5,
                fontName: "cached-font",
            });
            // dispose lands synchronously, ahead of the continuation
            editor.exit();
            await pending;

            expect(doc.history.undoCount()).toBe(0);
        } finally {
            forgetOutline("cached-font", "");
        }
    });

    test("the dialog confirms an untouched edit without recording history", async () => {
        // 12.345678 does NOT survive the dialog's toFixed(2) prefill: if the confirm read
        // the prefill back, this would scale the contours and commit — the phantom edit
        const { doc, editor } = setup(textData({ size: 12.345678 }));
        try {
            let buttons: DialogButton[] | undefined;
            const onDialog = (...args: unknown[]) => {
                buttons = args[2] as DialogButton[];
            };
            PubSub.default.sub("showDialog", onDialog);
            try {
                editor.editText(1);
                expect(buttons).toBeDefined();
                // confirm untouched: shouldClose runs the confirm and lets the dialog close
                expect(buttons![0].shouldClose!()).toBe(true);
                expect(doc.history.undoCount()).toBe(0);
                expect(editor.solver.textOf(1)!.size).toBe(12.345678);
            } finally {
                PubSub.default.remove("showDialog", onDialog);
            }
        } finally {
            editor.exit();
        }
    });
});
