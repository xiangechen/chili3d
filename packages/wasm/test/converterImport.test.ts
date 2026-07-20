// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { History, type IDocument, ModelManager, ObservableCollection, XYZ } from "@chili3d/core";
import type { OccShapeConverter } from "../src/converter";
import type { ShapeFactory } from "../src/factory";
import { createBox, createTestConverter, createTestFactory } from "./helpers";
import "./setup";

function makeDoc(): IDocument {
    const selection = {} as IDocument["selection"];
    const picker = {} as IDocument["picker"];
    const app = {} as IDocument["application"];

    const doc: IDocument = {
        name: "test",
        id: "test",
        history: new History(),
        selection,
        picker,
        activeView: undefined,
        acts: new ObservableCollection(),
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        dispose: () => {},
        save: () => Promise.resolve(),
        importFiles: () => Promise.resolve(),
        close: () => Promise.resolve(),
        serialize: () => ({ id: "test" }) as unknown as ReturnType<IDocument["serialize"]>,
        application: app,
    } as unknown as IDocument;

    const modelManager = new ModelManager(doc);
    const visual = {
        context: {
            addNode: () => {},
            removeNode: () => {},
            setVisible: () => {},
            getVisual: () => undefined,
        },
    } as unknown as IDocument["visual"];

    Object.defineProperty(doc, "modelManager", { value: modelManager });
    Object.defineProperty(doc, "visual", { value: visual });

    return doc;
}

let factory: ShapeFactory;
let converter: OccShapeConverter;

beforeEach(() => {
    factory = createTestFactory();
    converter = createTestConverter();
});

describe("STEP import", () => {
    test("should convert box to STEP and import back", () => {
        const box = createBox(factory, 10, 20, 30);
        const stepStr = converter.convertToSTEP(box).value;
        expect(stepStr).toBeDefined();

        const stepBytes = new TextEncoder().encode(stepStr);
        const doc = makeDoc();
        const result = converter.convertFromSTEP(doc, stepBytes);
        expect(result.isOk).toBe(true);
        const folder = result.value;
        expect(folder).toBeDefined();
        expect(folder.firstChild).toBeDefined();
    });

    test("should return error for invalid STEP data", () => {
        const invalidData = new TextEncoder().encode("not a valid step file");
        const doc = makeDoc();
        const result = converter.convertFromSTEP(doc, invalidData);
        expect(result.isOk).toBe(false);
    });

    test("should handle cylinder STEP import", () => {
        const cyl = factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20).value;
        const stepStr = converter.convertToSTEP(cyl).value;

        const stepBytes = new TextEncoder().encode(stepStr);
        const doc = makeDoc();
        const result = converter.convertFromSTEP(doc, stepBytes);
        expect(result.isOk).toBe(true);
    });
});

describe("IGES import", () => {
    test("should convert box to IGES and import back", () => {
        const box = createBox(factory, 10, 20, 30);
        const igesStr = converter.convertToIGES(box).value;
        expect(igesStr).toBeDefined();

        const igesBytes = new TextEncoder().encode(igesStr);
        const doc = makeDoc();
        const result = converter.convertFromIGES(doc, igesBytes);
        expect(result.isOk).toBe(true);
        const folder = result.value;
        expect(folder).toBeDefined();
    });

    test("should return error for invalid IGES data", () => {
        const invalidData = new TextEncoder().encode("invalid iges");
        const doc = makeDoc();
        const result = converter.convertFromIGES(doc, invalidData);
        expect(result.isOk).toBe(false);
    });
});

describe("STL import", () => {
    test("should convert box to STL and import back", () => {
        const box = createBox(factory, 10, 20, 30);
        const stlResult = converter.convertToSTL([box], { binary: true });
        expect(stlResult.isOk).toBe(true);

        const doc = makeDoc();
        const importResult = converter.convertFromSTL(doc, stlResult.value);
        expect(importResult.isOk).toBe(true);
        const folder = importResult.value;
        expect(folder).toBeDefined();
    });

    test("should return error for invalid STL data", () => {
        const invalidData = new Uint8Array([0, 0, 0, 0]);
        const doc = makeDoc();
        const result = converter.convertFromSTL(doc, invalidData);
        expect(result.isOk).toBe(false);
    });
});

describe("STL conversion edge cases", () => {
    test("multiple boxes to STL", () => {
        const box1 = createBox(factory, 10, 10, 10);
        const box2 = createBox(factory, 10, 20, 30);
        const result = converter.convertToSTL([box1, box2], { binary: true });
        expect(result.isOk).toBe(true);
        expect(result.value.length).toBeGreaterThan(84);
    });

    test("STL conversion error handling", () => {
        const fakeShape = { shapeType: "solid" } as unknown as any;
        const result = converter.convertToSTL([fakeShape], { binary: true });
        expect(result.isOk).toBe(false);
    });
});
