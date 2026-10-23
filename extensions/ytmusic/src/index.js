/*
 * ytmusic — proveedor de busqueda y audio de YouTube Music para Liora.
 *
 * Como funciona
 * -------------
 * YouTube Music se usa por el reproductor web y por la app oficial a traves
 * de su API interna (Innertube). La extension separa dos tareas:
 *
 * 1. La busqueda la hace Liora de forma nativa con el cliente WEB_REMIX de
 *    InnerTubeX. Se piden solo canciones y se devuelven ya convertidas, sin
 *    bajar y recorrer el JSON completo dentro del motor JavaScript.
 * 2. La pista concreta la resuelve Liora de forma nativa con InnerTubeX, el
 *    mismo motor que usa BitChord. Ese motor prueba los clientes de YouTube,
 *    descifra la firma y el parametro `n` con QuickJS y comprueba con una
 *    peticion real que la URL firmada responde. La extension solo recibe la
 *    URL, sus cabeceras y los metadatos; nunca ve las cookies.
 *
 * La extension declara busqueda, metadatos, reproduccion y descarga. El
 * audio se reproduce con Media3 y se descarga con el gestor de Liora, que
 * comprueba el tamano antes de publicar el fichero.
 *
 * Aviso sobre las condiciones de uso: el contenido de YouTube Music pertenece
 * a sus titulares y YouTube no autoriza descargas. Esta extension da acceso
 * al mismo contenido que ve el usuario en su propia cuenta; no lo guarda ni
 * lo redistribuye.
 */

var WEB_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
var WEB_CLIENT = {
    name: "WEB_REMIX",
    version: "1.20250310.01.00",
    id: 67
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
    playerCache = {};
    trackCache = {};
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
    if (client.name === "IOS") {
        context.client.deviceMake = "Apple";
        context.client.deviceModel = "iPhone16,2";
        context.client.osName = "iPhone";
        context.client.osVersion = "18.3.2.22D82";
        context.client.clientFormFactor = "SMALL_FORM_FACTOR";
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
    var limit = request.limit ? request.limit : 25;
    if (!String(query).trim()) return { tracks: [] };

    // Camino rapido: Liora busca de forma nativa con WEB_REMIX y el filtro
    // de canciones. Devuelve solo las pistas, sin que el JSON pase por Rhino.
    if (host.youtube && typeof host.youtube.search === "function") {
        try {
            var native = host.youtube.search(query, limit);
            if (native && native.ok && native.tracks) {
                rememberTracks(native.tracks);
                host.log.info("Busqueda nativa de YouTube Music: " +
                    native.tracks.length + " pistas");
                return { tracks: native.tracks };
            }
            host.log.warn("La busqueda nativa fallo: " +
                (native && native.error ? native.error : "sin respuesta"));
        } catch (error) {
            host.log.warn("La busqueda nativa fallo: " + error.message);
        }
    }

    // Respaldo: el mismo camino de antes, por si una version de Liora no
    // tiene el puente nativo o YouTube cambia el formato.
    var data = innertube("music.youtube.com", WEB_KEY, "search", WEB_CLIENT, {
        context: clientContext(WEB_CLIENT),
        query: query
    });
    var items = findAll(data, "musicResponsiveListItemRenderer", [], 0);
    var tracks = [];
    for (var i = 0; i < items.length && tracks.length < limit; i++) {
        var track = toTrack(items[i]);
        if (track && track.title) tracks.push(track);
    }
    rememberTracks(tracks);
    return { tracks: tracks };
}

/**
 * Busca el catalogo completo para la pantalla de resultados.
 *
 * Liora hace las cuatro busquedas de YouTube Music en paralelo (canciones,
 * albumes, listas y artista) y las devuelve ya parseadas. Si la version de
 * Liora no tiene ese puente, se cae al camino de solo canciones.
 */
function searchCatalog(request) {
    var query = request.query || "";
    var limit = request.limit ? request.limit : 20;
    if (!String(query).trim()) {
        return { tracks: [], albums: [], playlists: [], artist: null };
    }

    if (host.youtube && typeof host.youtube.searchCatalog === "function") {
        try {
            var native = host.youtube.searchCatalog(query, limit);
            if (native && native.ok) {
                rememberTracks(native.tracks);
                host.log.info("Catalogo nativo de YouTube Music: " +
                    (native.tracks ? native.tracks.length : 0) + " pistas, " +
                    (native.albums ? native.albums.length : 0) + " albumes, " +
                    (native.playlists ? native.playlists.length : 0) + " listas");
                return {
                    tracks: native.tracks || [],
                    albums: native.albums || [],
                    playlists: native.playlists || [],
                    artist: native.artist || null
                };
            }
            host.log.warn("El catalogo nativo fallo: " +
                (native && native.error ? native.error : "sin respuesta"));
        } catch (error) {
            host.log.warn("El catalogo nativo fallo: " + error.message);
        }
    }

    var fallback = searchTracks(request);
    return {
        tracks: fallback.tracks || [],
        albums: [],
        playlists: [],
        artist: null
    };
}

/**
 * Abre un album o una lista y devuelve sus pistas.
 *
 * Liora navega la coleccion por su id con InnerTubeX y parsea el JSON en
 * Kotlin. La extension solo recibe la lista ya limpia. El respaldo por HTTP
 * existe para versiones antiguas de Liora que no tengan el puente nativo.
 */
function getCollection(request) {
    var id = request.collectionId || "";
    var limit = request.limit ? request.limit : 200;
    if (!String(id).trim()) return { tracks: [] };

    if (host.youtube && typeof host.youtube.collection === "function") {
        try {
            var native = host.youtube.collection(id, limit);
            if (native && native.ok && native.tracks) {
                rememberTracks(native.tracks);
                host.log.info("Coleccion nativa de YouTube Music: " +
                    native.tracks.length + " pistas");
                return { tracks: native.tracks };
            }
            host.log.warn("La coleccion nativa fallo: " +
                (native && native.error ? native.error : "sin respuesta"));
        } catch (error) {
            host.log.warn("La coleccion nativa fallo: " + error.message);
        }
    }

    var data = innertube("music.youtube.com", WEB_KEY, "browse", WEB_CLIENT, {
        context: clientContext(WEB_CLIENT),
        browseId: "VL" + id
    });
    var shelves = findAll(data, "musicPlaylistShelfRenderer", [], 0);
    var source = shelves.length ? shelves[0] : data;
    var items = findAll(source, "musicResponsiveListItemRenderer", [], 0);
    var tracks = [];
    for (var i = 0; i < items.length && tracks.length < limit; i++) {
        var track = toTrack(items[i]);
        if (track && track.title) tracks.push(track);
    }
    rememberTracks(tracks);
    return { tracks: tracks };
}

/** Las pistas que ya han salido en una busqueda, para no volver a resolverlas. */
var trackCache = {};

function rememberTracks(tracks) {
    if (!tracks) return;
    for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        if (track && track.id) trackCache[track.id] = track;
    }
}

