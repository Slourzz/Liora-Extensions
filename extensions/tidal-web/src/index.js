/*
 * tidal-web — proveedor de metadatos, busqueda y disponibilidad de TIDAL
 * para Liora, usando la API oficial de TIDAL (developer.tidal.com).
 *
 * Que es y que no es
 * -------------------
 * La API oficial de TIDAL (api.tidal.com) da el catalogo: busqueda, fichas,
 * portadas, ISRC y duraciones. Se usa con las credenciales que el usuario
 * registra en developer.tidal.com y las mete en los ajustes de la extension:
 * el nucleo de Liora no guarda ni ve esas credenciales.
 *
 * El audio de TIDAL va cifrado con Widevine (DRM). El endpoint oficial de
 * reproduccion (`tracks/{id}/playbackinfopostpaywall`) dice si el contenido
 * viene sin cifrar o protegido. Esta extension solo devuelve una fuente
 * cuando el manifiesto viene con `encryptionType: NONE`: si viene cifrado, lo
 * dice con un error claro en vez de inventar una URL. No se intenta
 * descifrar ni eludir el DRM, y la extension no declara capacidad de
 * descarga.
 *
 * Documentacion: https://developer.tidal.com/documentation/api-sdk/
 * Licencia del catalogo: cada ficha trae la suya; la API no concede derechos
 * de redistribucion.
 */

var API = "https://api.tidal.com";
var AUTH = "https://auth.tidal.com/v1/oauth2/token";
var MANIFEST = "application/vnd.tidal.v1+json";

var state = {
    token: null,
    tokenExpires: 0,
    country: "US",
    clientId: null,
    clientSecret: null
};

var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(text) {
    var clean = String(text).replace(/[^A-Za-z0-9+/=]/g, "");
    var output = "";
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
        var index = BASE64.indexOf(clean.charAt(i));
        if (index < 0) continue;
        buffer = (buffer << 6) | index;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return output;
}

function initialize(config) {
    var settings = (config && config.settings) || {};
    if (settings.countryCode) state.country = String(settings.countryCode).toUpperCase();
    state.clientId = settings.clientId || null;
    state.clientSecret = settings.clientSecret || null;
    var cached = host.storage.get("token");
    if (cached) {
        try {
            var saved = JSON.parse(cached);
            state.token = saved.token;
            state.tokenExpires = saved.expires || 0;
        } catch (e) {
            host.storage.set("token", "null");
        }
    }
    host.log.info("tidal-web inicializado (" + state.country + ")");
    return { ok: true };
}

function cleanup() {
    state.token = null;
    state.tokenExpires = 0;
    return { ok: true };
}

/** El token de acceso, renovando con las credenciales del usuario. */
function accessToken() {
    if (!state.clientId || !state.clientSecret) {
        throw new Error("Faltan las credenciales de la API de TIDAL: pon el client id y el " +
            "client secret en los ajustes de esta extension (se sacan de developer.tidal.com)");
    }
    var now = Date.now();
    if (state.token && state.tokenExpires > now + 30000) {
        return state.token;
    }
    var body = "grant_type=client_credentials&client_id=" + encodeURIComponent(state.clientId) +
        "&client_secret=" + encodeURIComponent(state.clientSecret);
    var response = host.http("POST", AUTH, body);
    if (!response || !response.ok) {
        throw new Error("TIDAL no ha dado el token: HTTP " +
            (response ? response.statusCode : "sin respuesta"));
    }
    var data = JSON.parse(response.body);
    state.token = data.access_token;
    state.tokenExpires = now + (parseInt(data.expires_in, 10) || 3600) * 1000;
    host.storage.set("token", JSON.stringify({
        token: state.token,
        expires: state.tokenExpires
    }));
    return state.token;
}

/** Una peticion a la API de TIDAL. */
function api(path) {
    var token = accessToken();
    var response = host.http("GET", API + path, null, {
        "Authorization": "Bearer " + token,
        "accept": MANIFEST,
        "countryCode": state.country
    });
    if (!response || !response.ok) {
        var detail = "";
        try {
            detail = (JSON.parse(response.body).errors || [])[0].detail || "";
        } catch (e) {}
        throw new Error("TIDAL respondio " + (response ? response.statusCode : "?") + " " + detail);
    }
    return JSON.parse(response.body);
}

