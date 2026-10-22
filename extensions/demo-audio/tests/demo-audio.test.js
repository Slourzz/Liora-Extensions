/*
 * Pruebas de la extension demo-audio, sin Liora.
 *
 * Se ejecutan con node:   node extensions/demo-audio/tests/demo-audio.test.js
 *
 * El script se carga con un `host` de mentira, que es como lo vera la
 * extension dentro de Liora pero sin red ni ficheros.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "index.js"),
    "utf8"
);

let failures = 0;

function check(name, condition, detail) {
    if (condition) {
        console.log("  ok   " + name);
    } else {
        failures += 1;
        console.log("  FAIL " + name + (detail ? " -> " + detail : ""));
    }
}

// El host de mentira: registra lo que se le pide.
const calls = [];
const host = {
    log: {
        info: (m) => calls.push(["log", m]),
        warn: (m) => calls.push(["log", m]),
        error: (m) => calls.push(["log", m])
    },
    http: (method, url, body) => {
        calls.push(["http", method, url]);
        return { ok: false, errorType: "network_denied", error: "sin red en la prueba" };
    },
    storage: {
        get: (k) => null,
        set: (k, v) => ({ ok: true })
    },
    file: {
        download: (url, target) => {
            calls.push(["download", url, target]);
            return { success: true, path: target, bytes: 44100 };
        },
        readText: (p) => "",
        writeText: (p, t) => ({ ok: true })
    }
};

const registered = {};
const sandbox = {
    host: host,
    registerExtension: (functions) => {
        for (const key in functions) {
            registered[key] = functions[key];
        }
    },
    JSON: JSON,
    Math: Math,
    Date: Date,
    String: String,
    Number: Number,
    console: console
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

console.log("demo-audio");

check(
    "se registran las funciones del contrato",
    typeof registered.initialize === "function" &&
        typeof registered.searchTracks === "function" &&
        typeof registered.getTrack === "function" &&
        typeof registered.checkAvailability === "function" &&
        typeof registered.getAudioSource === "function" &&
        typeof registered.getDownloadUrl === "function" &&
        typeof registered.download === "function" &&
        typeof registered.fetchLyrics === "function"
);

const config = { extensionId: "demo-audio", assetScheme: "liora-asset" };
const initialized = registered.initialize(config);
check("initialize responde", initialized && initialized.ok === true);
check(
    "initialize recibe el esquema de recursos",
    registered.getAudioSource({ trackId: "demo-tone" }).url.indexOf("liora-asset://") === 0
);

const found = registered.searchTracks({ query: "tono", limit: 10 });
check("la busqueda encuentra las pistas de la demo", found.tracks.length === 2);
check(
    "la busqueda filtra por texto",
    registered.searchTracks({ query: "no existe", limit: 10 }).tracks.length === 0
);

const track = registered.getTrack({ trackId: "demo-tone" });
check("getTrack devuelve la pista", track.title === "Tono de prueba");

const availability = registered.checkAvailability({ trackId: "demo-tone" });
check("hay disponibilidad", availability.available === true);
check(
    "la disponibilidad distingue los tipos de fuente",
    availability.kinds.indexOf("playable") >= 0 && availability.kinds.indexOf("downloadable") >= 0
);
check(
    "una pista desconocida no tiene disponibilidad",
    registered.checkAvailability({ trackId: "otra" }).available === false
);

const source2 = registered.getAudioSource({ trackId: "demo-tone" });
check("la fuente indica su formato", source2.mimeType === "audio/wav");
check("la fuente declara que es reproducible", source2.kind === "playable");

const download = registered.download({ trackId: "demo-tone", outputPath: "/tmp/demo.wav" });
check("la descarga se hace", download.success === true && download.bytes > 0);
check(
    "la descarga pide el recurso de la app",
    calls.some((c) => c[0] === "download" && c[1].indexOf("liora-asset://") === 0)
);

const lyrics = registered.fetchLyrics({ trackId: "demo-tone", title: "x" });
check("la letra llega con sus lineas", lyrics.lines.length === 2);

console.log(failures === 0 ? "todo correcto" : failures + " fallos");
process.exit(failures === 0 ? 0 : 1);
