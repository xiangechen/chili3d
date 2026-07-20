// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    button,
    createElement,
    createIcon,
    div,
    img,
    input,
    label,
    setSVGIcon,
    span,
    svg,
} from "../src/elements";

describe("createElement", () => {
    test("should create an element with the given tag", () => {
        const el = createElement("div")();
        expect(el.tagName).toBe("DIV");
    });

    test("should create a span element", () => {
        const el = createElement("span")();
        expect(el.tagName).toBe("SPAN");
    });

    test("should set text content when props is a string", () => {
        const el = createElement("span")("Hello");
        expect(el.textContent).toBe("Hello");
    });

    test("should append props when it is a Node", () => {
        const child = document.createElement("span");
        child.textContent = "child";
        const el = createElement("div")(child);
        expect(el.children.length).toBe(1);
        expect(el.children[0].textContent).toBe("child");
    });

    test("should set properties when props is an object", () => {
        const el = createElement("div")({ className: "test-class", id: "test-id" });
        expect(el.className).toBe("test-class");
        expect(el.id).toBe("test-id");
    });

    test("should append children", () => {
        const c1 = document.createElement("span");
        c1.textContent = "A";
        const c2 = "text-node";
        const el = createElement("div")(undefined, c1, c2);
        expect(el.children.length).toBe(1);
        expect(el.childNodes.length).toBe(2); // span + text
    });

    test("should handle no props and no children", () => {
        const el = createElement("div")();
        expect(el.tagName).toBe("DIV");
        expect(el.children.length).toBe(0);
    });
});

describe("predefined element factories", () => {
    test("div should create a DIV", () => {
        expect(div().tagName).toBe("DIV");
    });

    test("span should create a SPAN", () => {
        expect(span().tagName).toBe("SPAN");
    });

    test("input should create an INPUT", () => {
        expect(input().tagName).toBe("INPUT");
    });

    test("button should create a BUTTON", () => {
        expect(button().tagName).toBe("BUTTON");
    });

    test("label should create a LABEL", () => {
        expect(label().tagName).toBe("LABEL");
    });

    test("img should create an IMG", () => {
        expect(img().tagName).toBe("IMG");
    });

    test("factories should accept props", () => {
        const el = div({ className: "wrapper" });
        expect(el.className).toBe("wrapper");
    });

    test("factories should accept children", () => {
        const el = div(undefined, span(undefined, "text"));
        expect(el.children.length).toBe(1);
        expect(el.children[0].textContent).toBe("text");
    });
});

describe("svg", () => {
    test("should create an SVG element with a use element", () => {
        const el = svg({ icon: "icon-test", className: "svg-icon" });
        expect(el.tagName).toBe("svg");
        expect(el.children.length).toBe(1);
        const useEl = el.children[0] as SVGUseElement;
        const href = useEl.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        expect(href).toBe("#icon-test");
    });

    test("should add CSS class to SVG", () => {
        const el = svg({ icon: "icon-test", className: "my-svg" });
        expect(el.classList.contains("my-svg")).toBe(true);
    });

    test("should set properties on SVG via setProperties", () => {
        // Properties like id are set via setProperties and work with SVG elements
        const el = svg({ icon: "icon-test", className: "cls", id: "svg-icon-1" });
        expect(el.id).toBe("svg-icon-1");
    });

    test("should add title element when title is a string", () => {
        const el = svg({ icon: "icon-test", className: "cls", title: "Test Title" as any });
        // The title element should be appended
        const titles = el.querySelectorAll("title");
        expect(titles.length).toBe(1);
        expect(titles[0].textContent).toBe("Test Title");
    });
});

describe("setSVGIcon", () => {
    test("should update the href of the use element", () => {
        const el = svg({ icon: "icon-old" });
        setSVGIcon(el, "icon-new");
        const useEl = el.children[0] as SVGUseElement;
        const href = useEl.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        expect(href).toBe("#icon-new");
    });

    test("should not throw when SVG has no children", () => {
        const emptySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        expect(() => setSVGIcon(emptySvg, "icon")).not.toThrow();
    });
});

describe("createIcon", () => {
    test("should create SVG for string icon", () => {
        const el = createIcon("icon-box");
        expect(el.tagName).toBe("svg");
        const useEl = el.children[0] as SVGUseElement;
        expect(useEl.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#icon-box");
    });

    test("should create SVG element for svg type", () => {
        const el = createIcon({ type: "svg", value: "<svg><circle/></svg>" });
        expect(el.tagName).toBe("svg");
    });

    test("should create img for png type", () => {
        const bytes = new Uint8Array([137, 80, 78, 71]); // PNG header
        const el = createIcon({ type: "png", value: bytes });
        expect(el.tagName).toBe("IMG");
        expect((el as HTMLImageElement).src.startsWith("data:image/png;base64,")).toBe(true);
    });

    test("should create img for url type", () => {
        const el = createIcon({ type: "url", value: "https://example.com/icon.png" });
        expect(el.tagName).toBe("IMG");
        expect((el as HTMLImageElement).src).toBe("https://example.com/icon.png");
    });

    test("should throw for path type", () => {
        expect(() => createIcon({ type: "path", value: "/icons/test.svg" })).toThrow(
            "Plugin icon is not supported",
        );
    });

    test("should return default icon for unknown type", () => {
        const el = createIcon({ type: "unknown", value: "data" } as any);
        expect(el.tagName).toBe("svg");
        const useEl = el.children[0] as SVGUseElement;
        expect(useEl.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#icon-chili");
    });
});

describe("uint8ArrayToBase64 (private)", () => {
    test("should convert empty Uint8Array", () => {
        // Test via createIcon with empty PNG bytes
        const el = createIcon({ type: "png", value: new Uint8Array([]) });
        expect((el as HTMLImageElement).src).toBe("data:image/png;base64,");
    });

    test("should convert printable ASCII", () => {
        // "hello" in ASCII
        const bytes = new Uint8Array([104, 101, 108, 108, 111]);
        const el = createIcon({ type: "png", value: bytes });
        expect((el as HTMLImageElement).src).toBe("data:image/png;base64,aGVsbG8=");
    });
});