/** La ficha de una pista. */
function toTrack(track) {
    var artists = track.artists || [];
    var names = [];
    for (var i = 0; i < artists.length; i++) {
        names.push(artists[i].name);
    }
    return {
        id: String(track.id),
        title: track.title,
        artist: names.join(", "),
        album: track.album ? track.album.title : "",
        durationMs: Math.round((track.duration || 0) * 1000),
        isrc: track.isrc || null,
        artworkUrl: track.album && track.album.cover
            ? "https://resources.tidal.com/images/640/640/" + track.album.cover
            : null
    };
}

function searchTracks(request) {
    var query = encodeURIComponent(request.query || "");
    var data = api("/v1/search?query=" + query + "&limit=25");
    var items = data.items || [];
    var tracks = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item.id || !item.type) continue;
        if (item.type === "artist" || item.type === "album" || item.type === "playlist") continue;
        tracks.push(toTrack(item));
    }
    return { tracks: tracks };
}

function getTrack(request) {
    var data = api("/v1/tracks/" + encodeURIComponent(request.trackId));
    if (!data || !data.id) return null;
    return toTrack(data);
}

/**
 * Si hay fuente y de que tipo.
 *
 * Se pregunta al endpoint oficial de reproduccion: el dice si la pista se
 * puede reproducir en el pais y la cuenta del usuario, y si el contenido
 * viene cifrado.
 */
function checkAvailability(request) {
    var info = playbackInfo(request.trackId);
    if (!info) {
        return { available: false, kinds: [], reason: "TIDAL no ha devuelto informacion de la pista" };
    }
    if (info.encrypted) {
        return {
            available: false,
            kinds: [],
            reason: "La pista esta protegida con DRM: solo se puede reproducir dentro de la app oficial de TIDAL"
        };
    }
    return { available: true, kinds: ["playable"], quality: info.quality };
}

/** La informacion de reproduccion que da TIDAL. */
function playbackInfo(trackId) {
    var path = "/v1/tracks/" + encodeURIComponent(trackId) + "/playbackinfopostpaywall" +
        "?audioquality=HIGH&playbackmode=STREAM&assetpresentation=FULL&countryCode=" + state.country;
    var data = api(path);
    if (!data || !data.manifest) return null;
    var manifest = null;
    try {
        manifest = JSON.parse(base64Decode(data.manifest));
    } catch (e) {
        manifest = null;
    }
    var encrypted = true;
    var url = null;
    if (manifest && manifest.encryptionType === "NONE" && manifest.urls && manifest.urls.length) {
        encrypted = false;
        url = manifest.urls[0];
    }
    return {
        encrypted: encrypted,
        url: url,
        quality: data.audioQuality || null,
        codec: manifest ? manifest.codecs : null
    };
}

/**
 * La fuente con la que se puede reproducir la pista.
 *
 * Solo se devuelve si el contenido viene sin cifrar. Con DRM no hay fuente:
 * es mejor un error claro que una URL que no suena.
 */
function getAudioSource(request) {
    var availability = checkAvailability(request);
    if (!availability.available) {
        return { error: availability.reason };
    }
    var info = playbackInfo(request.trackId);
    if (!info || !info.url) {
        return { error: "TIDAL no ha dado una fuente reproducible para esta pista" };
    }
    return {
        kind: "playable",
        url: info.url,
        mimeType: info.codec === "flac" ? "audio/flac" : "audio/mp4",
        requiresAuthentication: true,
        notes: "Fuente de TIDAL entregada por su API oficial"
    };
}

/**
 * TIDAL no autoriza la descarga del catalogo, asi que esta extension no
 * declara capacidad de descarga: se limitan a buscar, consultar y reproducir.
 */
function getDownloadUrl(request) {
    return {
        error: "TIDAL no autoriza la descarga de su catalogo: solo se puede reproducir"
    };
}

function download(request) {
    return {
        success: false,
        error: "TIDAL no autoriza la descarga de su catalogo",
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
