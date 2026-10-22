# demo-audio

Proveedor de **audio de prueba** para Liora.

No habla con ningun servicio: su catalogo son dos pistas inventadas y su
fuente de audio es un tono que trae la propia aplicacion (con el esquema
`liora-asset`). Sirve para comprobar el circuito completo de extensiones sin
depender de ninguna API externa:

- el registro se descarga y se muestra en el catalogo,
- el paquete se verifica con su SHA-256,
- la extension se instala y se ejecuta,
- Liora registra su proveedor y lo usa para buscar, consultar la
  disponibilidad, reproducir y descargar.

## Capacidades

| Tipo | Que hace |
|---|---|
| `track_search_provider` | Devuelve las dos pistas de la demo. |
| `metadata_provider` | Devuelve los datos de una pista de la demo. |
| `audio_source_provider` | Entrega la fuente reproducible (`liora-asset://test_tone`). |
| `audio_download_provider` | Entrega el mismo fichero como descarga completa. |
| `lyrics_provider` | Devuelve una letra de dos lineas. |

## Permisos

- `network`: ninguno. La demo no sale a internet.
- `storage`: si, para guardar ajustes propios.
- `file`: si, para escribir el fichero descargado en su directorio.

## Nota sobre el motor

El JavaScript de las extensiones de Liora corre en **Rhino**, asi que el
codigo es ES5: `var`, funciones clasicas y nada de `const`, `let` ni clases.
