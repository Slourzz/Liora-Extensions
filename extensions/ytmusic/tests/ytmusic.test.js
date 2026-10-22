/*
 * Pruebas de ytmusic, sin Liora ni red: el host es una maqueta con la
 * forma de las respuestas de Innertube.
 *
 *     node extensions/ytmusic/tests/ytmusic.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8");

let failures = 0;

function check(name, condition, detail) {
    if (condition) {
        console.log("  ok   " + name);
    } else {
        failures += 1;
        console.log("  FAIL " + name + (detail ? " -> " + detail : ""));
    }
}

const requests = [];

const searchResponse = {
    contents: {
        tabbedSearchResultsRenderer: {
            tabs: [{
                tabRenderer: {
                    content: {
                        sectionListRenderer: {
                            contents: [{
                                musicCardShelfRenderer: {
                                    contents: [
                                        { musicResponsiveListItemRenderer: {
                                            thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [
                                                { url: "https://i.ytimg.com/vi/abc/hq.jpg" }
                                            ] } } },
                                            flexColumns: [
                                                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Around the World" }] } } },
                                                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Daft Punk" }] } } }
                                            ],
                                            fixedColumns: [
                                                { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: "4:04" }] } } }
                                            ],
                                            overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: {
                                                playNavigationEndpoint: { watchEndpoint: { videoId: "abc123" } }
                                            } } } }
                                        } },
                                        { musicResponsiveListItemRenderer: {
                                            flexColumns: [
                                                { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Un album" }] } } }
                                            ]
                                        } }
                                    ]
                                }
                            }]
                        }
                    }
                }
            }]
        }
    }
};

const playerResponse = {
    playabilityStatus: { status: "OK" },
    videoDetails: {
        title: "Around the World",
        author: "Daft Punk",
        lengthSeconds: "244",
        thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/abc/hq.jpg" }] }
    },
    streamingData: {
        adaptiveFormats: [
            { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130677,
              url: "https://rr1---sn-x.googlevideo.com/videoplayback?expire=1" }
        ]
    }
};

const host = {
    http: function (method, url, body, headers, useSession) {
        requests.push({
            method: method, url: url, body: body,
            headers: headers || {}, useSession: !!useSession
        });
        if (url.indexOf("/search") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify(searchResponse) };
        }
        if (url.indexOf("/player") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify(playerResponse) };
        }
        return { ok: false, statusCode: 404, body: "{}" };
    },
    storage: { get: function () { return null; }, set: function () { return { ok: true }; } },
    session: { has: function () { return false; } },
    log: { info: function () {}, warn: function () {}, error: function () {} }
};

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

console.log("ytmusic");

check(
    "se registran las funciones del contrato",
    typeof registered.initialize === "function" &&
        typeof registered.searchTracks === "function" &&
        typeof registered.getTrack === "function" &&
        typeof registered.checkAvailability === "function" &&
        typeof registered.getAudioSource === "function"
);

const started = registered.initialize({});
check("initialize responde", started && started.ok === true);

const found = registered.searchTracks({ query: "around the world", limit: 10 });
check("la busqueda devuelve la pista", found.tracks.length === 1);
check("el id es el del boton de play", found.tracks[0].id === "abc123");
check("el titulo sale de la primera columna", found.tracks[0].title === "Around the World");
check("el artista sale de la segunda columna", found.tracks[0].artist === "Daft Punk");
check("la duracion se lee del reloj", found.tracks[0].durationMs === 244000);
check("la portada se trae", found.tracks[0].artworkUrl.indexOf("i.ytimg.com") >= 0);

const track = registered.getTrack({ trackId: "abc123" });
check("getTrack devuelve la pista", track.title === "Around the World");
check("getTrack trae el artista", track.artist === "Daft Punk");

const availability = registered.checkAvailability({ trackId: "abc123" });
check("hay disponibilidad", availability.available === true);
check("la fuente es reproducible", availability.kinds[0] === "playable");

const playableSource = registered.getAudioSource({ trackId: "abc123" });
check("la fuente trae la url de audio", playableSource.url.indexOf("googlevideo.com") >= 0);
check("la fuente es m4a", playableSource.mimeType.indexOf("audio/mp4") === 0);
check("la fuente trae la duracion", playableSource.durationMs === 244000);

const search = requests.filter(function (r) { return r.url.indexOf("/search") >= 0; })[0];
check("la busqueda va con el cliente WEB_REMIX",
    search.headers["X-YouTube-Client-Name"] === "67");
const player = requests.filter(function (r) { return r.url.indexOf("/player") >= 0; })[0];
check("el player va con el cliente que sirve el audio entero",
    player.headers["X-YouTube-Client-Name"] === "28");
check("el player va con la version que sirve el audio entero",
    player.headers["X-YouTube-Client-Version"] === "1.62.27");

const downloadable = registered.getDownloadUrl({ trackId: "abc123" });
check("la descarga trae la url de audio", downloadable.url.indexOf("googlevideo.com") >= 0);
check("la descarga es descargable", downloadable.kind === "downloadable");
check("la descarga trae el agente de usuario",
    downloadable.headers["User-Agent"].indexOf("com.google.android.apps.youtube.vr.oculus") === 0);
check("la disponibilidad ofrece descarga",
    availability.kinds.indexOf("downloadable") >= 0);

console.log(failures === 0 ? "todo correcto" : failures + " fallos");
process.exit(failures === 0 ? 0 : 1);
