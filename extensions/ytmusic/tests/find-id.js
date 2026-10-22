/*
 * Diagnostico: donde esta el videoId de verdad en la respuesta de busqueda.
 *     node extensions/ytmusic/tests/find-id.js
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

function walk(node, path, hits, depth) {
    if (node === null || node === undefined || depth > 40) return;
    if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, path + "[" + index + "]", hits, depth + 1));
        return;
    }
    if (typeof node === "object") {
        for (const key of Object.keys(node)) {
            if (key === "videoId" && typeof node[key] === "string" && node[key].length === 11) {
                hits.push(path + "." + key + " = " + node[key]);
            }
            walk(node[key], path + "." + key, hits, depth + 1);
        }
    }
}

(async function () {
    const payload = {
        context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20250310.01.00", hl: "en", gl: "US" } },
        query: "daft punk",
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
    const hits = [];
    walk(json, "", hits, 0);
    console.log("videoId encontrados:", hits.length);
    for (const hit of hits.slice(0, 6)) console.log("  ", hit);

    // Y el contenido de un boton de play, que es donde deberia estar el id.
    const buttons = [];
    (function find(node, depth) {
        if (!node || typeof node !== "object" || depth > 30) return;
        if (Array.isArray(node)) { node.forEach((n) => find(n, depth + 1)); return; }
        for (const key of Object.keys(node)) {
            if (key === "musicPlayButtonRenderer" && buttons.length < 2) {
                buttons.push(JSON.stringify(node[key]).slice(0, 600));
            }
            find(node[key], depth + 1);
        }
    })(json, 0);
    for (const button of buttons) console.log("  playButton:", button);

    // Y el primer item de la lista, entero, para ver como trae su id.
    let first = null;
    (function findItem(node, depth) {
        if (first || !node || typeof node !== "object" || depth > 30) return;
        if (Array.isArray(node)) { node.forEach((n) => findItem(n, depth + 1)); return; }
        for (const key of Object.keys(node)) {
            if (key === "musicResponsiveListItemRenderer" && !first) first = node[key];
            findItem(node[key], depth + 1);
        }
    })(json, 0);
    if (first) {
        console.log("  item:", JSON.stringify(first).slice(0, 1200));
    }

    // Y los tipos de renderer que hay en la respuesta.
    const kinds = {};
    walk(json, "", [], 0);
    const renderers = new Set();
    (function collect(node, depth) {
        if (!node || typeof node !== "object" || depth > 30) return;
        if (Array.isArray(node)) { node.forEach((n) => collect(n, depth + 1)); return; }
        for (const key of Object.keys(node)) {
            if (/Renderer$/.test(key)) renderers.add(key);
            collect(node[key], depth + 1);
        }
    })(json, 0);
    console.log("renderers:", Array.from(renderers).join(", "));
})();
