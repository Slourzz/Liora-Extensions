# Seguridad

## Que es la integridad y que es la confianza

El **SHA-256** que publica el registro demuestra que el fichero descargado es
exactamente el que el registro anuncia. No demuestra que el contenido sea
seguro ni que quien publica sea de fiar: el hash lo publica la misma persona
que el paquete.

Por eso el modelo de confianza esta repartido:

- **El usuario decide** que repositorios anade y que extensiones instala. La
  pantalla de instalacion muestra los permisos antes de instalar.
- **Los permisos son explicitos** y se aplican en la capa nativa de Liora. Una
  extension solo puede hablar con los dominios que declara, solo puede
  escribir en su propio directorio y solo puede usar el almacenamiento si lo
  ha pedido.
- **El codigo va en un motor aislado**, sin acceso a las clases de Java ni al
  contexto de Android, con un limite de tiempo por llamada.

## Como se distribuye un repositorio

- Todos los paquetes se descargan por **https**. No se admite http.
- Cada paquete tiene un limite de tamano (32 MiB comprimido, 64 MiB
  descomprimido) y se comprueba su hash antes de instalar nada.
- La extraccion rechaza rutas absolutas, `..`, barras invertidas y cualquier
  cosa que se salga del directorio de la extension.

## Si encuentras un problema

Abre un issue describiendo el problema, la extension afectada y como se
reproduce. No publiques detalles de explotacion en un repositorio publico: se
gestionan en privado antes de publicarlos.
