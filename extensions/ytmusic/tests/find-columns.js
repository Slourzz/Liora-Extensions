/*
 * Diagnostico: como vienen el artista y la duracion en un item de cancion.
 *     node extensions/ytmusic/tests/find-columns.js
 */

const https = require("https");

const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

function post(hostname, pathAndQuery, body, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: hostname,
                path: pathAndQuery,
                method: "POST",
                headers: Object.assign({ "Content-Type": "application/json" }, headers || {})
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => resolve(data));
            }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function textOf(node) {
    if (!node) return null;
    if (node.simpleText) return node.simpleText;
    if (node.runs && node.runs.length) return node.runs.map((r) => r.text).join("");
    return null;
}

(async function () {
    const payload = {
        context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20250310.01.00", hl: "en", gl: "US" } },
        query: "daft punk"
    };
    const raw = await post(
        "music.youtube.com",
        "/youtubei/v1/search?key=" + KEY,
        JSON.stringify(payload),
        {
            "X-YouTube-Client-Name": "67",
            "X-YouTube-Client-Version": "1.20250310.01.00",
            "User-Agent": "Mozilla/5.0"
        }
    );
    const json = JSON.parse(raw);

    const items = [];
    (function find(node, depth) {
        if (!node || typeof node !== "object" || depth > 30) return;
        if (Array.isArray(node)) { node.forEach((n) => find(n, depth + 1)); return; }
        for (const key of Object.keys(node)) {
            if (key === "musicResponsiveListItemRenderer") items.push(node[key]);
            find(node[key], depth + 1);
        }
    })(json, 0);

    for (const item of items.slice(0, 4)) {
        const id = item.overlay && item.overlay.musicItemThumbnailOverlayRenderer
            && item.overlay.musicItemThumbnailOverlayRenderer.content
            && item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
            && item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
                .playNavigationEndpoint
            && item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
                .playNavigationEndpoint.watchEndpoint
            ? item.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
                .playNavigationEndpoint.watchEndpoint.videoId
            : null;
        console.log("---", id);
        (item.flexColumns || []).forEach((column, index) => {
            const renderer = column.musicResponsiveListItemFlexColumnRenderer;
            if (!renderer) return;
            const runs = (renderer.text && renderer.text.runs) || [];
            console.log("   flex[" + index + "]:", JSON.stringify(runs.map((r) => r.text)).slice(0, 160), "| subtitle:", JSON.stringify(renderer.subtitle ? (renderer.subtitle.runs || []).map((r) => r.text) : null));
        });
        (item.fixedColumns || []).forEach((column, index) => {
            const renderer = column.musicResponsiveListItemFixedColumnRenderer;
            if (!renderer) return;
            console.log("   fixed[" + index + "]:", JSON.stringify(textOf(renderer.text)).slice(0, 80));
        });
    }
})();
