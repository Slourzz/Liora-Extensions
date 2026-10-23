/*
 * Pruebas de ytmusic, sin Liora ni red: el host es una maqueta con la
 * forma de las respuestas nativas de Liora y de Innertube.
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
const nativeSearches = [];
const nativeCatalogs = [];
const nativeCollections = [];
const nativeResolves = [];

// Respuesta del camino JavaScript de respaldo: el formato antiguo, con el id
// en el boton de play y la duracion en una columna fija.
const fallbackSearchResponse = {
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

const nativeTrack = {
    id: "abc123",
    title: "Around the World",
    artist: "Daft Punk",
    album: "Discovery",
    durationMs: 244000,
    isrc: null,
    artworkUrl: "https://i.ytimg.com/vi/abc/hq.jpg"
};

function nativeSearch(query, limit) {
    nativeSearches.push({ query: query, limit: limit });
    return { ok: true, count: 1, tracks: [nativeTrack] };
}

function nativeSearchCatalog(query, limit) {
    nativeCatalogs.push({ query: query, limit: limit });
    return {
        ok: true,
        count: 1,
        tracks: [nativeTrack],
        albums: [{
            id: "OLAK5uy_album",
            title: "Discovery",
            subtitle: "Álbum • Daft Punk • 2001",
            artworkUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
            kind: "album"
        }],
        playlists: [{
            id: "PL_list",
            title: "Daft Punk Essentials",
            subtitle: "YouTube Music • 1.2 M de vistas",
            artworkUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
            kind: "playlist"
        }],
        artist: {
            name: "Daft Punk",
            subtitle: "Artista • Público mensual: 20 M usuarios",
            artworkUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
            browseId: "UCdaftpunk"
        }
    };
}

function nativeCollection(collectionId, limit) {
    nativeCollections.push({ collectionId: collectionId, limit: limit });
    return { ok: true, count: 1, tracks: [nativeTrack] };
}

function nativeResolve(videoId) {
    nativeResolves.push(videoId);
    return {
        ok: true,
        videoId: videoId,
        url: "https://rr1---sn-x.googlevideo.com/videoplayback?expire=1",
        headers: { "Range": "bytes=0-" },
        mimeType: "audio/mp4",
        codecs: "mp4a.40.2",
        bitrate: 130677,
        bitrateKbps: 130,
        sampleRateHz: 44100,
        durationMs: 244000,
        title: "Around the World",
        artist: "Daft Punk",
        artworkUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
        expiresAtMs: Date.now() + 3600000,
        contentLengthBytes: 4000000,
        itag: 140,
        clientName: "VISIONOS",
        profileId: "VISIONOS_0_1__nopo",
        requireBoundedRange: true,
        loudnessDb: 0
    };
}

const host = {
    http: function (method, url, body, headers, useSession) {
        requests.push({
            method: method, url: url, body: body,
            headers: headers || {}, useSession: !!useSession
        });
        if (url.indexOf("/search") >= 0) {
            return { ok: true, statusCode: 200, body: JSON.stringify(fallbackSearchResponse) };
        }
        return { ok: false, statusCode: 404, body: "{}" };
    },
    storage: { get: function () { return null; }, set: function () { return { ok: true }; } },
    session: { has: function () { return false; } },
    log: { info: function () {}, warn: function () {}, error: function () {} },
    youtube: {
        search: nativeSearch,
        searchCatalog: nativeSearchCatalog,
        collection: nativeCollection,
        resolve: nativeResolve
    }
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
        typeof registered.searchCatalog === "function" &&
        typeof registered.getCollection === "function" &&
        typeof registered.getTrack === "function" &&
        typeof registered.checkAvailability === "function" &&
        typeof registered.getAudioSource === "function"
);

const started = registered.initialize({});
check("initialize responde", started && started.ok === true);

const requestsBeforeSearch = requests.length;
const found = registered.searchTracks({ query: "around the world", limit: 10 });
check("la busqueda nativa devuelve la pista", found.tracks.length === 1);
check("la busqueda nativa usa el puente", nativeSearches.length === 1);
check("la busqueda nativa recibe la consulta",
    nativeSearches[0].query === "around the world");
check("la busqueda nativa recibe el limite", nativeSearches[0].limit === 10);
check("la busqueda nativa no hace peticiones HTTP",
    requests.length === requestsBeforeSearch);
check("el id viene del puente nativo", found.tracks[0].id === "abc123");
check("el titulo viene del puente nativo", found.tracks[0].title === "Around the World");
check("el artista viene del puente nativo", found.tracks[0].artist === "Daft Punk");
check("la duracion viene del puente nativo", found.tracks[0].durationMs === 244000);
check("la portada viene del puente nativo",
    found.tracks[0].artworkUrl.indexOf("i.ytimg.com") >= 0);

const catalog = registered.searchCatalog({ query: "daft punk", limit: 12 });
check("el catalogo nativo devuelve pistas", catalog.tracks.length === 1);
check("el catalogo nativo devuelve albumes", catalog.albums.length === 1);
check("el catalogo nativo devuelve listas", catalog.playlists.length === 1);
check("el catalogo nativo devuelve el artista", catalog.artist.name === "Daft Punk");
check("el catalogo usa el puente nativo", nativeCatalogs.length === 1);
check("el catalogo recibe la consulta", nativeCatalogs[0].query === "daft punk");
check("el catalogo recibe el limite", nativeCatalogs[0].limit === 12);
check("el catalogo conserva el id del album",
    catalog.albums[0].id === "OLAK5uy_album");
check("el catalogo conserva el id de la lista",
    catalog.playlists[0].id === "PL_list");

const album = registered.getCollection({
    collectionId: "OLAK5uy_album",
    limit: 50
});
check("la coleccion nativa devuelve sus pistas", album.tracks.length === 1);
check("la coleccion usa el puente nativo", nativeCollections.length === 1);
check("la coleccion recibe el id", nativeCollections[0].collectionId === "OLAK5uy_album");
check("la coleccion recibe el limite", nativeCollections[0].limit === 50);
check("la coleccion conserva el id de la pista", album.tracks[0].id === "abc123");

// Si el puente nativo falla, el camino JavaScript de antes sigue funcionando.
host.youtube.search = function () { return { ok: false, error: "sin red" }; };
const fallback = registered.searchTracks({ query: "around the world", limit: 10 });
check("el respaldo JavaScript devuelve la pista", fallback.tracks.length === 1);
check("el respaldo conserva el id", fallback.tracks[0].id === "abc123");
const fallbackRequest = requests.filter(function (r) { return r.url.indexOf("/search") >= 0; })[0];
check("el respaldo usa WEB_REMIX",
    fallbackRequest && fallbackRequest.headers["X-YouTube-Client-Name"] === "67");
host.youtube.search = nativeSearch;

const track = registered.getTrack({ trackId: "abc123" });
check("getTrack devuelve la pista", track.title === "Around the World");
check("getTrack trae el artista", track.artist === "Daft Punk");
check("getTrack usa la cache de la busqueda", nativeResolves.length === 0);
check("getTrack conserva la duracion", track.durationMs === 244000);

const availability = registered.checkAvailability({ trackId: "abc123" });
check("hay disponibilidad", availability.available === true);
check("la fuente es reproducible", availability.kinds[0] === "playable");
check("la disponibilidad no resuelve el audio", nativeResolves.length === 0);

const playableSource = registered.getAudioSource({ trackId: "abc123" });
check("la fuente trae la url de audio", playableSource.url.indexOf("googlevideo.com") >= 0);
check("la fuente es m4a", playableSource.mimeType.indexOf("audio/mp4") === 0);
check("la fuente trae la duracion", playableSource.durationMs === 244000);
check("la fuente conserva las cabeceras", playableSource.headers["Range"] === "bytes=0-");
check("la fuente usa el resolutor nativo", nativeResolves.length === 1);

const downloadable = registered.getDownloadUrl({ trackId: "abc123" });
check("la descarga trae la url de audio", downloadable.url.indexOf("googlevideo.com") >= 0);
check("la descarga es descargable", downloadable.kind === "downloadable");
check("la descarga conserva las cabeceras", downloadable.headers["Range"] === "bytes=0-");
check("la disponibilidad ofrece descarga",
    availability.kinds.indexOf("downloadable") >= 0);

console.log(failures === 0 ? "todo correcto" : failures + " fallos");
process.exit(failures === 0 ? 0 : 1);
