/*
 * Pruebas de tidal-web, sin Liora ni red: el host es una maqueta que
 * responde lo que hace falta y se comprueba lo que devuelve la extension.
 *
 *     node extensions/tidal-web/tests/tidal-web.test.js
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

// El host de mentira: responde a la API de TIDAL con datos de ejemplo.
const requests = [];
const responses = {};

const host = {
    http: function (method, url, body, headers) {
        requests.push({ method: method, url: url, body: body, headers: headers || {} });
        if (url.indexOf("auth.tidal.com") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify({
                access_token: "token-de-prueba",
                expires_in: 3600
            }) };
        }
        if (url.indexOf("playbackinfopostpaywall") >= 0) {
            if (responses.drm) {
                return { ok: true, statusCode: 200, body: JSON.stringify({
                    trackId: 42,
                    audioQuality: "HIGH",
                    manifest: Buffer.from(JSON.stringify({
                        encryptionType: "AES_128",
                        codecs: "mp4a.40.2",
                        urls: ["https://ejemplo/Protegido.mpd"]
                    })).toString("base64")
                }) };
            }
            return { ok: true, statusCode: 200, body: JSON.stringify({
                trackId: 42,
                audioQuality: "HIGH",
                manifest: Buffer.from(JSON.stringify({
                    encryptionType: "NONE",
                    codecs: "mp4a.40.2",
                    urls: ["https://ejemplo/LaPista.m4a"]
                })).toString("base64")
            }) };
        }
        if (url.indexOf("/v1/tracks/42") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify({
                id: 42,
                title: "Around the World",
                duration: 429,
                isrc: "FR6V81234567",
                artists: [{ name: "Daft Punk" }],
                album: { title: "Discovery", cover: "0e0a1c9e-1111-2222-3333-444455556666" }
            }) };
        }
        if (url.indexOf("/v1/search") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify({
                items: [
                    { id: 42, type: "track", title: "Around the World", duration: 429,
                      isrc: "FR6V81234567",
                      artists: [{ name: "Daft Punk" }],
                      album: { title: "Discovery", cover: "0e0a1c9e-1111-2222-3333-444455556666" } },
                    { id: 7, type: "artist", title: "Un artista" }
                ]
            }) };
        }
        return { ok: false, statusCode: 404, body: "{}" };
    },
    storage: {
        get: function () { return null; },
        set: function () { return { ok: true }; }
    },
    log: {
        info: function () {},
        warn: function () {},
        error: function () {}
    }
};

const registered = {};
const sandbox = {
    host: host,
    registerExtension: function (functions) {
        for (const key in functions) registered[key] = functions[key];
    },
    JSON: JSON,
    Math: Math,
    Date: Date,
    String: String,
    Number: Number,
    Buffer: Buffer,
    encodeURIComponent: encodeURIComponent,
    console: console
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

console.log("tidal-web");

check(
    "se registran las funciones del contrato",
    typeof registered.initialize === "function" &&
        typeof registered.searchTracks === "function" &&
        typeof registered.getTrack === "function" &&
        typeof registered.checkAvailability === "function" &&
        typeof registered.getAudioSource === "function"
);

const started = registered.initialize({
    settings: { clientId: "mi-id", clientSecret: "mi-secreto", countryCode: "ES" }
});
check("initialize responde", started && started.ok === true);

const found = registered.searchTracks({ query: "around the world" });
check("la busqueda devuelve pistas", found.tracks.length === 1);
check("la busqueda ignora los artistas", found.tracks[0].id === "42");
check("la pista trae el album", found.tracks[0].album === "Discovery");
check("la pista trae el isrc", found.tracks[0].isrc === "FR6V81234567");
check("la pista trae la duracion en ms", found.tracks[0].durationMs === 429000);
check(
    "la portada usa el servidor de imagenes de TIDAL",
    found.tracks[0].artworkUrl ===
        "https://resources.tidal.com/images/640/640/0e0a1c9e-1111-2222-3333-444455556666"
);

const track = registered.getTrack({ trackId: "42" });
check("getTrack devuelve la pista", track.title === "Around the World");

responses.drm = false;
const available = registered.checkAvailability({ trackId: "42" });
check("una pista sin cifrar esta disponible", available.available === true);
check("la fuente es reproducible", available.kinds[0] === "playable");

const playableSource = registered.getAudioSource({ trackId: "42" });
check("la fuente trae la url", playableSource.url === "https://ejemplo/LaPista.m4a");
check("la fuente pide autenticacion", playableSource.requiresAuthentication === true);

// Con DRM: no hay fuente, y se dice por que.
responses.drm = true;
const blocked = registered.checkAvailability({ trackId: "42" });
check("una pista con DRM no esta disponible", blocked.available === false);
check("el motivo menciona el DRM", blocked.reason.indexOf("DRM") >= 0);

const blockedSource = registered.getAudioSource({ trackId: "42" });
check("con DRM no se devuelve fuente", !blockedSource.url);
check("el error explica el motivo", String(blockedSource.error).indexOf("DRM") >= 0);

const denied = registered.getDownloadUrl({ trackId: "42" });
check("no hay descarga", !denied.url);
check("el motivo dice que no se puede descargar", String(denied.error).length > 0);

console.log(failures === 0 ? "todo correcto" : failures + " fallos");
process.exit(failures === 0 ? 0 : 1);
