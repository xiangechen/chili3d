// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { download } from "../src";

describe("download function", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;
    let originalCreateElement: typeof document.createElement;
    let createdObjectUrls: string[];
    let revokedObjectUrls: string[];
    let clickCalled: boolean;
    let anchorInDocumentAtClick: boolean;
    let anchorHref: string;
    let anchorDownload: string;
    let anchorVisibility: string;

    beforeEach(() => {
        rs.useFakeTimers();
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        originalCreateElement = document.createElement;

        createdObjectUrls = [];
        revokedObjectUrls = [];
        clickCalled = false;
        anchorInDocumentAtClick = false;
        anchorHref = "";
        anchorDownload = "";
        anchorVisibility = "";

        URL.createObjectURL = (_blob: Blob) => {
            const url = `blob:mock-${createdObjectUrls.length}`;
            createdObjectUrls.push(url);
            return url;
        };

        URL.revokeObjectURL = (url: string) => {
            revokedObjectUrls.push(url);
        };

        document.createElement = ((tagName: string, _options?: ElementCreationOptions) => {
            const el = originalCreateElement.call(document, tagName, _options);
            if (tagName === "a") {
                const htmlEl = el as HTMLElement & { href: string; download: string };
                Object.defineProperty(htmlEl, "href", {
                    set(value: string) {
                        anchorHref = value;
                    },
                    get() {
                        return anchorHref;
                    },
                });
                Object.defineProperty(htmlEl, "download", {
                    set(value: string) {
                        anchorDownload = value;
                    },
                    get() {
                        return anchorDownload;
                    },
                });
                Object.defineProperty(htmlEl.style, "visibility", {
                    set(value: string) {
                        anchorVisibility = value;
                    },
                    get() {
                        return anchorVisibility;
                    },
                });
                el.click = () => {
                    clickCalled = true;
                    anchorInDocumentAtClick = document.body.contains(el);
                };
            }
            return el;
        }) as typeof document.createElement;
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        document.createElement = originalCreateElement;
        rs.useRealTimers();
    });

    test("should create a Blob, object URL, and trigger click", () => {
        download(["test content"], "test-file.txt");

        expect(createdObjectUrls.length).toBe(1);
        expect(clickCalled).toBe(true);
    });

    test("should set download attribute with given filename", () => {
        download(["hello"], "export.step");
        expect(anchorDownload).toBe("export.step");
    });

    test("should set anchor href to created object URL", () => {
        download(["data"], "file.json");
        expect(anchorHref).toBe("blob:mock-0");
    });

    test("should set anchor visibility to hidden", () => {
        download(["data"], "test.txt");
        expect(anchorVisibility).toBe("hidden");
    });

    test("should attach the anchor to the document before clicking it", () => {
        download(["data"], "file.txt");
        expect(anchorInDocumentAtClick).toBe(true);
    });

    test("should put the anchor inside the open dialog, where the click is not inert", () => {
        const dialog = document.createElement("dialog");
        dialog.setAttribute("open", "");
        document.body.appendChild(dialog);

        let parentAtClick: Element | null = null;
        const baseCreateElement = document.createElement.bind(document);
        document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
            const el = baseCreateElement(tagName, options);
            if (tagName === "a") {
                el.click = () => {
                    parentAtClick = el.parentElement;
                };
            }
            return el;
        }) as typeof document.createElement;

        try {
            download(["data"], "file.txt");
            expect(parentAtClick).toBe(dialog);
        } finally {
            dialog.remove();
        }
    });

    test("should keep the object URL alive across the click and revoke it later", () => {
        download(["data"], "file.txt");

        // Revoking in the same tick cancels the download in Safari/Firefox.
        expect(revokedObjectUrls).toEqual([]);

        rs.advanceTimersByTime(10_000);
        expect(revokedObjectUrls).toEqual(["blob:mock-0"]);
    });

    test("should still revoke the object URL when the click throws", () => {
        document.createElement = ((tagName: string, _options?: ElementCreationOptions) => {
            const el = originalCreateElement.call(document, tagName, _options);
            if (tagName === "a") {
                (el as HTMLAnchorElement).click = () => {
                    throw new Error("click failed");
                };
                Object.defineProperty(el, "href", { set() {}, get: () => "" });
                Object.defineProperty(el, "download", { set() {}, get: () => "" });
            }
            return el;
        }) as typeof document.createElement;

        expect(() => download(["data"], "file.txt")).toThrow("click failed");

        rs.advanceTimersByTime(10_000);
        expect(revokedObjectUrls.length).toBe(1);
    });

    test("should handle empty data array", () => {
        download([], "empty.txt");
        expect(clickCalled).toBe(true);
        expect(createdObjectUrls.length).toBe(1);
    });

    test("should handle multiple BlobParts", () => {
        download(["part1", "part2", "part3"], "multi.txt");
        expect(createdObjectUrls.length).toBe(1);
        expect(clickCalled).toBe(true);
    });

    test("should handle special characters in filename", () => {
        download(["data"], "文件名-测试.step");
        expect(clickCalled).toBe(true);

        rs.advanceTimersByTime(10_000);
        expect(revokedObjectUrls.length).toBe(1);
    });

    test("should create Blob from string data", () => {
        const jsonData = JSON.stringify({ key: "value" });
        download([jsonData], "data.json");
        expect(createdObjectUrls.length).toBe(1);
        expect(anchorDownload).toBe("data.json");
    });
});