function contractTrack(track) {
    return {
        id: track.id,
        title: track.title || "",
        artist: track.artist || "",
        album: track.album || "",
        durationMs: track.durationMs || 0,
        isrc: track.isrc || null,
        artworkUrl: track.artworkUrl || null
    };
}

function getTrack(request) {
    // La busqueda ya trae titulo, artista, album, duracion y portada. No hace
    // falta resolver el audio solo para devolver la ficha: hacerlo bloqueaba
    // el hilo de la extension durante la resolucion (y con ella la busqueda).
    var known = trackCache[request.trackId];
    if (known) return contractTrack(known);
    var info = playerCache[request.trackId];
    if (info && (info.title || info.artist || info.durationMs)) {
        return contractTrack({
            id: request.trackId,
            title: info.title,
            artist: info.artist,
            album: info.album,
            durationMs: info.durationMs,
            artworkUrl: info.artworkUrl
        });
    }
    return null;
}

/** Los datos de la pista, ya resueltos por el motor nativo de Liora. */
var playerCache = {};

function playerCacheValid(info) {
    if (!info) return false;
    if (!info.url) return false;
    if (!info.expiresAtMs) return true;
    return Date.now() < (info.expiresAtMs - 60000);
}

function emptyInfo() {
    return {
        url: null,
        title: "",
        artist: "",
        durationMs: 0,
        artworkUrl: null,
        headers: {},
        mimeType: null,
        bitrateKbps: null,
        sampleRateHz: null,
        expiresAtMs: 0,
        clientName: ""
    };
}

/**
 * Pide a Liora que resuelva el audio.
 *
 * La app usa InnerTubeX: elige cliente, descifra la firma y el parametro `n`
 * con QuickJS y prueba la URL contra el CDN. Si el CDN rechaza una fuente,
 * prueba otro cliente antes de darse por vencida. Aqui solo se guarda el
 * resultado para no repetir la resolucion en cada llamada.
 */
function playerInfo(videoId) {
    var cached = playerCache[videoId];
    if (playerCacheValid(cached)) return cached;

    var resolved = host.youtube.resolve(videoId);
    if (!resolved || !resolved.ok || !resolved.url) {
        var reason = (resolved && resolved.error) ? resolved.error : "sin fuente de audio";
        host.log.warn("No se pudo resolver " + videoId + ": " + reason);
        playerCache[videoId] = emptyInfo();
        return playerCache[videoId];
    }

    var headers = resolved.headers || {};
    var info = {
        title: resolved.title || "",
        artist: resolved.artist || "",
        album: "",
        durationMs: resolved.durationMs || 0,
        artworkUrl: resolved.artworkUrl || null,
        url: resolved.url,
        mimeType: resolved.mimeType || "audio/mp4",
        bitrateKbps: resolved.bitrateKbps || null,
        sampleRateHz: resolved.sampleRateHz || null,
        headers: headers,
        expiresAtMs: resolved.expiresAtMs || 0,
        clientName: resolved.clientName || "",
        itag: resolved.itag || 0
    };
    host.log.info("Fuente de audio con " + info.clientName +
        " (itag " + info.itag + ", " + info.mimeType + ")");
    playerCache[videoId] = info;
    return info;
}

function checkAvailability(request) {
    // No se resuelve el audio solo para responder a esto: la resolucion se
    // hace al reproducir o al descargar. Asi la lista de resultados no espera
    // a YouTube y sigue siendo instantanea.
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
        expiresAtMs: info.expiresAtMs || 0,
        headers: info.headers || {},
        notes: "Flujo de YouTube Music resuelto con InnerTubeX (" +
            (info.clientName || "cliente automático") + "); el enlace caduca"
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
        expiresAtMs: info.expiresAtMs || 0,
        headers: info.headers || {},
        notes: "Descarga del flujo de YouTube Music resuelto con InnerTubeX; el enlace caduca"
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
    var result = host.file.download(info.url, request.outputPath, info.headers || {});
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
    searchCatalog: searchCatalog,
    getCollection: getCollection,
    getTrack: getTrack,
    checkAvailability: checkAvailability,
    getAudioSource: getAudioSource,
    getDownloadUrl: getDownloadUrl,
    download: download
});
