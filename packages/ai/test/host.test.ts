// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createToolHost } from "../src/tools/host";

describe("tool host", () => {
    test("does not offer the in-app ask_user to an external client", () => {
        const names = createToolHost()
            .list()
            .map((tool) => tool.name);
        expect(names).not.toContain("ask_user");
        expect(names).toContain("run_program");
    });

    test("explains that ask_user is unavailable rather than reporting it as unknown", async () => {
        const reply = await createToolHost().call("ask_user", { question: "keep or discard?" });
        expect(reply.ok).toBe(false);
        expect(reply.content).toContain("not available over the bridge");
    });
});
