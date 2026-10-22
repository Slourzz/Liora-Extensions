# Liora Extensions

Repositorio de extensiones para [Liora](https://github.com/Slourzz/Liora), la
reproductora de música para Android.

Aquí viven **las implementaciones de los proveedores**, no la aplicación. Liora
trae el motor, el instalador y el registro de proveedores; una extensión trae
su código y su manifiesto. Publicar una extensión nueva —o corregirla— no
obliga a publicar una versión nueva de la app.

## Qué es una extensión

Una extensión es un paquete `.lioraext` (un ZIP) con:

```
mi-extension.lioraext
├── manifest.json     # quién es, qué necesita y qué puede hacer
└── src/index.js      # el código, en JavaScript
```

El manifiesto declara los **tipos de proveedor** que implementa, los
**permisos** que pide y la **versión mínima de Liora** que necesita. Solo se
registra como proveedor de los tipos que declara: una extensión de metadatos
nunca aparece como proveedor de descarga.

| Tipo | Qué aporta |
|---|---|
| `metadata_provider` | Los datos de una pista por su identificador. |
| `track_search_provider` | La búsqueda de canciones. |
| `audio_source_provider` | Una fuente que se puede reproducir. |
| `audio_download_provider` | Un archivo completo que se puede descargar. |
| `lyrics_provider` | La letra, con o sin sincronizar. |

## Estructura de este repositorio

```
Liora-Extensions/
├── registry.json              # el catálogo: lo que consulta Liora
├── extensions/
│   └── demo-audio/            # una extensión: su manifiesto y su código
│       ├── manifest.json
│       ├── src/index.js
│       └── tests/
├── packages/                  # los paquetes construidos, listos para bajar
├── schemas/                   # los esquemas JSON del manifiesto y del registro
├── scripts/build_packages.py  # construye los paquetes y refresca el registro
└── .github/workflows/         # comprueba que el registro y los paquetes cuadran
```

## Publicar una extensión

1. Crea `extensions/mi-extension/` con `manifest.json` y `src/index.js`.
2. Escribe el registro a mano o deja que el script lo haga:
   ```bash
   python scripts/build_packages.py mi-extension
   ```
   El script construye un ZIP **reproducible**, calcula su SHA-256 y deja la
   entrada al día en `registry.json`.
3. Sube el cambio. Liora verá la extensión en su catálogo la próxima vez que
   refresque el repositorio.

## Añadir el repositorio en Liora

Ajustes → Extensiones → **Añadir repositorio**, con la dirección del
registro:

```
https://raw.githubusercontent.com/Slourzz/Liora-Extensions/main/registry.json
```

También vale la forma corta: `github.com/Slourzz/Liora-Extensions`.

## El puente disponible para el JavaScript

La extensión no ve la aplicación: solo ve `host`, que es la única puerta.

```js
host.http(method, url, body)        // solo a los dominios declarados
host.storage.get(key)                // solo si pides "storage"
host.storage.set(key, value)
host.log.info(message)
host.file.download(url, target)      // solo si pides "file"
host.file.readText(path)
host.file.writeText(path, text)
```

Y se declaran las funciones con `registerExtension`:

```js
registerExtension({
    initialize: function (config) { return { ok: true }; },
    cleanup: function () {},
    searchTracks: function (request) { return { tracks: [] }; },
    getTrack: function (request) { return { id: request.trackId, title: "x", artist: "y" }; },
    checkAvailability: function (request) { return { available: false, kinds: [] }; },
    getAudioSource: function (request) { return { kind: "playable", url: "https://..." }; },
    getDownloadUrl: function (request) { return { kind: "downloadable", url: "https://..." }; },
    download: function (request) { return { success: true, filePath: request.outputPath }; },
    fetchLyrics: function (request) { return { lines: [], plainText: "" }; }
});
```

No hace falta implementar todas: cada extensión implementa las que necesita
y las declara en su manifiesto.

El JavaScript es **ES5** (`var`, funciones clásicas): el motor de Liora es
Rhino y no entiende `const`, `let`, funciones flecha ni clases.

## La extensión de demostración

`extensions/demo-audio` es un proveedor de prueba: no habla con ningún
servicio, sirve un tono que trae la propia Liora. Sirve para comprobar el
circuito completo sin depender de ninguna API externa.

## Seguridad

- Los paquetes se descargan **siempre por https** y se comprueban con su
  **SHA-256**: es integridad respecto a lo publicado, no confianza en quien
  publica.
- Las extensiones se ejecutan en un motor JavaScript aislado, sin acceso a las
  clases de Java, con un límite de tiempo por llamada y sin permisos que no
  hayan declarado.
- Los dominios a los que puede hablar una extensión se comprueban en la capa
  nativa de Liora, no en el script.

Más detalles en [SECURITY.md](SECURITY.md).

## Licencia

MIT. Ver [LICENSE](LICENSE).
