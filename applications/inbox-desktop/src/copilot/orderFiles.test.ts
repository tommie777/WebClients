import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OrderFilesService } from "./orderFiles";

describe("OrderFilesService", () => {
    const directories: string[] = [];

    const createRoot = () => {
        const directory = mkdtempSync(join(tmpdir(), "colorspace-order-files-"));
        directories.push(directory);
        return directory;
    };

    afterEach(() => {
        directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
    });

    it("reports an unavailable network volume without exposing a path", async () => {
        const root = join(createRoot(), "missing");
        const result = await new OrderFilesService(root).browse({});

        expect(result.available).toBe(false);
        expect(result.rootName).toBe("missing");
        expect(result.entries).toEqual([]);
        expect(result.message).toContain("niet verbonden");
    });

    it("resolves the active order from a Dutch order date", async () => {
        const root = createRoot();
        const orderDirectory = join(root, "2026", "augustus", "0088653");
        mkdirSync(join(orderDirectory, "drukbestanden"), { recursive: true });
        writeFileSync(join(orderDirectory, "proefdruk.pdf"), "pdf");
        writeFileSync(join(orderDirectory, ".verborgen.txt"), "hidden");

        const service = new OrderFilesService(root);
        const result = await service.browse({ orderNumber: "0088653", orderDate: "05-08-2026" });

        expect(result.available).toBe(true);
        expect(result.resolvedOrder).toBe(true);
        expect(result.segments).toEqual(["2026", "augustus", "0088653"]);
        expect(result.entries.map((entry) => entry.name)).toEqual(["drukbestanden", "proefdruk.pdf"]);
        const file = result.entries.find((entry) => entry.name === "proefdruk.pdf");
        expect(file?.id).toEqual(expect.any(String));
        expect(service.pathsForTokens([file?.id])).toEqual([realpathSync(join(orderDirectory, "proefdruk.pdf"))]);
    });

    it("shows only year folders at the browser root", async () => {
        const root = createRoot();
        mkdirSync(join(root, "2025"));
        mkdirSync(join(root, "2026"));
        mkdirSync(join(root, "4000017282"));
        mkdirSync(join(root, "naamloze map"));

        const result = await new OrderFilesService(root).browse({ segments: [] });

        expect(result.entries.map((entry) => entry.name)).toEqual(["2025", "2026"]);
    });

    it("rejects traversal outside the configured root", async () => {
        const root = createRoot();
        mkdirSync(join(root, "2026"));

        const result = await new OrderFilesService(root).browse({ segments: [".."] });

        expect(result.entries).toEqual([]);
        expect(result.message).toContain("veilig");
    });

    it("returns a writable directory only for a resolved order", async () => {
        const root = createRoot();
        const orderDirectory = join(root, "2026", "augustus", "0088653");
        mkdirSync(orderDirectory, { recursive: true });
        const service = new OrderFilesService(root);

        await expect(service.writableOrderDirectory({ orderNumber: "0088653", orderDate: "05-08-2026" })).resolves.toBe(
            realpathSync(orderDirectory),
        );
        await expect(
            service.writableOrderDirectory({ orderNumber: "0088654", orderDate: "05-08-2026" }),
        ).resolves.toBeNull();
    });

    it("keeps every token from the latest large directory listing usable", async () => {
        const root = createRoot();
        const orderDirectory = join(root, "2026", "augustus", "0088653");
        mkdirSync(orderDirectory, { recursive: true });
        for (let index = 0; index < 500; index += 1) {
            writeFileSync(join(orderDirectory, `bestand-${index}.pdf`), "pdf");
        }
        const service = new OrderFilesService(root);
        let result = await service.browse({ segments: ["2026", "augustus", "0088653"] });
        for (let iteration = 0; iteration < 4; iteration += 1) {
            result = await service.browse({ segments: ["2026", "augustus", "0088653"] });
        }

        const tokens = result.entries.flatMap((entry) => (entry.id ? [entry.id] : []));
        expect(tokens).toHaveLength(500);
        const paths = tokens.flatMap((_, index) =>
            index % 20 === 0 ? service.pathsForTokens(tokens.slice(index, index + 20)) : [],
        );
        expect(paths).toHaveLength(500);
    });

    it("rejects a token if an ancestor is replaced by a symlink outside the root", async () => {
        const root = createRoot();
        const outside = createRoot();
        const orderDirectory = join(root, "2026", "augustus", "0088653");
        mkdirSync(orderDirectory, { recursive: true });
        writeFileSync(join(orderDirectory, "proefdruk.pdf"), "inside");
        writeFileSync(join(outside, "proefdruk.pdf"), "outside");
        const service = new OrderFilesService(root);
        const result = await service.browse({ segments: ["2026", "augustus", "0088653"] });
        const token = result.entries[0]?.id;

        rmSync(orderDirectory, { recursive: true });
        symlinkSync(outside, orderDirectory, "dir");

        expect(service.pathsForTokens([token])).toEqual([]);
    });
});
