import http from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.COLORSPACE_COPILOT_SELECTION_PORT || "3210", 10);

const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/selection") {
        response.writeHead(404).end();
        return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4_096) {
            request.destroy();
        }
    });
    request.on("end", () => {
        try {
            const value = JSON.parse(body);
            const selection = value?.type === "proton-mail-selection" ? value.selection : null;
            if (!selection?.labelID || !selection?.elementID) {
                response.writeHead(400).end();
                return;
            }
            process.stdout.write(`${JSON.stringify(selection)}\n`);
            response.writeHead(204).end();
        } catch {
            response.writeHead(400).end();
        }
    });
});

server.listen(port, host, () => {
    process.stdout.write(`Colorspace selection receiver listening on http://${host}:${port}/selection\n`);
});
