// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PendingWork, quietFrames } from "../src/foundation/pendingWork";

describe("PendingWork", () => {
    test("starts idle and reports work while a release is outstanding", () => {
        const work = new PendingWork();
        expect(work.isIdle).toBe(true);

        const release = work.begin();
        expect(work.isIdle).toBe(false);

        release();
        expect(work.isIdle).toBe(true);
    });

    test("overlapping work keeps it busy until the last release", () => {
        const work = new PendingWork();
        const first = work.begin();
        const second = work.begin();

        first();
        expect(work.isIdle).toBe(false);

        second();
        expect(work.isIdle).toBe(true);
    });

    test("releasing twice does not make it idle early", () => {
        // The caller is a transport that may run its release both on the success path and
        // in a `finally`; a double release that counted down twice would report idle while
        // the other work is still running.
        const work = new PendingWork();
        const release = work.begin();
        work.begin();

        release();
        release();
        expect(work.isIdle).toBe(false);
    });

    test("whenIdle resolves at once when nothing is in flight", async () => {
        const work = new PendingWork();
        let resolved = false;
        await work.whenIdle().then(() => {
            resolved = true;
        });
        expect(resolved).toBe(true);
    });

    test("whenIdle waits for the outstanding work, whichever release finishes it", async () => {
        const work = new PendingWork();
        const release = work.begin();
        const first = work.whenIdle();
        const second = work.whenIdle();

        let firstDone = false;
        let secondDone = false;
        void first.then(() => {
            firstDone = true;
        });
        void second.then(() => {
            secondDone = true;
        });

        await Promise.resolve();
        expect(firstDone).toBe(false);
        expect(secondDone).toBe(false);

        release();
        await first;
        await second;
        expect(firstDone).toBe(true);
        expect(secondDone).toBe(true);
    });

    test("quietFrames resolves where there is no animation frame to wait for", async () => {
        const original = globalThis.requestAnimationFrame;
        // happy-dom has no frame loop worth the name; the fallback is what a test (and a
        // runner driving `Runtime.evaluate` before the first paint) ends up on.
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
        try {
            let resolved = false;
            await quietFrames().then(() => {
                resolved = true;
            });
            expect(resolved).toBe(true);
        } finally {
            globalThis.requestAnimationFrame = original;
        }
    });
});
