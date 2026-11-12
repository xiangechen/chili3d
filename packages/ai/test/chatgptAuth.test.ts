// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage } from "@chili3d/core";
import { mockLocalStorage } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    buildAuthorizeUrl,
    CHATGPT_ISSUER,
    CHATGPT_PLAN_SCOPE,
    CHATGPT_RESOURCE,
    type ChatGPTAuthRecord,
    chatGPTAccessToken,
    chatGPTRedirectUri,
    checkIdToken,
    completeSignIn,
    isSignedInToChatGPT,
    newSignInAttempt,
    parseCallback,
    pkceChallenge,
    readAuthRecord,
    type SignInAttempt,
    signOutOfChatGPT,
} from "../src/chatgptAuth";
import { hasCredentials } from "../src/settings";

const REDIRECT = "http://127.0.0.1:8080/auth/callback";
const SCOPE = `openid profile email offline_access resource.invoke ${CHATGPT_PLAN_SCOPE}`;

function b64url(value: object): string {
    return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function idToken(claims: object): string {
    return `${b64url({ alg: "RS256" })}.${b64url(claims)}.sig`;
}

function validClaims(nonce: string, clientId = "oaiapp_1") {
    return {
        iss: CHATGPT_ISSUER,
        aud: clientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce,
        sub: "user-1",
        email: "a@example.com",
    };
}

const fetchMock = rs.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));

function respond(body: object, status = 200) {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
}

function sentForm(call: number): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body)));
}

function storeRecord(record: ChatGPTAuthRecord) {
    ObjectStorage.default.setValue("ai.chatgpt", record);
}

function attempt(): SignInAttempt {
    return { verifier: "v", challenge: "c", state: "s1", nonce: "n1", redirectUri: REDIRECT };
}

beforeEach(() => {
    mockLocalStorage();
    fetchMock.mockReset();
    rs.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    rs.unstubAllGlobals();
});

describe("chatgpt redirect and PKCE", () => {
    test("only a page on http://127.0.0.1 can receive the redirect", () => {
        expect(chatGPTRedirectUri({ protocol: "http:", hostname: "127.0.0.1", port: "8080" })).toBe(REDIRECT);
        // OpenAI refuses `localhost`, and a hosted address is not a loopback at all.
        expect(
            chatGPTRedirectUri({ protocol: "http:", hostname: "localhost", port: "8080" }),
        ).toBeUndefined();
        expect(chatGPTRedirectUri({ protocol: "https:", hostname: "chili3d.com", port: "" })).toBeUndefined();
    });

    test("derives the S256 challenge of RFC 7636's example", async () => {
        expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    });

    test("gives every attempt its own state, nonce and verifier", async () => {
        const a = await newSignInAttempt(REDIRECT);
        const b = await newSignInAttempt(REDIRECT);

        expect(a.state).not.toBe(b.state);
        expect(a.nonce).not.toBe(b.nonce);
        expect(a.verifier).not.toBe(b.verifier);
        expect(a.challenge).toBe(await pkceChallenge(a.verifier));
    });
});

describe("chatgpt authorize URL", () => {
    test("a first sign-in registers through the dynamic client and names the app", () => {
        const url = new URL(buildAuthorizeUrl(attempt(), { hostId: "urn:uuid:h" }));
        const params = url.searchParams;

        expect(`${url.origin}${url.pathname}`).toBe(`${CHATGPT_ISSUER}/api/accounts/authorize`);
        expect(params.get("client_id")).toBe("dynamic_agent_client");
        expect(params.get("agent_name_hint")).toBe("Chili3D");
        expect(params.get("ext_agent_host_id")).toBe("urn:uuid:h");
        expect(params.get("scope")).toBe(SCOPE);
        expect(params.get("resource")).toBe(CHATGPT_RESOURCE);
        expect(params.get("redirect_uri")).toBe(REDIRECT);
        expect(params.get("code_challenge_method")).toBe("S256");
        expect(params.has("id_token_hint")).toBe(false);
    });

    test("a returning sign-in reuses the issued client and passes the hints", () => {
        const record = { hostId: "h", clientId: "oaiapp_1", idToken: "tok", email: "a@example.com" };
        const params = new URL(buildAuthorizeUrl(attempt(), record)).searchParams;

        expect(params.get("client_id")).toBe("oaiapp_1");
        expect(params.get("id_token_hint")).toBe("tok");
        expect(params.get("login_hint")).toBe("a@example.com");
        expect(params.has("agent_name_hint")).toBe(false);
    });
});

describe("chatgpt callback", () => {
    const record = { hostId: "h" };

    test("accepts this attempt's code and the issued client id", () => {
        const result = parseCallback("?code=abc&state=s1&client_id=oaiapp_1", attempt(), record);

        expect(result.isOk).toBe(true);
        expect(result.value).toEqual({ code: "abc", clientId: "oaiapp_1" });
    });

    test.each([
        ["another attempt's state", "?code=abc&state=other&client_id=oaiapp_1", { hostId: "h" }],
        ["a denial", "?error=access_denied&state=s1", { hostId: "h" }],
        ["a missing client id on a first sign-in", "?code=abc&state=s1", { hostId: "h" }],
        [
            "a client other than the registered one",
            "?code=abc&state=s1&client_id=oaiapp_2",
            { hostId: "h", clientId: "oaiapp_1" },
        ],
    ])("refuses %s", (_name, search, saved) => {
        expect(parseCallback(search, attempt(), saved).isOk).toBe(false);
    });

    test("a reauthorization may leave the client id out", () => {
        const result = parseCallback("?code=abc&state=s1", attempt(), { hostId: "h", clientId: "oaiapp_1" });

        expect(result.value).toEqual({ code: "abc", clientId: "oaiapp_1" });
    });
});

