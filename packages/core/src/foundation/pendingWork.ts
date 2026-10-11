// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * How much work the app still has in flight, so a caller can wait for it to settle
 * instead of guessing a delay. A fixed sleep is either longer than it needs to be or —
 * the case that hurts — shorter, and then the next step acts on a half-finished rebuild
 * and the failure looks like a bug in the feature being tested.
 *
 * What counts is ASYNC work: a command that returns a promise, an open or a save, a
 * plugin load. A synchronous rebuild or paint has already finished by the time its caller
 * returns, so it is not in here — which is why {@link quietFrames} exists beside it: the
 * pair is "nothing is pending, and the last thing that ran has had a chance to land".
 */
export class PendingWork {
    private count = 0;
    private readonly waiters = new Set<() => void>();

    /**
     * Marks work as in flight and returns the release. The release is idempotent, so a
     * caller may both call it in a `finally` and let a later branch call it again.
     */
    begin(): () => void {
        this.count += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.count -= 1;
            if (this.count > 0) return;
            const waiting = [...this.waiters];
            this.waiters.clear();
            for (const resolve of waiting) resolve();
        };
    }

    get isIdle(): boolean {
        return this.count === 0;
    }

    /** Resolves once nothing is in flight; already-resolved when nothing is. */
    whenIdle(): Promise<void> {
        if (this.count === 0) return Promise.resolve();
        return new Promise((resolve) => this.waiters.add(resolve));
    }
}

/** The application-wide instance. One app, one counter — same as `getCurrentApplication`. */
export const pendingWork = new PendingWork();

/**
 * Resolves after `count` animation frames have gone by with nothing repainting in
 * between. Waiting for a frame is not the same as waiting for the app: a step that
 * changed something needs the frame that draws it before the next step can look at it.
 *
 * Falls back to a timer where there is no `requestAnimationFrame` (happy-dom, a headless
 * runner driving `Runtime.evaluate` before the first frame): the intent is still "let the
 * loop turn", and a zero-delay timer turns it.
 */
export function quietFrames(count = 2): Promise<void> {
    if (typeof requestAnimationFrame !== "function") {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Promise((resolve) => {
        let left = count;
        const tick = () => {
            left -= 1;
            if (left <= 0) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}
