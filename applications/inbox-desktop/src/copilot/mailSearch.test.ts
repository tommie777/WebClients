import { mailOrderSearchURL, normalizeMailOrderQuery } from "./mailSearch";

describe("Colorspace Proton order search", () => {
    test("keeps leading zeroes and accepts webshop order identifiers", () => {
        expect(normalizeMailOrderQuery(" #0088653 ")).toBe("0088653");
        expect(normalizeMailOrderQuery("CS-12345")).toBe("CS-12345");
    });

    test("rejects unsafe or non-order search values", () => {
        expect(normalizeMailOrderQuery("invoice only")).toBeNull();
        expect(normalizeMailOrderQuery("../../mail")).toBeNull();
        expect(normalizeMailOrderQuery("abc")).toBeNull();
    });

    test("builds an all-mail native Proton search for the active account", () => {
        expect(mailOrderSearchURL("https://mail.proton.me/u/3/inbox/conversation", "0088653")).toBe(
            "https://mail.proton.me/u/3/all-mail#keyword=0088653",
        );
    });

    test("does not navigate a non-Proton origin", () => {
        expect(mailOrderSearchURL("https://example.com/u/0/inbox", "0088653")).toBeNull();
    });
});
