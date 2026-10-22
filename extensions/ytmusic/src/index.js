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
    name: "ANDROID_VR",
    version: "1.62.27",
    id: 28,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L) gzip"
};

var state = {
    visitorData: null
};

function initialize(config) {
    var saved = host.storage.get("visitorData");
    if (saved) state.visitorData = saved;
    host.log.info("ytmusic inicializado");
    return { ok: true };
}

function cleanup() {
    state.visitorData = null;
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
    if (client.name === "ANDROID_VR") {
        context.client.deviceMake = "Oculus";
        context.client.deviceModel = "Quest 3";
        context.client.androidSdkVersion = 32;
        context.client.osName = "Android";
        context.client.osVersion = "12L";
    }
    if (state.visitorData) context.client.visitorData = state.visitorData;
    return context;
}

/** Una peticion a Innertube. */
function innertube(hostname, key, endpoint, client, payload) {
    var body = JSON.stringify(payload);
    var response = host.http("POST",
        "https://" + hostname + "/youtubei/v1/" + endpoint + "?key=" + key,
        body,
        {
            "Content-Type": "application/json",
            "X-YouTube-Client-Name": String(client.id),
            "X-YouTube-Client-Version": client.version,
            "User-Agent": client.userAgent || "Mozilla/5.0"
        });
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

    var title = "";
    var artist = "";
    var flex = item.flexColumns || [];
    for (var i = 0; i < flex.length; i++) {
        var column = flex[i].musicResponsiveListItemFlexColumnRenderer;
        var text = firstText(column ? column.text : null);
        if (!text) continue;
        if (i === 0) title = text;
        else if (i === 1) artist = text;
    }
    var length = "";
    var fixed = item.fixedColumns || [];
    if (fixed.length) {
        var fixedColumn = fixed[0].musicResponsiveListItemFixedColumnRenderer;
        length = firstText(fixedColumn ? fixedColumn.text : null);
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
    // El parametro "params" pide solo canciones (no albumes ni artistas):
    // la respuesta del servidor baja de 795 KB a 607 KB, que en una conexion
    // lenta es la diferencia entre que llegue y no llegue.
    var data = innertube("music.youtube.com", WEB_KEY, "search", WEB_CLIENT, {
        context: clientContext(WEB_CLIENT),
        query: query,
        params: "EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D"
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
function playerInfo(videoId) {
    var data = innertube("youtubei.googleapis.com", PLAYER_KEY, "player", PLAYER_CLIENT, {
        context: clientContext(PLAYER_CLIENT),
        videoId: videoId
    });
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
    return {
        title: details.title || "",
        artist: details.author || "",
        album: "",
        durationMs: details.lengthSeconds ? details.lengthSeconds * 1000 : 0,
        artworkUrl: artwork,
        url: audio ? audio.url : null,
        mimeType: audio ? audio.mimeType : null,
        bitrateKbps: audio && audio.bitrate ? Math.round(audio.bitrate / 1000) : null,
        sampleRateHz: audio && audio.audioSampleRate ? audio.audioSampleRate : null
    };
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
    return { available: true, kinds: ["playable"], quality: "AAC" };
}

function getAudioSource(request) {
    var info = playerInfo(request.trackId);
    if (!info || !info.url) {
        return { error: "YouTube Music no ha devuelto una fuente de audio para esta pista" };
    }
    return {
        kind: "playable",
        url: info.url,
        mimeType: "audio/mp4",
        bitrateKbps: info.bitrateKbps,
        sampleRateHz: info.sampleRateHz,
        durationMs: info.durationMs,
        notes: "Flujo de YouTube Music (cliente ANDROID_VR 1.62.27); el enlace caduca"
    };
}

/**
 * YouTube Music no autoriza la descarga de su contenido, asi que la extension
 * no la ofrece: entrega el flujo para reproducirlo.
 */
function getDownloadUrl(request) {
    return { error: "YouTube Music no autoriza la descarga de su catalogo" };
}

function download(request) {
    return {
        success: false,
        error: "YouTube Music no autoriza la descarga de su catalogo",
        errorType: "not_supported"
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
