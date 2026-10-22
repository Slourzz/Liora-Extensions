# Como colaborar

## Anadir una extension

1. Crea una carpeta en `extensions/` con el nombre de la extension.
2. Escribe `manifest.json` y `src/index.js`.
3. Comprueba que el manifiesto cumple `schemas/extension-manifest.schema.json`.
4. Construye el paquete y actualiza el registro:
   ```bash
   python scripts/build_packages.py mi-extension
   ```
5. Abre una pull request.

## Reglas

- El manifiesto declara **solo** los tipos de proveedor que la extension
  implementa de verdad.
- Los permisos se piden justificados: si no hay red, `network` va vacio; si no
  guarda nada, `storage` es `false`.
- No se incluyen credenciales, tokens, claves ni sesiones de usuario en el
  codigo ni en los paquetes.
- Nada de claves privadas de servicios musicales, ni metodos para eludir DRM
  ni para extraer contenido protegido sin autorizacion. Una extension trabaja
  con las credenciales que el usuario aporta para su propia cuenta.
- El JavaScript es ES5: el motor de Liora es Rhino y no entiende `const`,
  `let`,funciones flecha ni clases.
- Los paquetes se construyen con el script: no se suben a mano.

## Pruebas

Las pruebas de JavaScript se pueden ejecutar con node:

```bash
node extensions/demo-audio/tests/demo-audio.test.js
```
