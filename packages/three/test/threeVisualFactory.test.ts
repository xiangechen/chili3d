// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IEventHandler } from "@chili3d/core";
import { ThreeVisulFactory } from "../src/threeVisualFactory";

describe("ThreeVisulFactory", () => {
    test("kernelName is 'three'", () => {
        const factory = new ThreeVisulFactory((_doc: IDocument) => ({}) as IEventHandler);
        expect(factory.kernelName).toBe("three");
    });

    test("createEventHandler is stored correctly", () => {
        const handler = (_doc: IDocument) => ({}) as IEventHandler;
        const factory = new ThreeVisulFactory(handler);
        expect(factory.createEventHandler).toBe(handler);
    });
});