describe("chatgpt ID token", () => {
    test("accepts the claims of this attempt", () => {
        const result = checkIdToken(idToken(validClaims("n1")), "oaiapp_1", "n1");

        expect(result.value).toEqual({ accountId: "user-1", email: "a@example.com" });
    });

    test.each([
        ["another nonce", { nonce: "n2" }],
        ["another audience", { aud: "oaiapp_2" }],
        ["another issuer", { iss: "https://evil.example" }],
        ["an expired token", { exp: 1 }],
    ])("refuses %s", (_name, override) => {
        const token = idToken({ ...validClaims("n1"), ...override });

        expect(checkIdToken(token, "oaiapp_1", "n1").isOk).toBe(false);
    });

    test("refuses something that is not a JWT", () => {
        expect(checkIdToken("garbage", "oaiapp_1", "n1").isOk).toBe(false);
    });
});

describe("chatgpt sign-in completion", () => {
    test("exchanges the code and stores the session and registration", async () => {
        respond({
            access_token: "at",
            refresh_token: "rt",
            id_token: idToken(validClaims("n1")),
            expires_in: 3600,
            scope: SCOPE,
        });

        const result = await completeSignIn({ code: "abc", clientId: "oaiapp_1" }, attempt());

        expect(result.isOk).toBe(true);
        expect(sentForm(0)).toEqual({
            grant_type: "authorization_code",
            client_id: "oaiapp_1",
            code: "abc",
            code_verifier: "v",
            redirect_uri: REDIRECT,
            resource: CHATGPT_RESOURCE,
        });
        const stored = readAuthRecord();
        expect(stored.clientId).toBe("oaiapp_1");
        expect(stored.email).toBe("a@example.com");
        expect(stored.session?.refreshToken).toBe("rt");
        expect(isSignedInToChatGPT()).toBe(true);
        expect(hasCredentials({ provider: "chatgpt", apiKey: "", model: "m" })).toBe(true);
    });

    test("a sign-in without the plan scope is not a usable one", async () => {
        respond({
            access_token: "at",
            refresh_token: "rt",
            id_token: idToken(validClaims("n1")),
            scope: "openid",
        });

        const result = await completeSignIn({ code: "abc", clientId: "oaiapp_1" }, attempt());

        expect(result.isOk).toBe(false);
        expect(isSignedInToChatGPT()).toBe(false);
    });

    test("a refused exchange is reported, not thrown", async () => {
        respond({ error: "invalid_grant", error_description: "code expired" }, 400);

        const result = await completeSignIn({ code: "abc", clientId: "oaiapp_1" }, attempt());

        expect(result.isOk).toBe(false);
        expect(result.error).toBe("ai.chatgpt.exchangeFailed");
    });
});

describe("chatgpt access token", () => {
    const signedIn = (expiresAt: number): ChatGPTAuthRecord => ({
        hostId: "h",
        clientId: "oaiapp_1",
        session: { accessToken: "old", refreshToken: "rt1", expiresAt, scope: SCOPE },
    });

    test("hands back a live token without asking for another", async () => {
        storeRecord(signedIn(Date.now() + 30 * 60_000));

        expect(await chatGPTAccessToken()).toBe("old");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("refreshes a token about to expire, once for concurrent callers, and keeps the rotated one", async () => {
        storeRecord(signedIn(Date.now() + 10_000));
        respond({ access_token: "new", refresh_token: "rt2", expires_in: 3600, scope: SCOPE });

        const tokens = await Promise.all([chatGPTAccessToken(), chatGPTAccessToken()]);

        expect(tokens).toEqual(["new", "new"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentForm(0)).toEqual({
            grant_type: "refresh_token",
            client_id: "oaiapp_1",
            refresh_token: "rt1",
            resource: CHATGPT_RESOURCE,
        });
        expect(readAuthRecord().session?.refreshToken).toBe("rt2");
    });

    test("a dead grant signs the user out but keeps the registration", async () => {
        storeRecord(signedIn(0));
        respond({ error: "invalid_grant" }, 400);

        await expect(chatGPTAccessToken()).rejects.toThrow("ai.chatgpt.expired");
        expect(isSignedInToChatGPT()).toBe(false);
        expect(readAuthRecord().clientId).toBe("oaiapp_1");
    });

    test("no session, no token", async () => {
        await expect(chatGPTAccessToken()).rejects.toThrow("ai.chatgpt.signedOut");
        expect(hasCredentials({ provider: "chatgpt", apiKey: "", model: "m" })).toBe(false);
    });

    test("signing out revokes the refresh token and forgets the session", async () => {
        storeRecord(signedIn(Date.now() + 30 * 60_000));
        fetchMock.mockImplementationOnce(async () => new Response("", { status: 200 }));

        expect(await signOutOfChatGPT()).toBe(true);
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${CHATGPT_ISSUER}/api/accounts/oauth/revoke`);
        expect(sentForm(0)).toEqual({
            token: "rt1",
            token_type_hint: "refresh_token",
            client_id: "oaiapp_1",
        });
        expect(isSignedInToChatGPT()).toBe(false);
        expect(readAuthRecord().clientId).toBe("oaiapp_1");
    });

    test("an unconfirmed revocation still clears the session here", async () => {
        storeRecord(signedIn(Date.now() + 30 * 60_000));
        fetchMock.mockImplementationOnce(async () => {
            throw new TypeError("offline");
        });

        expect(await signOutOfChatGPT()).toBe(false);
        expect(isSignedInToChatGPT()).toBe(false);
    });
});
