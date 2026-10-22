#!/usr/bin/env python3
"""Construye los paquetes de las extensiones y refresca el registro.

Los paquetes son reproducibles: el mismo código produce siempre el mismo
fichero y el mismo SHA-256, para que el registro y el paquete no se
desincronicen nunca.

Uso:
    python scripts/build_packages.py                 # construye y actualiza el registro
    python scripts/build_packages.py --check         # solo comprueba, no escribe
    python scripts/build_packages.py demo-audio      # solo una extension
"""

import argparse
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "extensions"
PACKAGES = ROOT / "packages"
REGISTRY = ROOT / "registry.json"

#: La extension se empaqueta con estos ficheros, en este orden.
MANIFEST = "manifest.json"


def package(source: Path) -> bytes:
    """Empaqueta una extension en un ZIP reproducible."""
    manifest = json.loads((source / MANIFEST).read_text(encoding="utf-8"))
    entrypoint = manifest.get("entrypoint", "src/index.js")
    if entrypoint.startswith("/") or ".." in entrypoint:
        raise ValueError(f"Punto de entrada no permitido: {entrypoint}")

    names = [MANIFEST, entrypoint]
    icon = manifest.get("icon")
    if icon:
        if Path(icon).name != icon or icon in (".", ".."):
            raise ValueError(f"El icono debe ser un fichero dentro de la extension: {icon}")
        if icon not in names:
            names.append(icon)

    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name in names:
            path = source / name
            if not path.exists():
                raise FileNotFoundError(f"Falta {name} en {source.name}")
            info = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(
                info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9
            )
    return buffer.getvalue()


def entry_for(manifest: dict, digest: str, name: str, updated: str) -> dict:
    return {
        "id": manifest["id"],
        "name": manifest["id"],
        "display_name": manifest.get("displayName", manifest["id"]),
        "version": manifest["version"],
        "description": manifest.get("description", ""),
        "download_url": f"https://raw.githubusercontent.com/Slourzz/Liora-Extensions/main/packages/{name}.lioraext",
        "sha256": digest,
        "category": "demo",
        "tags": ["demo", "audio", "test"],
        "downloads": 0,
        "updated_at": updated,
        "min_app_version": manifest.get("minLioraVersion", "1.0"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("providers", nargs="*", help="Extensiones a construir (por defecto, todas)")
    parser.add_argument("--check", action="store_true", help="Comprueba sin escribir nada")
    args = parser.parse_args()

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in registry["extensions"]}
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    names = args.providers or sorted(
        path.name for path in SOURCES.iterdir() if path.is_dir()
    )
    changed = False
    stale = []

    for name in names:
        source = SOURCES / name
        manifest = json.loads((source / MANIFEST).read_text(encoding="utf-8"))
        if manifest["id"] != name:
            print(f"El id del manifiesto ({manifest['id']}) no coincide con la carpeta ({name})")
            return 1

        payload = package(source)
        digest = hashlib.sha256(payload).hexdigest()
        package_name = f"{name}.lioraext"
        target = PACKAGES / package_name

        entry = entry_for(manifest, digest, name, updated)
        previous = by_id.get(manifest["id"])
        if previous is None:
            print(f"Nueva extension: {manifest['id']}")
            registry["extensions"].append(entry)
            changed = True
        elif previous["sha256"] != digest or previous["version"] != manifest["version"]:
            print(f"Actualizada: {manifest['id']} v{manifest['version']}")
            previous.update(entry)
            changed = True
        else:
            print(f"Sin cambios: {manifest['id']} v{manifest['version']}")

        if args.check:
            if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                stale.append(package_name)
        else:
            PACKAGES.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            print(f"  {package_name}  {len(payload)} bytes  sha256={digest}")

    registry["version"] = 1
    registry["updated_at"] = updated

    if stale:
        print("Paquetes que no coinciden con el registro: " + ", ".join(stale))
        return 1

    if not args.check:
        REGISTRY.write_text(
            json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"Registro actualizado ({len(registry['extensions'])} extensiones)")
    elif changed:
        print("El registro esta desactualizado")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
