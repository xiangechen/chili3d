// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, ObjectStorage, Result } from "@chili3d/core";

/**
 * "Sign in with ChatGPT" with plan usage: the user's ChatGPT Plus/Pro allowance pays for the
 * assistant instead of an API key. The flow is OpenAI's documented one for open-source apps
 * (developers.openai.com/siwc/token-sharing-open-source): PKCE against auth.openai.com, a loopback
 * redirect on 127.0.0.1, and the access token sent as the bearer on `api.openai.com/v1/responses`.
 *
 * Sign-in runs entirely in the page — both auth endpoints answer CORS with `*` — and inference goes
 * through the serving origin (see `chatGPTApiBase`). The one thing a browser app cannot fake is the
 * redirect: OpenAI only accepts `http://127.0.0.1:<port>/auth/callback`,
 * which means sign-in works when the app itself is served from 127.0.0.1 (`npm run dev`, a local
 * Docker run). The callback lands on `public/auth/callback/index.html`, a static page that hands
 * the query string back over a BroadcastChannel without loading the app.
 *
 * Unlike the API key (session-only, see settings.ts), the tokens are persisted: the refresh token
 * rotates on every refresh, so a copy kept anywhere else would go stale within the hour. Signing
 * out revokes it and clears it.
 */

export const CHATGPT_ISSUER = "https://auth.openai.com";
/** The audience the tokens are issued for — the OAuth `resource`, not where requests are sent. */
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
/**
 * Where plan requests are sent: the app's own origin, which forwards `/openai/*` to api.openai.com
 * (the dev server's proxy in rspack.config.ts, the nginx location in docker/nginx.conf). The API
 * answers a ChatGPT-token request without CORS headers — an API key gets them, a token does not —
 * so a page cannot call it directly. Sign-in already requires the app to be served from 127.0.0.1
 * by one of those two servers, so the proxy is there whenever the plan can be used.
 */
export function chatGPTApiBase(): string {
    return `${window.location.origin}/openai/v1`;
}
export const CHATGPT_CALLBACK_PATH = "/auth/callback";
export const CHATGPT_CALLBACK_CHANNEL = "chili3d.chatgpt-auth";
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";

const AUTHORIZE_URL = `${CHATGPT_ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/token`;
const REVOKE_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`;
const SCOPES = `openid profile email offline_access resource.invoke ${CHATGPT_PLAN_SCOPE}`;
/** The first-registration entrypoint — never stored, never used for a token exchange. */
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME = "Chili3D";
const STORAGE_KEY = "ai.chatgpt";
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
/** Refresh this long before the access token runs out, so a request never leaves with a dead one. */
const REFRESH_MARGIN_MS = 60_000;

export interface ChatGPTSession {
    accessToken: string;
    refreshToken: string;
    /** Epoch milliseconds. */
    expiresAt: number;
    scope: string;
}

/**
 * What survives between sign-ins. `hostId` and `clientId` are the registration — reused for every
 * later sign-in on this browser, so signing out and in again does not mint a new client — and
 * `idToken`/`email` are the hints that let a returning sign-in skip the account picker.
 */
export interface ChatGPTAuthRecord {
    hostId: string;
    clientId?: string;
    accountId?: string;
    email?: string;
    idToken?: string;
    session?: ChatGPTSession;
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

/** An OAuth error from the token endpoint, keeping the code so callers can tell `invalid_grant`. */
export class ChatGPTAuthError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export function readAuthRecord(): ChatGPTAuthRecord {
    const saved = peekAuthRecord();
    if (saved?.hostId) return saved;
    // Chosen once and kept: OpenAI asks for a stable, per-host identifier before the first sign-in.
    const record: ChatGPTAuthRecord = { hostId: `urn:uuid:${crypto.randomUUID()}` };
    writeAuthRecord(record);
    return record;
}

function writeAuthRecord(record: ChatGPTAuthRecord): void {
    ObjectStorage.default.setValue(STORAGE_KEY, record);
}

/** Read without minting a host id — asking whether anyone is signed in should not write. */
function peekAuthRecord(): ChatGPTAuthRecord | undefined {
    return ObjectStorage.default.value<ChatGPTAuthRecord>(STORAGE_KEY);
}

export function isSignedInToChatGPT(): boolean {
    return !!peekAuthRecord()?.session;
}

export function chatGPTAccountEmail(): string | undefined {
    const record = peekAuthRecord();
    return record?.session ? record.email : undefined;
}

/**
 * The redirect OpenAI will accept from this page, or undefined when the page is not on 127.0.0.1.
 * `localhost` is refused by OpenAI ("Do not substitute with localhost"), and the callback has to
 * reach this same origin for the BroadcastChannel to carry it back.
 */
export function chatGPTRedirectUri(location: Pick<Location, "protocol" | "hostname" | "port">) {
    if (location.protocol !== "http:" || location.hostname !== "127.0.0.1") return undefined;
    return `http://127.0.0.1${location.port ? `:${location.port}` : ""}${CHATGPT_CALLBACK_PATH}`;
}

