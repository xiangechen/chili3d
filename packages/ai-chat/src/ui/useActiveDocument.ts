import { useEffect, useState } from "react";
import { getApplication, getCore } from "../bridge/parent";
import { SCRATCH_DOC_ID } from "./chat-store";

/**
 * Returns the id of the currently active chili3d document, or SCRATCH_DOC_ID
 * when no document is open. Subscribes to the parent's `activeViewChanged`
 * PubSub event so the UI re-renders when the user opens or switches docs.
 */
export function useActiveDocumentId(): string {
    const [id, setId] = useState<string>(() => {
        try {
            return getApplication().activeView?.document?.id ?? SCRATCH_DOC_ID;
        } catch {
            return SCRATCH_DOC_ID;
        }
    });

    useEffect(() => {
        const core = getCore();
        const pubsub = core.PubSub.default;
        const handler = () => {
            try {
                setId(getApplication().activeView?.document?.id ?? SCRATCH_DOC_ID);
            } catch {
                setId(SCRATCH_DOC_ID);
            }
        };
        pubsub.sub("activeViewChanged", handler);
        // The app may already have an active document by the time the iframe
        // mounts, so run once on attach.
        handler();
        return () => pubsub.remove("activeViewChanged", handler);
    }, []);

    return id;
}
