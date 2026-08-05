import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
});