export interface SignInAttempt {
    verifier: string;
    challenge: string;
    state: string;
    nonce: string;
    redirectUri: string;
}

function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
}

/** Fresh state, nonce and PKCE verifier — every attempt gets its own, as the flow requires. */
export async function newSignInAttempt(redirectUri: string): Promise<SignInAttempt> {
    const verifier = randomToken();
    return {
        verifier,
        challenge: await pkceChallenge(verifier),
        state: randomToken(),
        nonce: randomToken(),
        redirectUri,
    };
}

/**
 * A first sign-in registers through `dynamic_agent_client` and names the app; a returning one uses
 * the issued client id and hands back the last ID token so the account picker can be skipped.
 */
export function buildAuthorizeUrl(attempt: SignInAttempt, record: ChatGPTAuthRecord): string {
    const params = new URLSearchParams({
        client_id: record.clientId ?? REGISTRATION_CLIENT_ID,
        ext_agent_host_id: record.hostId,
        response_type: "code",
        redirect_uri: attempt.redirectUri,
        scope: SCOPES,
        resource: CHATGPT_RESOURCE,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: "S256",
        code_challenge: attempt.challenge,
    });
    if (!record.clientId) params.set("agent_name_hint", AGENT_NAME);
    if (record.clientId && record.idToken) params.set("id_token_hint", record.idToken);
    if (record.clientId && record.email) params.set("login_hint", record.email);
    return `${AUTHORIZE_URL}?${params}`;
}

/**
 * The callback's query, checked before anything is exchanged: the state must be this attempt's,
 * a denial stops here, and a client id other than the one already registered is refused.
 */
export function parseCallback(
    search: string,
    attempt: SignInAttempt,
    record: ChatGPTAuthRecord,
): Result<{ code: string; clientId: string }> {
    const params = new URLSearchParams(search);
    if (params.get("state") !== attempt.state) return Result.err(I18n.translate("ai.chatgpt.stateMismatch"));
    const error = params.get("error");
    if (error)
        return Result.err(I18n.translate("ai.chatgpt.denied", params.get("error_description") ?? error));
    const code = params.get("code");
    const clientId = params.get("client_id") ?? record.clientId;
    if (!code || !clientId) return Result.err(I18n.translate("ai.chatgpt.noCode"));
    if (record.clientId && clientId !== record.clientId) {
        return Result.err(I18n.translate("ai.chatgpt.clientMismatch"));
    }
    return Result.ok({ code, clientId });
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
    });
    const json = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || json.error) {
        const code = json.error ?? `http_${response.status}`;
        throw new ChatGPTAuthError(code, json.error_description ?? code);
    }
    return json;
}

interface IdTokenClaims {
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
    nonce?: unknown;
    sub?: unknown;
    email?: unknown;
}

