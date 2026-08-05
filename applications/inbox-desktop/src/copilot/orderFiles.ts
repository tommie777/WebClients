import { randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
    OrderFileActionResult,
    OrderFileEntry,
    OrderFilesBrowseRequest,
    OrderFilesBrowseResult,
} from "./orderFilesContract";

const DEFAULT_ROOT = "/Volumes/webbestellingen";
const DUTCH_MONTHS = [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
] as const;
const DUTCH_MONTH_SET = new Set<string>(DUTCH_MONTHS);
const MAX_SEGMENTS = 12;
const MAX_ENTRIES = 500;
const MAX_TOKENS = 2_000;

const naturalCompare = new Intl.Collator("nl-NL", { numeric: true, sensitivity: "base" }).compare;

const cleanOrderNumber = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const clean = value.trim();
    return /^\d{5,14}$/.test(clean) ? clean : null;
};

const cleanSegments = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length > MAX_SEGMENTS) return null;
    const segments = value.map((segment) => (typeof segment === "string" ? segment.trim() : ""));
    if (
        segments.some(
            (segment) =>
                !segment ||
                segment.length > 180 ||
                segment === "." ||
                segment === ".." ||
                segment.includes("/") ||
                segment.includes("\\") ||
                Array.from(segment).some((character) => character.charCodeAt(0) <= 31),
        )
    ) {
        return null;
    }
    return segments;
};

const orderMonth = (value: unknown): { year: string; month: string } | null => {
    if (typeof value !== "string") return null;
    const clean = value.trim();
    const dutch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    const iso = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const year = dutch?.[3] ?? iso?.[1];
    const monthNumber = Number(dutch?.[2] ?? iso?.[2]);
    if (!year || !/^20\d{2}$/.test(year) || monthNumber < 1 || monthNumber > 12) return null;
    return { year, month: DUTCH_MONTHS[monthNumber - 1] };
};

