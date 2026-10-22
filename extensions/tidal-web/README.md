# tidal-web

Proveedor de **TIDAL** para Liora, hecho con la **API oficial** de TIDAL
(<https://developer.tidal.com/documentation/api-sdk/>).

## Que hace

- **Busca** canciones por título, artista o álbum.
- **Trae los datos** de una pista: título, artistas, álbum, portada, ISRC y
  duración.
- **Consulta la disponibilidad**: si la pista se puede reproducir en el país y
  la cuenta del usuario, y con qué calidad.
- **Entrega una fuente reproducible** cuando el contenido viene sin cifrar.

## Que NO hace, y por que

- **No descarga.** El catálogo de TIDAL va cifrado con Widevine (DRM). La
  extensión no descifra nada, no elude el DRM y no declara capacidad de
  descarga: cuando la pista está protegida, lo dice con un error claro en vez
  de inventar una URL.
- **No guarda tus credenciales.** Van en los ajustes de la extensión, dentro de
  Liora; la extensión solo las recibe al inicializarse.

## Puesta en marcha

1. Registra una app en <https://developer.tidal.com> y apúntate el **client
   id** y el **client secret**.
2. En Liora: Ajustes → Extensiones → *Configurar* (el icono de los sliders) y
   pon las dos credenciales. El país se pone en `US` por defecto.
3. Listo: ya aparece en la búsqueda de Liora.

## Credenciales

La API oficial exige credenciales **propias**: se registran en el portal de
desarrolladores de TIDAL. Esta extensión no lleva ninguna clave dentro, ni
usa las del reproductor web.

## Dominios que necesita

- `api.tidal.com` — catálogo, busqueda y datos de reproducción.
- `auth.tidal.com` — el token de acceso.

Los permisos van declarados en el manifiesto y Liora los comprueba en cada
petición y en cada salto de una redirección.

## Licencia y atribución

El código de esta extensión es MIT (la de Liora). **El catálogo de TIDAL no es
libre**: cada ficha tiene su propia licencia, y la API no concede derechos de
redistribución. Esta extensión da acceso al catálogo de la cuenta del usuario,
como haría la propia app de TIDAL.

## Pruebas

```bash
node extensions/tidal-web/tests/tidal-web.test.js
```
