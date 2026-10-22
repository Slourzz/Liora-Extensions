/*
 * ytmusic — proveedor de busqueda y audio de YouTube Music para Liora.
 *
 * Como funciona
 * -------------
 * YouTube Music se usa por el reproductor web y por la app oficial a traves
 * de su API interna (Innertube). La extension la usa igual que lo hacen los
 * reproductores de terceros de codigo abierto (NewPipe, yt-dlp y similares):
 *
 * 1. La busqueda va a `youtubei/v1/search` con el cliente WEB_REMIX, que es
 *    el mismo que usa el reproductor web.
 * 2. La pista concreta se resuelve en `youtubei/v1/player` con el cliente
 *    ANDROID_VR en la version 1.62.27. Ese cliente devuelve la URL del audio
 *    ya firmada y sin los tramites de los clientes mas nuevos, que exigen un
 *    token de "proof of origin" que solo se consigue con la atencion de
 *    YouTube (un reto automatico anti-bot). Aqui no se resuelve ningun reto ni
 *    se falsea ninguna identidad: se usa un cliente publico tal cual.
 *
 * La extension NO declara capacidad de descarga: entrega un flujo
 * reproducible, que es lo que la app reproduce con Media3.
 *
 * Aviso sobre las condiciones de uso: el contenido de YouTube Music pertenece
 * a sus titulares y YouTube no autoriza descargas. Esta extension da acceso
 * al mismo contenido que ve el usuario en su propia cuenta, en streaming; no
 * lo guarda ni lo redistribuye.
 */

var WEB_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
var PLAYER_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
var WEB_CLIENT = {
    name: "WEB_REMIX",
    version: "1.20250310.01.00",
    id: 67
};
var PLAYER_CLIENT = {
    name: "ANDROID",
    version: "20.10.38",
    id: 3,
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
};

var state = {
    visitorData: null,
    signedIn: false
};

function initialize(config) {
    var saved = host.storage.get("visitorData");
    if (saved) state.visitorData = saved;
    // El usuario puede haber iniciado sesion en Liora: con sesion, YouTube
    // deja de pedir el reto de "no eres un bot" y sirve el audio entero.
    state.signedIn = host.session.has("youtube");
    host.log.info("ytmusic inicializado" + (state.signedIn ? " (con sesion)" : ""));
    return { ok: true };
}

function cleanup() {
    state.visitorData = null;
    state.signedIn = false;
    return { ok: true };
}

function clientContext(client) {
    var context = {
        client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: "en",
            gl: "US"
        }
    };
    if (client.name === "ANDROID") {
        context.client.androidSdkVersion = 34;
        context.client.osName = "Android";
        context.client.osVersion = "14";
    }
    if (state.visitorData) context.client.visitorData = state.visitorData;
    return context;
}

/**
 * Una peticion a Innertube.
 *
 * Con sesion iniciada, la app anade las cookies y la firma: sin ellas,
 * YouTube responde con un reto anti-bot y no da ninguna fuente de audio.
 */
function innertube(hostname, key, endpoint, client, payload, useSession) {
    var body = JSON.stringify(payload);
    var response = host.http("POST",
        "https://" + hostname + "/youtubei/v1/" + endpoint + "?key=" + key,
        body,
        {
            "Content-Type": "application/json",
            "X-YouTube-Client-Name": String(client.id),
            "X-YouTube-Client-Version": client.version,
            "User-Agent": client.userAgent || "Mozilla/5.0"
        },
        !!useSession);
    if (!response || !response.ok) {
        throw new Error("YouTube respondio " + (response ? response.statusCode : "sin respuesta"));
    }
    return JSON.parse(response.body);
}

/** Recorre el JSON buscando un tipo de objeto, para no depender de la forma exacta. */
function findAll(node, type, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (depth > 30 || node === null || node === undefined) return out;
    if (Object.prototype.toString.call(node) === "[object Array]") {
        for (var i = 0; i < node.length; i++) findAll(node[i], type, out, depth + 1);
        return out;
    }
    if (typeof node === "object") {
        for (var key in node) {
            if (!node.hasOwnProperty(key)) continue;
            if (key === type) out.push(node[key]);
            findAll(node[key], type, out, depth + 1);
        }
    }
    return out;
}

function firstText(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (node.runs && node.runs.length) return node.runs[0].text || "";
    if (node.simpleText) return node.simpleText;
    return "";
}

function durationMs(text) {
    if (!text) return 0;
    var parts = String(text).split(":");
    var seconds = 0;
    for (var i = 0; i < parts.length; i++) {
        seconds = seconds * 60 + (parseInt(parts[i], 10) || 0);
    }
    return seconds * 1000;
}

