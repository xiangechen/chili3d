const initWasm = await import("../build/target/release/chili-wasm.js");
/** @type {import('../build/target/release/chili-wasm.d.ts').EmbindModule} */
globalThis.wasm = await initWasm.default();
globalThis.test = test;

(async function runTest() {
    await import("./test.js");
})();

function resultMessage(passed, failed, time) {
    const p = document.createElement("p");
    p.className = "result";
    p.innerHTML = `Passed: ${passed}, Failed: ${failed}, Time: ${time}`;
    if (failed > 0) {
        p.className += " failed";
    }
    return p;
}

function failedMessage(actual, expected) {
    const p = document.createElement("p");
    p.innerHTML = `Expected ${expected}, but got ${actual}`;
    p.className = "failed";
    return p;
}

async function test(name, fn) {
    var passed = 0,
        failed = 0;
    const expect = (actual) => {
        return {
            toBe(expected) {
                if (actual !== expected) {
                    div.append(failedMessage(actual, expected));
                    failed++;
                } else {
                    passed++;
                }
            },
        };
    };

    const div = document.createElement("div");
    div.className = "test";
    output.append(div);
    const title = document.createElement("h2");
    div.innerHTML = name;
    output.append(title);
    const start = performance.now();
    await Promise.try(fn, expect).catch((e) => {
        failed++;
        const p = document.createElement("p");
        p.innerHTML = e.message;
        p.className = "failed";
        div.append(p);
    });
    const end = performance.now();
    div.append(resultMessage(passed, failed, end - start));
}