const isWithin = (root: string, candidate: string): boolean => {
    const pathFromRoot = relative(root, candidate);
    return (
        pathFromRoot === "" ||
        (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
    );
};

const visibleDirectoryAtDepth = (name: string, depth: number): boolean => {
    if (name.startsWith(".")) return false;
    if (depth === 0) return /^20\d{2}$/.test(name);
    if (depth === 1) return DUTCH_MONTH_SET.has(name.toLocaleLowerCase("nl-NL"));
    return true;
};

export class OrderFilesService {
    private readonly configuredRoot: string;
    private rootPath: string | null = null;
    private readonly fileTokens = new Map<string, string>();

    constructor(rootPath = process.env.COLORSPACE_ORDER_FILES_ROOT?.trim() || DEFAULT_ROOT) {
        this.configuredRoot = resolve(rootPath);
    }

    private async resolveRoot(): Promise<string | null> {
        try {
            const resolvedRoot = await realpath(this.configuredRoot);
            const rootStats = await lstat(resolvedRoot);
            if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
            this.rootPath = resolvedRoot;
            return resolvedRoot;
        } catch {
            this.rootPath = null;
            return null;
        }
    }

    private async directoryForSegments(root: string, segments: string[]): Promise<string | null> {
        try {
            const candidate = resolve(root, ...segments);
            if (!isWithin(root, candidate)) return null;
            const resolvedCandidate = await realpath(candidate);
            if (!isWithin(root, resolvedCandidate)) return null;
            const stats = await lstat(resolvedCandidate);
            return stats.isDirectory() && !stats.isSymbolicLink() ? resolvedCandidate : null;
        } catch {
            return null;
        }
    }

    private async resolveOrderSegments(
        root: string,
        orderNumber: string,
        orderDate: unknown,
    ): Promise<string[] | null> {
        const candidates: string[][] = [];
        const dateParts = orderMonth(orderDate);
        if (dateParts) candidates.push([dateParts.year, dateParts.month, orderNumber]);
        candidates.push([orderNumber]);

        if (!dateParts) {
            try {
                const years = (await readdir(root, { withFileTypes: true }))
                    .filter((entry) => entry.isDirectory() && /^20\d{2}$/.test(entry.name))
                    .map((entry) => entry.name)
                    .sort(naturalCompare)
                    .reverse()
                    .slice(0, 5);
                for (const year of years) {
                    for (const month of [...DUTCH_MONTHS].reverse()) candidates.push([year, month, orderNumber]);
                }
            } catch {
                // The normal root listing below will still be available.
            }
        }

        for (const segments of candidates) {
            if (await this.directoryForSegments(root, segments)) return segments;
        }
        return null;
    }

    private rememberFile(path: string): string {
        if (this.fileTokens.size >= MAX_TOKENS) this.fileTokens.clear();
        const id = randomUUID();
        this.fileTokens.set(id, path);
        return id;
    }

    async browse(request: OrderFilesBrowseRequest): Promise<OrderFilesBrowseResult> {
        const root = await this.resolveRoot();
        if (!root) {
            return {
                available: false,
                rootName: basename(this.configuredRoot),
                segments: [],
                entries: [],
                resolvedOrder: false,
                message: "Webbestellingen is niet verbonden op deze Mac.",
            };
        }

        const requestedSegments = cleanSegments(request.segments ?? []);
        if (!requestedSegments) {
            return {
                available: true,
                rootName: basename(root),
                segments: [],
                entries: [],
                resolvedOrder: false,
                message: "Deze map kan niet veilig worden geopend.",
            };
        }

        const orderNumber = cleanOrderNumber(request.orderNumber);
        const resolvedOrderSegments = orderNumber
            ? await this.resolveOrderSegments(root, orderNumber, request.orderDate)
            : null;
        const resolutionMessage =
            orderNumber && !resolvedOrderSegments
                ? `Ordermap ${orderNumber} is niet gevonden. Kies hieronder een jaar, maand en order.`
                : null;
        const segments = resolvedOrderSegments ?? requestedSegments;
        const directory = await this.directoryForSegments(root, segments);
        if (!directory) {
            return {
                available: true,
                rootName: basename(root),
                segments: [],
                entries: [],
                resolvedOrder: false,
                message: orderNumber ? `Ordermap ${orderNumber} is niet gevonden.` : "Deze map bestaat niet meer.",
            };
        }

        try {
            const directoryEntries = await readdir(directory, { withFileTypes: true });
            const entries = (
                await Promise.all(
                    directoryEntries
                        .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith("."))
                        .filter(
                            (entry) =>
                                entry.isFile() ||
                                (entry.isDirectory() && visibleDirectoryAtDepth(entry.name, segments.length)),
                        )
                        .slice(0, MAX_ENTRIES)
                        .map(async (entry): Promise<OrderFileEntry | null> => {
                            const entryPath = resolve(directory, entry.name);
                            if (!isWithin(root, entryPath)) return null;
                            try {
                                const stats = await lstat(entryPath);
                                if (stats.isSymbolicLink()) return null;
                                const isDirectory = stats.isDirectory();
                                if (!isDirectory && !stats.isFile()) return null;
                                return {
                                    id: isDirectory ? null : this.rememberFile(entryPath),
                                    name: entry.name,
                                    kind: isDirectory ? "directory" : "file",
                                    segments: [...segments, entry.name],
                                    extension: isDirectory
                                        ? ""
                                        : extname(entry.name).slice(1).toLocaleLowerCase("en-US"),
                                    size: isDirectory ? null : stats.size,
                                    modifiedAt: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
                                };
                            } catch {
                                return null;
                            }
                        }),
                )
            )
                .filter((entry): entry is OrderFileEntry => entry !== null)
                .sort((left, right) => {
                    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
                    return naturalCompare(left.name, right.name);
                });

            return {
                available: true,
                rootName: basename(root),
                segments,
                entries,
                resolvedOrder: Boolean(resolvedOrderSegments),
                message:
                    directoryEntries.length > MAX_ENTRIES
                        ? `De eerste ${MAX_ENTRIES} onderdelen worden getoond.`
                        : (resolutionMessage ?? (entries.length ? null : "Deze map is leeg.")),
            };
        } catch {
            return {
                available: true,
                rootName: basename(root),
                segments,
                entries: [],
                resolvedOrder: Boolean(resolvedOrderSegments),
                message: "De inhoud van deze map kon niet worden gelezen.",
            };
        }
    }

    pathsForTokens(tokens: unknown): string[] {
        if (!Array.isArray(tokens) || !this.rootPath) return [];
        const paths = tokens
            .slice(0, 20)
            .flatMap((token) => (typeof token === "string" ? [this.fileTokens.get(token)] : []))
            .filter((path): path is string => Boolean(path))
            .filter((path) => {
                if (!this.rootPath || !isWithin(this.rootPath, path) || !existsSync(path)) return false;
                try {
                    const stats = lstatSync(path);
                    return stats.isFile() && !stats.isSymbolicLink();
                } catch {
                    return false;
                }
            });
        return [...new Set(paths)];
    }

    filePathForToken(token: unknown): string | null {
        return this.pathsForTokens([token])[0] ?? null;
    }
}

export const successfulAction = (): OrderFileActionResult => ({ ok: true, message: null });
export const failedAction = (message: string): OrderFileActionResult => ({ ok: false, message });