function decodeJwtPayload(token: string): IdTokenClaims {
    const part = token.split(".")[1] ?? "";
    const padded = part
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * The ID token's claims, checked against this attempt. Its signature is not verified here: OpenAI's
 * JWKS answers without CORS headers, so a page cannot read it — and the token came straight from
 * the token endpoint over TLS, which OIDC Core (3.1.3.7) accepts in place of the signature check.
 */
export function checkIdToken(
    idToken: string,
    clientId: string,
    nonce: string,
    now = Date.now(),
): Result<{ accountId: string; email?: string }> {
    let claims: IdTokenClaims;
    try {
        claims = decodeJwtPayload(idToken);
    } catch {
        return Result.err(I18n.translate("ai.chatgpt.badIdToken"));
    }
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const valid =
        claims.iss === CHATGPT_ISSUER &&
        audience.includes(clientId) &&
        typeof claims.exp === "number" &&
        claims.exp * 1000 > now &&
        claims.nonce === nonce &&
        typeof claims.sub === "string";
    if (!valid) return Result.err(I18n.translate("ai.chatgpt.badIdToken"));
    const email = typeof claims.email === "string" ? claims.email : undefined;
    return Result.ok({ accountId: claims.sub as string, email });
}

function toSession(tokens: TokenResponse, previous?: ChatGPTSession, now = Date.now()): ChatGPTSession {
    return {
        accessToken: tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? "",
        expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
        scope: tokens.scope ?? previous?.scope ?? "",
    };
}

/** Exchange the callback's code, validate what came back, and store it as the signed-in session. */
export async function completeSignIn(
    callback: { code: string; clientId: string },
    attempt: SignInAttempt,
): Promise<Result<ChatGPTAuthRecord>> {
    let tokens: TokenResponse;
    try {
        tokens = await tokenRequest({
            grant_type: "authorization_code",
            client_id: callback.clientId,
            code: callback.code,
            code_verifier: attempt.verifier,
            redirect_uri: attempt.redirectUri,
            resource: CHATGPT_RESOURCE,
        });
    } catch (e) {
        return Result.err(I18n.translate("ai.chatgpt.exchangeFailed", (e as Error).message));
    }
    const identity = checkIdToken(tokens.id_token ?? "", callback.clientId, attempt.nonce);
    if (!identity.isOk) return Result.err(identity.error);
    // Signed in is not funded: without this scope the account cannot spend its plan here.
    if (!(tokens.scope ?? "").split(" ").includes(CHATGPT_PLAN_SCOPE)) {
        return Result.err(I18n.translate("ai.chatgpt.notFunded"));
    }
    const record: ChatGPTAuthRecord = {
        ...readAuthRecord(),
        clientId: callback.clientId,
        accountId: identity.value.accountId,
        email: identity.value.email,
        idToken: tokens.id_token,
        session: toSession(tokens),
    };
    writeAuthRecord(record);
    return Result.ok(record);
}

/** The callback page's query string for this attempt, or an error when it never arrives. */
function waitForCallback(state: string, signal?: AbortSignal): Promise<Result<string>> {
    return new Promise((resolve) => {
        const channel = new BroadcastChannel(CHATGPT_CALLBACK_CHANNEL);
        const finish = (result: Result<string>) => {
            clearTimeout(timer);
            channel.close();
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
        };
        const onAbort = () => finish(Result.err(I18n.translate("ai.chatgpt.cancelled")));
        const timer = setTimeout(
            () => finish(Result.err(I18n.translate("ai.chatgpt.timeout"))),
            SIGN_IN_TIMEOUT_MS,
        );
        signal?.addEventListener("abort", onAbort);
        channel.onmessage = (e: MessageEvent) => {
            // Another tab's attempt shares the channel; only this attempt's state is ours.
            if (typeof e.data === "string" && new URLSearchParams(e.data).get("state") === state) {
                finish(Result.ok(e.data));
            }
        };
    });
}

/**
 * The whole sign-in, started from a click: the popup is opened before the first `await`, or the
 * browser's popup blocker would treat it as unprompted.
 */
export async function signInWithChatGPT(signal?: AbortSignal): Promise<Result<ChatGPTAuthRecord>> {
    const redirectUri = chatGPTRedirectUri(window.location);
    if (!redirectUri)
        return Result.err(I18n.translate("ai.chatgpt.needLoopback", window.location.port || "80"));
    const popup = window.open("about:blank", "chili3d-chatgpt-signin", "popup,width=520,height=720");
    if (!popup) return Result.err(I18n.translate("ai.chatgpt.popupBlocked"));
    const attempt = await newSignInAttempt(redirectUri);
    const record = readAuthRecord();
    popup.location.href = buildAuthorizeUrl(attempt, record);
    const search = await waitForCallback(attempt.state, signal);
    if (!search.isOk) return Result.err(search.error);
    const callback = parseCallback(search.value, attempt, record);
    if (!callback.isOk) return Result.err(callback.error);
    return completeSignIn(callback.value, attempt);
}

let refreshing: Promise<ChatGPTSession> | undefined;

async function refreshSession(record: ChatGPTAuthRecord, session: ChatGPTSession): Promise<ChatGPTSession> {
    try {
        const tokens = await tokenRequest({
            grant_type: "refresh_token",
            client_id: record.clientId ?? "",
            refresh_token: session.refreshToken,
            resource: CHATGPT_RESOURCE,
        });
        const next = toSession(tokens, session);
        // Access token, expiry, scope and the rotated refresh token are replaced together.
        writeAuthRecord({ ...readAuthRecord(), session: next });
        return next;
    } catch (e) {
        if (e instanceof ChatGPTAuthError && e.code === "invalid_grant") {
            // The grant is gone (revoked, or 30 days unused). Keep the registration and the
            // hints so signing in again is one click, but stop pretending to be signed in.
            writeAuthRecord({ ...readAuthRecord(), session: undefined });
            throw new Error(I18n.translate("ai.chatgpt.expired"));
        }
        throw e;
    }
}

/**
 * A live access token, refreshed when it is about to expire. Handed to the OpenAI SDK as its
 * `apiKey` function, which calls it before every request; concurrent callers share one refresh,
 * since the refresh token rotates and a second refresh with the old one would fail.
 */
export async function chatGPTAccessToken(): Promise<string> {
    const record = peekAuthRecord();
    const session = record?.session;
    if (!record || !session) throw new Error(I18n.translate("ai.chatgpt.signedOut"));
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
    refreshing ??= refreshSession(record, session).finally(() => {
        refreshing = undefined;
    });
    return (await refreshing).accessToken;
}

/**
 * Revoke the refresh token and forget the session. The registration stays, so the next sign-in
 * reuses the same client. Returns false when the revocation could not be confirmed — the tokens
 * are cleared locally either way, and the user can still disconnect the app in ChatGPT settings.
 */
export async function signOutOfChatGPT(): Promise<boolean> {
    const record = readAuthRecord();
    writeAuthRecord({ ...record, session: undefined });
    if (!record.session || !record.clientId) return true;
    try {
        const response = await fetch(REVOKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                token: record.session.refreshToken,
                token_type_hint: "refresh_token",
                client_id: record.clientId,
            }).toString(),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/** The models the signed-in account may use (`visibility == "list"`), or none when the list fails. */
export async function listChatGPTModels(): Promise<string[]> {
    try {
        const response = await fetch(`${chatGPTApiBase()}/models`, {
            headers: { Authorization: `Bearer ${await chatGPTAccessToken()}` },
        });
        if (!response.ok) return [];
        const json = (await response.json()) as { data?: { id: string; visibility?: string }[] };
        return (json.data ?? []).filter((m) => m.visibility === "list").map((m) => m.id);
    } catch {
        return [];
    }
}