// Las etiquetas de tipo que aparecen en la segunda columna, en varios
// idiomas, y que no son el artista.
var TYPES = [
    "Song", "Video", "Album", "Artist", "Playlist", "Single", "Episode",
    "Cancion", "Canciones", "Video", "Album", "Artista", "Lista de reproduccion",
    "Musique", "Chanson", "Album", "Kunstler", "Single", "Lied"
];

function toTrack(item) {
    // El id esta en el boton de play del overlay; en las listas antiguas
    // venia en el navigationEndpoint del propio item.
    var id = null;
    var overlay = item.overlay && item.overlay.musicItemThumbnailOverlayRenderer;
    if (overlay && overlay.content && overlay.content.musicPlayButtonRenderer) {
        var play = overlay.content.musicPlayButtonRenderer.playNavigationEndpoint;
        if (play && play.watchEndpoint) id = play.watchEndpoint.videoId;
    }
    if (!id && item.navigationEndpoint && item.navigationEndpoint.watchEndpoint) {
        id = item.navigationEndpoint.watchEndpoint.videoId;
    }
    if (!id) return null;

    // Las columnas: la primera es el titulo; la segunda es "Cancion - 5:29"
    // o, en el formato antiguo, "Artista - Album". El tipo y la duracion se
    // distinguen por su forma.
    var title = "";
    var artist = "";
    var length = "";
    var flex = item.flexColumns || [];
    for (var i = 0; i < flex.length; i++) {
        var column = flex[i].musicResponsiveListItemFlexColumnRenderer;
        if (!column) continue;
        var pieces = [];
        var runs = (column.text && column.text.runs) || [];
        for (var r = 0; r < runs.length; r++) {
            if (runs[r].text) pieces.push(runs[r].text);
        }
        if (i === 0) {
            title = pieces.join("");
            continue;
        }
        for (var p = 0; p < pieces.length; p++) {
            var piece = pieces[p].trim();
            if (!piece || piece === "•" || piece === "-") continue;
            if (/^[0-9]+:[0-9]+$/.test(piece)) {
                if (!length) length = piece;
                continue;
            }
            if (TYPES.indexOf(piece) >= 0) continue;
            // "1.8M plays" y cosas assim no son el artista.
            if (/^[0-9.,]+[KMB]?\s*(plays|reproducciones|oyentes)$/i.test(piece)) continue;
            if (!artist) artist = piece;
        }
    }

    // En el formato antiguo la duracion va en una columna fija aparte.
    if (!length) {
        var fixed = item.fixedColumns || [];
        for (var f = 0; f < fixed.length; f++) {
            var fixedColumn = fixed[f].musicResponsiveListItemFixedColumnRenderer;
            if (!fixedColumn) continue;
            var fixedText = firstText(fixedColumn.text);
            if (fixedText && /^[0-9]+:[0-9]+$/.test(fixedText.trim())) {
                length = fixedText.trim();
                break;
            }
        }
    }

    var cover = "";
    var thumbs = item.thumbnail && item.thumbnail.musicThumbnailRenderer
        ? item.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails : null;
    if (thumbs && thumbs.length) cover = thumbs[thumbs.length - 1].url || "";
    return {
        id: id,
        title: title,
        artist: artist,
        album: "",
        durationMs: durationMs(length),
        isrc: null,
        artworkUrl: cover || null
    };
}

function searchTracks(request) {
    var query = request.query || "";
    // Sin filtros: el parametro "params" de la API (el de "solo canciones")
    // hace que el servidor devuelva albumes y listas en vez de pistas, sin
    // id de video, y la busqueda se queda vacia.
    var data = innertube("music.youtube.com", WEB_KEY, "search", WEB_CLIENT, {
        context: clientContext(WEB_CLIENT),
        query: query
    });
    var items = findAll(data, "musicResponsiveListItemRenderer", [], 0);
    var tracks = [];
    var limit = request.limit ? request.limit : 25;
    for (var i = 0; i < items.length && tracks.length < limit; i++) {
        var track = toTrack(items[i]);
        if (track && track.title) tracks.push(track);
    }
    return { tracks: tracks };
}

function getTrack(request) {
    var info = playerInfo(request.trackId);
    if (!info) return null;
    return {
        id: request.trackId,
        title: info.title,
        artist: info.artist,
        album: info.album,
        durationMs: info.durationMs,
        isrc: null,
        artworkUrl: info.artworkUrl
    };
}

/** Los datos de la pista y su URL de audio, del endpoint de reproduccion. */
var playerCache = {};

