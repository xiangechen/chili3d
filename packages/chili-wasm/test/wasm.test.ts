import initWasm, { MainModule } from "../lib/chili-wasm";

let wasm: MainModule;

beforeAll(async () => {
    wasm = await initWasm();
}, 30000);

test("wasm init", () => {
    expect(wasm).toBeDefined();
});

test("wasm add", () => {
    let point1 = new wasm.Point3(1, 2, 3);
    let point2 = new wasm.Point3(4, 2, 3);
    let vector = wasm.makeDir(point1, point2);
    expect(vector.x).toBe(1);
});
