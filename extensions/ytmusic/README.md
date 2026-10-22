# ytmusic

Proveedor de **YouTube Music** para Liora: busca canciones y entrega el
flujo de audio para reproducirlas.

## Como funciona

YouTube Music se usa desde el reproductor web y desde la app oficial a través
de su API interna (*Innertube*). Esta extensión la usa igual que lo hacen los
reproductores de terceros de código abierto (NewPipe, yt-dlp y similares):

1. **Búsqueda**: `youtubei/v1/search` con el cliente `WEB_REMIX`, el mismo
   que usa el reproductor web.
2. **Resolución**: `youtubei/v1/player` con el cliente `ANDROID_VR` en la
   versión **1.62.27**, que devuelve la URL del audio ya firmada y sin los
   trámites de los clientes más modernos. Esos clientes más nuevos exigen un
   *proof of origin* (un reto anti-bot de YouTube) que solo se resuelve con la
   atención del sitio: aquí no se resuelve ningún reto ni se falsea ninguna
   identidad, se usa un cliente público tal cual.

## Qué entrega y qué no

- ✅ **Busca** canciones (título, artista, portada, duración).
- ✅ **Reproduce**: entrega el flujo de audio (AAC-LC en m4a) a Media3.
- ❌ **No descarga.** YouTube no autoriza guardar su catálogo, así que la
  extensión no declara esa capacidad: da acceso en streaming al mismo
  contenido que ve el usuario en su propia cuenta, sin guardarlo ni
  redistribuirlo.

## Aviso

El contenido pertenece a sus titulares y YouTube Music no autoriza su
descarga ni su redistribución. Esta extensión da acceso en streaming al
contenido de la cuenta del usuario, como lo haría la app oficial. Úsala
respetando las condiciones de uso del servicio y la legislación aplicable.

## Dominios que necesita

- `music.youtube.com` — búsqueda.
- `youtubei.googleapis.com` — resolución de la pista.
- `*.googlevideo.com` — el propio flujo de audio.

## Pruebas

```bash
node extensions/ytmusic/tests/ytmusic.test.js
```
