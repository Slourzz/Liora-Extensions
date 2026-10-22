/*
 * Prueba real: descarga la respuesta de busqueda de YouTube Music y la pasa
 * por el parser de la extension, tal cual.
 *
 *     node extensions/ytmusic/tests/real-search.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const https = require("https");

const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const CLIENT = { name: "WEB_REMIX", version: "1.20250310.01.00", id: 67 };

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

(async function () {
    const payload = {
        context: { client: { clientName: CLIENT.name, clientVersion: CLIENT.version, hl: "en", gl: "US" } },
        query: "daft punk",
    };
    const raw = await post(
        "music.youtube.com",
        "/youtubei/v1/search?key=" + KEY,
        JSON.stringify(payload),
        {
            "X-YouTube-Client-Name": String(CLIENT.id),
            "X-YouTube-Client-Version": CLIENT.version,
            "User-Agent": "Mozilla/5.0"
        }
    );
    console.log("respuesta:", Math.round(raw.length / 1024), "KB");

    // El host de mentira: devuelve la respuesta real.
    const host = {
        http: function (method, url, body, headers) {
            return { ok: true, statusCode: 200, body: raw };
        },
        storage: { get: function () { return null; }, set: function () { return { ok: true }; } },
        log: { info: function () {}, warn: function () {}, error: function () {} }
    };

    const source = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");
    const registered = {};
    const sandbox = {
        host: host,
        registerExtension: function (functions) {
            for (const key in functions) registered[key] = functions[key];
        },
        JSON: JSON, Math: Math, Date: Date, String: String, Number: Number,
        encodeURIComponent: encodeURIComponent, console: console
    };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    registered.initialize({ settings: {} });
    const result = registered.searchTracks({ query: "daft punk", limit: 10 });
    console.log("pistas extraidas:", result.tracks.length);
    for (const track of result.tracks.slice(0, 5)) {
        console.log("  -", track.title, "|", track.artist, "|", track.durationMs, "ms |", track.id);
    }
    process.exit(result.tracks.length ? 0 : 1);
})();
