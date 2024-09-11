import initWasm, { MainModule } from "../lib/chili-wasm";

let wasm: MainModule;

beforeAll(async () => {
    wasm = await initWasm();
}, 30000);

test("wasm init", () => {
    expect(wasm).toBeDefined();
});

test("test face mesh", () => {
    let point1 = new wasm.gp_Pnt(0, 0, 0);
    let direction = new wasm.gp_Dir(0, 0, 1);
    let ax2 = new wasm.gp_Ax2(point1, direction);
    let box = wasm.ShapeFactory.makeBox(ax2, 1, 1, 1);
    let mesh = new wasm.FaceMesh(box);

    expect(mesh.getPosition().length).toBe(72);
    expect(mesh.getIndex().length).toBe(36);
    expect(mesh.getGroups().length).toBe(18);
    expect(mesh.getNormal().length).toBe(72);
    expect(mesh.getUV().length).toBe(48);
});

test("test mesh 5000", () => {
    let start = performance.now();
    let count = 0;
    for (let i = 0; i < 5000; i++) {
        let point1 = new wasm.gp_Pnt(0, 0, 0);
        let direction = new wasm.gp_Dir(0, 0, 1);
        let ax2 = new wasm.gp_Ax2(point1, direction);
        let box = wasm.ShapeFactory.makeBox(ax2, 1, 1, 1);
        let mesh = new wasm.FaceMesh(box);
        count += mesh.getPosition().length;
        point1.delete();
        direction.delete();
        ax2.delete();
        box.delete();
        mesh.delete();
    }
    let end = performance.now();
    console.log("time(ms):", end - start, "count:", count);
});