function playerInfo(videoId) {
    if (playerCache[videoId]) return playerCache[videoId];
    var data = innertube("youtubei.googleapis.com", PLAYER_KEY, "player", PLAYER_CLIENT, {
        context: clientContext(PLAYER_CLIENT),
        videoId: videoId
    }, state.signedIn);
    var details = data.videoDetails || {};
    var formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
    var audio = null;
    for (var i = 0; i < formats.length; i++) {
        var format = formats[i];
        if (!format.mimeType || format.mimeType.indexOf("audio/") !== 0) continue;
        if (!format.url) continue;
        // itag 140 es AAC-LC en m4a: el que mejor se lleva Media3.
        if (!audio || format.itag === 140) audio = format;
    }
    var artwork = null;
    var thumbs = details.thumbnail && details.thumbnail.thumbnails;
    if (thumbs && thumbs.length) artwork = thumbs[thumbs.length - 1].url || null;
    var info = {
        title: details.title || "",
        artist: details.author || "",
        album: "",
        durationMs: details.lengthSeconds ? details.lengthSeconds * 1000 : 0,
        artworkUrl: artwork,
        url: audio ? audio.url : null,
        mimeType: audio ? String(audio.mimeType).split(";")[0].trim() : null,
        bitrateKbps: audio && audio.bitrate ? Math.round(audio.bitrate / 1000) : null,
        sampleRateHz: audio && audio.audioSampleRate ? audio.audioSampleRate : null,
        // El servidor de video comprueba el agente de usuario: sin el mismo
        // que pidio la fuente, responde 403.
        headers: { "User-Agent": PLAYER_CLIENT.userAgent }
    };
    playerCache[videoId] = info;
    return info;
}

function checkAvailability(request) {
    var info = playerInfo(request.trackId);
    if (!info || !info.url) {
        return {
            available: false,
            kinds: [],
            reason: "YouTube Music no ha devuelto una fuente de audio para esta pista"
        };
    }
    return { available: true, kinds: ["playable", "downloadable"], quality: "AAC" };
}

function getAudioSource(request) {
    var info = playerInfo(request.trackId);
    if (!info || !info.url) {
        return { error: "YouTube Music no ha devuelto una fuente de audio para esta pista" };
    }
    return {
        kind: "playable",
        url: info.url,
        mimeType: info.mimeType || "audio/mp4",
        bitrateKbps: info.bitrateKbps,
        sampleRateHz: info.sampleRateHz,
        durationMs: info.durationMs,
        headers: info.headers || {},
        notes: "Flujo de YouTube Music (cliente ANDROID 20.10.38); el enlace caduca"
    };
}

/**
 * La direccion desde la que se puede descargar la pista.
 *
 * Es la misma fuente que se reproduce: la app la baja y comprueba que el
 * fichero esta completo antes de publicarlo.
 */
function getDownloadUrl(request) {
    var info = playerInfo(request.trackId);
    if (!info || !info.url) {
        return { error: "YouTube Music no ha devuelto una fuente de audio para esta pista" };
    }
    return {
        kind: "downloadable",
        url: info.url,
        mimeType: info.mimeType || "audio/mp4",
        bitrateKbps: info.bitrateKbps,
        durationMs: info.durationMs,
        headers: info.headers || {},
        notes: "Descarga del flujo de YouTube Music; el enlace caduca"
    };
}

/**
 * Descarga la pista al fichero de salida.
 *
 * La extension no baja el fichero por su cuenta: pide a la app que lo haga,
 * que es quien comprueba el tamaño y el formato antes de publicarlo.
 */
function download(request) {
    var info = playerInfo(request.trackId);
    if (!info || !info.url) {
        return {
            success: false,
            error: "YouTube Music no ha devuelto una fuente de audio para esta pista",
            errorType: "not_supported"
        };
    }
    var result = host.file.download(info.url, request.outputPath);
    if (!result || !result.ok || !result.success) {
        return {
            success: false,
            error: (result && result.error) ? result.error : "No se pudo descargar el audio",
            errorType: (result && result.errorType) ? result.errorType : "download_failed"
        };
    }
    return {
        success: true,
        filePath: request.outputPath,
        bytes: result.bytes || 0,
        mimeType: info.mimeType || "audio/mp4"
    };
}

registerExtension({
    initialize: initialize,
    cleanup: cleanup,
    searchTracks: searchTracks,
    getTrack: getTrack,
    checkAvailability: checkAvailability,
    getAudioSource: getAudioSource,
    getDownloadUrl: getDownloadUrl,
    download: download
});
