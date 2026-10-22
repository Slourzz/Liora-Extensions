/*
 * demo-audio — proveedor de audio de prueba para Liora.
 *
 * Es una extensión de demostración: no habla con ningún servicio real, sirve
 * para comprobar el circuito completo (catálogo → descarga → instalación →
 * ejecución → proveedor). La fuente de audio es un tono de prueba que trae
 * la propia aplicación, con el esquema "liora-asset".
 *
 * El contrato de las extensiones de Liora está en el README del repositorio.
 */

var CATALOG = [
    {
        id: "demo-tone",
        title: "Tono de prueba",
        artist: "Liora",
        album: "Demo",
        durationMs: 2000,
        isrc: "DEMO00000001",
        artworkUrl: null
    },
    {
        id: "demo-tone-long",
        title: "Tono de prueba (largo)",
        artist: "Liora",
        album: "Demo",
        durationMs: 4000,
        isrc: "DEMO00000002",
        artworkUrl: null
    }
];

var state = {
    assetName: "test_tone",
    scheme: "liora-asset"
};

function initialize(config) {
    // La app dice como se llaman sus recursos empaquetados y con que esquema
    // se piden. Asi la extension no depende de nombres propios de Liora.
    if (config && config.assetScheme) {
        state.scheme = config.assetScheme;
    }
    host.log.info("demo-audio inicializado (" + state.scheme + ")");
    return { ok: true };
}

function cleanup() {
    host.log.info("demo-audio cerrado");
    return { ok: true };
}

function searchTracks(request) {
    var query = (request && request.query ? request.query : "").toLowerCase();
    var limit = request && request.limit ? request.limit : 20;
    var tracks = [];
    for (var i = 0; i < CATALOG.length; i++) {
        var track = CATALOG[i];
        var haystack = (track.title + " " + track.artist + " " + track.album).toLowerCase();
        if (query === "" || haystack.indexOf(query) >= 0) {
            tracks.push({
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                durationMs: track.durationMs,
                isrc: track.isrc,
                artworkUrl: track.artworkUrl
            });
        }
    }
    return { tracks: tracks.slice(0, limit) };
}

function findInCatalog(trackId) {
    for (var i = 0; i < CATALOG.length; i++) {
        if (CATALOG[i].id === trackId) {
            return CATALOG[i];
        }
    }
    return null;
}

function getTrack(request) {
    var track = findInCatalog(request.trackId);
    if (track) {
        return track;
    }
    return { id: request.trackId, title: request.trackId, artist: "Liora" };
}

function checkAvailability(request) {
    var known = findInCatalog(request.trackId) !== null;
    return {
        available: known,
        kinds: known ? ["playable", "downloadable"] : [],
        quality: "demo",
        reason: known ? "" : "Esta demo solo conoce sus propias pistas"
    };
}

function getAudioSource(request) {
    var availability = checkAvailability(request);
    if (!availability.available) {
        return { error: availability.reason };
    }
    return {
        kind: "playable",
        url: state.scheme + "://" + state.assetName,
        mimeType: "audio/wav",
        bitrateKbps: 705,
        sampleRateHz: 22050,
        channels: 1,
        durationMs: getTrack(request).durationMs,
        requiresAuthentication: false,
        notes: "Tono de prueba empaquetado en la propia aplicacion"
    };
}

function getDownloadUrl(request) {
    var availability = checkAvailability(request);
    if (!availability.available) {
        return { error: availability.reason };
    }
    return {
        kind: "downloadable",
        url: state.scheme + "://" + state.assetName,
        mimeType: "audio/wav"
    };
}

function download(request) {
    var target = request.outputPath;
    var result = host.file.download(state.scheme + "://" + state.assetName, target);
    if (!result || !result.success) {
        return {
            success: false,
            error: (result && result.error) ? result.error : "no se pudo descargar",
            errorType: (result && result.errorType) ? result.errorType : "download_failed"
        };
    }
    return {
        success: true,
        filePath: result.path,
        bytes: result.bytes
    };
}

function fetchLyrics(request) {
    return {
        lines: [
            { startMs: 0, endMs: 1000, text: "Tono de prueba" },
            { startMs: 1000, endMs: 2000, text: "de Liora" }
        ],
        plainText: "Tono de prueba\nde Liora",
        provider: "demo-audio"
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
    download: download,
    fetchLyrics: fetchLyrics
});
