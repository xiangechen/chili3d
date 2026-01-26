// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../src/config";
import { Navigation3D, Navigation3DTypes } from "../src/navigation";
import { mockLocalStorage } from "./localStorageMock";

describe("Navigation3DTypes", () => {
    test("should contain Chili3d", () => {
        expect(Navigation3DTypes).toContain("Chili3d");
    });

    test("should contain Revit", () => {
        expect(Navigation3DTypes).toContain("Revit");
    });

    test("should contain Blender", () => {
        expect(Navigation3DTypes).toContain("Blender");
    });

    test("should contain Creo", () => {
        expect(Navigation3DTypes).toContain("Creo");
    });

    test("should contain Solidworks", () => {
        expect(Navigation3DTypes).toContain("Solidworks");
    });

    test("should have exactly 5 navigation types", () => {
        expect(Navigation3DTypes).toHaveLength(5);
    });
});

describe("Navigation3D.getKey", () => {
    function createMouseEvent(modifiers: {
        shiftKey?: boolean;
        ctrlKey?: boolean;
        altKey?: boolean;
    }): MouseEvent {
        return {
            shiftKey: modifiers.shiftKey ?? false,
            ctrlKey: modifiers.ctrlKey ?? false,
            altKey: modifiers.altKey ?? false,
        } as MouseEvent;
    }

    test("should return Middle for no modifiers", () => {
        const event = createMouseEvent({});
        expect(Navigation3D.getKey(event)).toBe("Middle");
    });

    test("should return Shift+Middle when shiftKey is true", () => {
        const event = createMouseEvent({ shiftKey: true });
        expect(Navigation3D.getKey(event)).toBe("Shift+Middle");
    });

    test("should return Ctrl+Middle when ctrlKey is true", () => {
        const event = createMouseEvent({ ctrlKey: true });
        expect(Navigation3D.getKey(event)).toBe("Ctrl+Middle");
    });

    test("should return Alt+Middle when altKey is true", () => {
        const event = createMouseEvent({ altKey: true });
        expect(Navigation3D.getKey(event)).toBe("Alt+Middle");
    });

    test("should return Ctrl+Shift+Middle when shiftKey and ctrlKey are true", () => {
        const event = createMouseEvent({ shiftKey: true, ctrlKey: true });
        expect(Navigation3D.getKey(event)).toBe("Ctrl+Shift+Middle");
    });

    test("should return Alt+Shift+Middle when shiftKey and altKey are true", () => {
        const event = createMouseEvent({ shiftKey: true, altKey: true });
        expect(Navigation3D.getKey(event)).toBe("Alt+Shift+Middle");
    });

    test("should return Alt+Ctrl+Middle when ctrlKey and altKey are true", () => {
        const event = createMouseEvent({ ctrlKey: true, altKey: true });
        expect(Navigation3D.getKey(event)).toBe("Alt+Ctrl+Middle");
    });

    test("should return Alt+Ctrl+Shift+Middle when all modifiers are true", () => {
        const event = createMouseEvent({ shiftKey: true, ctrlKey: true, altKey: true });
        expect(Navigation3D.getKey(event)).toBe("Alt+Ctrl+Shift+Middle");
    });
});

describe("Navigation3D.navigationKeyMap", () => {
    let localStorageMock: any;

    beforeEach(() => {
        localStorageMock = mockLocalStorage();
    });

    afterEach(() => {
        Config.instance.init("config");
    });

    describe("Chili3d", () => {
        test("should return Middle for pan", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Chili3d";
            expect(Navigation3D.navigationKeyMap().pan).toBe("Middle");
        });

        test("should return Shift+Middle for rotate", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Chili3d";
            expect(Navigation3D.navigationKeyMap().rotate).toBe("Shift+Middle");
        });
    });

    describe("Revit", () => {
        test("should return Middle for pan", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Revit";
            expect(Navigation3D.navigationKeyMap().pan).toBe("Middle");
        });

        test("should return Shift+Middle for rotate", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Revit";
            expect(Navigation3D.navigationKeyMap().rotate).toBe("Shift+Middle");
        });
    });

    describe("Blender", () => {
        test("should return Shift+Middle for pan", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Blender";
            expect(Navigation3D.navigationKeyMap().pan).toBe("Shift+Middle");
        });

        test("should return Middle for rotate", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Blender";
            expect(Navigation3D.navigationKeyMap().rotate).toBe("Middle");
        });
    });

    describe("Creo", () => {
        test("should return Shift+Middle for pan", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Creo";
            expect(Navigation3D.navigationKeyMap().pan).toBe("Shift+Middle");
        });

        test("should return Middle for rotate", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Creo";
            expect(Navigation3D.navigationKeyMap().rotate).toBe("Middle");
        });
    });

    describe("Solidworks", () => {
        test("should return Ctrl+Middle for pan", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Solidworks";
            expect(Navigation3D.navigationKeyMap().pan).toBe("Ctrl+Middle");
        });

        test("should return Middle for rotate", () => {
            Config.instance.init("testNavigation");
            Config.instance.navigation3D = "Solidworks";
            expect(Navigation3D.navigationKeyMap().rotate).toBe("Middle");
        });
    });
});
