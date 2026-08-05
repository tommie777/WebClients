import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type BridgeConfig = {
    selectionURL?: unknown;
    bridgeToken?: unknown;
    appURL?: unknown;
};

const KEYCHAIN_SERVICE = "nl.colorspace.proton-copilot";
const CLOUD_ORIGIN = "https://mailcopilot.colorspace.nl";
const keychainCache = new Map<string, string>();

const loadBridgeConfig = (): BridgeConfig => {
    try {
        const configPath = join(
            homedir(),
            "Library",
            "Application Support",
            "Colorspace Proton Copilot",
            "copilot-bridge.json",
        );
        return JSON.parse(readFileSync(configPath, "utf8")) as BridgeConfig;
    } catch {
        return {};
    }
};

const bridgeConfig = loadBridgeConfig();

const keychainValue = (account: string): string => {
    if (process.platform !== "darwin") return "";
    const cached = keychainCache.get(account);
    if (cached !== undefined) return cached;
    try {
        const value = execFileSync(
            "/usr/bin/security",
            ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        keychainCache.set(account, value);
        return value;
    } catch {
        keychainCache.set(account, "");
        return "";
    }
};

const configuredString = (environmentName: string, keychainAccount: string, fallback?: unknown): string => {
    const environmentValue = process.env[environmentName]?.trim();
    if (environmentValue) return environmentValue;
    const storedValue = keychainValue(keychainAccount);
    if (storedValue) return storedValue;
    return typeof fallback === "string" ? fallback.trim() : "";
};

const safeCopilotURL = (candidate: string, expectedPath?: string): URL | null => {
    try {
        const url = new URL(candidate);
        const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
        const isLoopback = url.protocol === "http:" && loopbackHosts.has(url.hostname);
        const isCloud = url.protocol === "https:" && url.origin === CLOUD_ORIGIN;
        if ((!isLoopback && !isCloud) || url.username || url.password) return null;
        if (expectedPath && url.pathname !== expectedPath) return null;
        return url;
    } catch {
        return null;
    }
};

export const copilotSelectionEndpoint = (): URL | null => {
    const configured =
        process.env.COLORSPACE_COPILOT_SELECTION_URL?.trim() ||
        (typeof bridgeConfig.selectionURL === "string" ? bridgeConfig.selectionURL.trim() : "") ||
        `${CLOUD_ORIGIN}/api/proton/selection`;
    return safeCopilotURL(configured, "/api/proton/selection");
};

export const copilotAppURL = (): URL => {
    const configured =
        process.env.COLORSPACE_COPILOT_APP_URL?.trim() ||
        (typeof bridgeConfig.appURL === "string" ? bridgeConfig.appURL.trim() : "") ||
        `${CLOUD_ORIGIN}/?sidecar=1`;
    return safeCopilotURL(configured) ?? new URL(`${CLOUD_ORIGIN}/?sidecar=1`);
};

export const copilotBridgeToken = (): string | null => {
    const value = configuredString("COLORSPACE_COPILOT_BRIDGE_TOKEN", "device-token", bridgeConfig.bridgeToken);
    return value.length >= 24 ? value : null;
};

export const copilotAccessHeaders = (): Record<string, string> => {
    const clientId = configuredString("COLORSPACE_COPILOT_ACCESS_CLIENT_ID", "cloudflare-access-client-id");
    const clientSecret = configuredString("COLORSPACE_COPILOT_ACCESS_CLIENT_SECRET", "cloudflare-access-client-secret");
    if (!clientId || !clientSecret) return {};
    return {
        "CF-Access-Client-Id": clientId,
        "CF-Access-Client-Secret": clientSecret,
    };
};

export const copilotRequestHeaders = (json = false): Record<string, string> => {
    const token = copilotBridgeToken();
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...copilotAccessHeaders(),
        ...(token ? { "X-Colorspace-Copilot-Token": token } : {}),
    };
};

export const isCloudCopilotURL = (rawURL: string): boolean => {
    try {
        return new URL(rawURL).origin === CLOUD_ORIGIN;
    } catch {
        return false;
    }
};
