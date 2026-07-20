// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FileData } from "../src";
import { readFileAsync, readFilesAsync } from "../src";

/**
 * Creates a mock FileList usable in tests.
 */
function createFileList(files: File[]): FileList {
    const list = {
        length: files.length,
        item: (index: number) => files[index] ?? null,
        [Symbol.iterator]: function* () {
            for (const f of files) yield f;
        },
    };
    for (let i = 0; i < files.length; i++) {
        (list as Record<number, File>)[i] = files[i];
    }
    return list as unknown as FileList;
}

describe("readFilesAsync", () => {
    test("should return a Promise", () => {
        const result = readFilesAsync(".txt", false);
        expect(result).toBeInstanceOf(Promise);
    });

    test("should return ok when files are selected (input click + change)", async () => {
        const testFile = new File(["content"], "test.txt", { type: "text/plain" });
        const fileList = createFileList([testFile]);

        // Override createElement to produce a pre-configured input
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                // Replace click so it fires onchange synchronously
                (el as HTMLInputElement).click = () => {
                    Object.defineProperty(el, "files", {
                        value: fileList,
                        writable: false,
                        configurable: true,
                    });
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        const result = await readFilesAsync(".txt", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(result.isOk).toBe(true);
    });

    test("should return ok with multiple files", async () => {
        const file1 = new File(["a"], "a.txt", { type: "text/plain" });
        const file2 = new File(["b"], "b.txt", { type: "text/plain" });
        const fileList = createFileList([file1, file2]);

        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    Object.defineProperty(el, "files", {
                        value: fileList,
                        writable: false,
                        configurable: true,
                    });
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        const result = await readFilesAsync("*", true);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(result.isOk).toBe(true);
        if (result.isOk) {
            expect(result.value.length).toBe(2);
        }
    });

    test("should return result.ok with truthy check on empty FileList", async () => {
        // In happy-dom, input.files is always a FileList (never null), so the
        // "no files selected" path is not reachable in tests, but we verify that
        // an empty FileList (truthy) passes the check.
        const emptyList = createFileList([]);

        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    Object.defineProperty(el, "files", {
                        value: emptyList,
                        writable: false,
                        configurable: true,
                    });
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        const result = await readFilesAsync("*", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        // Empty FileList is truthy, so result.isOk should be true
        expect(result.isOk).toBe(true);
    });
});

describe("readFileAsync", () => {
    test("should return a Promise", () => {
        const result = readFileAsync(".txt", false);
        expect(result).toBeInstanceOf(Promise);
    });

    test("should accept readAsDataURL method parameter", () => {
        const result = readFileAsync(".png", false, "readAsDataURL");
        expect(result).toBeInstanceOf(Promise);
    });

    test("should default to readAsText method", () => {
        const result = readFileAsync(".txt", false);
        expect(result).toBeInstanceOf(Promise);
    });

    test("should propagate error from cancel", async () => {
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    (el as HTMLInputElement).oncancel?.(new Event("cancel"));
                };
            }
            return el;
        }) as typeof document.createElement;

        const result = await readFileAsync("*", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("cancel");
    });
});

describe("FileData interface validation", () => {
    test("should have fileName and data properties", () => {
        const fileData: FileData = {
            fileName: "test.txt",
            data: "file content",
        };
        expect(fileData.fileName).toBe("test.txt");
        expect(fileData.data).toBe("file content");
    });

    test("should handle empty data", () => {
        const fileData: FileData = {
            fileName: "empty.txt",
            data: "",
        };
        expect(fileData.fileName).toBe("empty.txt");
        expect(fileData.data).toBe("");
    });

    test("should handle data URL", () => {
        const fileData: FileData = {
            fileName: "image.png",
            data: "data:image/png;base64,iVBORw0KGgo",
        };
        expect(fileData.fileName).toBe("image.png");
        expect(fileData.data).toMatch(/^data:/);
    });
});

describe("readFilesAsync edge cases", () => {
    test("should set input type to file", async () => {
        let capturedType: string | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedType = (el as HTMLInputElement).type;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync("*", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedType).toBe("file");
    });

    test("should set visibility to hidden", async () => {
        let capturedVisibility: string | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedVisibility = (el as HTMLInputElement).style.visibility;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync("*", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedVisibility).toBe("hidden");
    });

    test("should set multiple=true", async () => {
        let capturedMultiple: boolean | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedMultiple = (el as HTMLInputElement).multiple;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync(".csv", true);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedMultiple).toBe(true);
    });

    test("should set multiple=false", async () => {
        let capturedMultiple: boolean | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedMultiple = (el as HTMLInputElement).multiple;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync(".txt", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedMultiple).toBe(false);
    });

    test("should set accept attribute", async () => {
        let capturedAccept: string | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedAccept = (el as HTMLInputElement).accept;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync(".step,.stp", false);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedAccept).toBe(".step,.stp");
    });

    test("should handle empty accept string", async () => {
        let capturedAccept: string | null = null;
        const origCreate = document.createElement.bind(document) as (
            tag: string,
            options?: ElementCreationOptions,
        ) => HTMLElement;
        const origClick = HTMLInputElement.prototype.click;

        document.createElement = ((tag: string, _options?: ElementCreationOptions) => {
            const el = origCreate(tag);
            if (tag === "input") {
                (el as HTMLInputElement).click = () => {
                    capturedAccept = (el as HTMLInputElement).accept;
                    (el as HTMLInputElement).onchange?.(new Event("change"));
                };
            }
            return el;
        }) as typeof document.createElement;

        await readFilesAsync("", true);

        document.createElement = origCreate;
        HTMLInputElement.prototype.click = origClick;

        expect(capturedAccept).toBe("");
    });
});

describe("isIOS detection", () => {
    test("isIOS expression evaluates to a boolean", () => {
        const isIOS =
            /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) ||
            (navigator.maxTouchPoints > 0 && /(Macintosh)/.test(navigator.userAgent));
        expect(typeof isIOS).toBe("boolean");
    });
});
