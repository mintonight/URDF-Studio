#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math

from isaaclab.app import AppLauncher


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open USD stages in Isaac Sim and summarize rigid-body mass properties and collisions.",
    )
    parser.add_argument("paths", nargs="+", help="USD stage paths to inspect.")
    parser.add_argument("--output", required=True, help="Where to write the JSON summary.")
    AppLauncher.add_app_launcher_args(parser)
    return parser.parse_args()


def _round_scalar(value: object) -> float | None:
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(numeric_value):
        return None

    return round(numeric_value, 8)


def _round_vec3(value: object) -> list[float] | None:
    if value is None:
        return None

    try:
        values = list(value)
    except TypeError:
        return None

    if len(values) < 3:
        return None

    result = [_round_scalar(entry) for entry in values[:3]]
    if any(entry is None for entry in result):
        return None

    return [float(entry) for entry in result]


def _round_quat_wxyz(value: object) -> list[float] | None:
    if value is None:
        return None

    get_real = getattr(value, "GetReal", None)
    get_imaginary = getattr(value, "GetImaginary", None)
    if callable(get_real) and callable(get_imaginary):
        real = _round_scalar(get_real())
        imag = _round_vec3(get_imaginary())
        if real is None or imag is None:
            return None
        return [real, imag[0], imag[1], imag[2]]

    try:
        values = list(value)
    except TypeError:
        return None

    if len(values) < 4:
        return None

    result = [_round_scalar(entry) for entry in values[:4]]
    if any(entry is None for entry in result):
        return None

    return [float(entry) for entry in result]


def _normalized_default_path(stage) -> str | None:
    default_prim = stage.GetDefaultPrim()
    if not default_prim or not default_prim.IsValid():
        return None
    return default_prim.GetPath().pathString


def _relative_path(path: str, default_path: str | None) -> str:
    if not default_path:
        return path
    if path == default_path:
        return "/"
    if path.startswith(default_path + "/"):
        return path[len(default_path) :]
    return path


def _owner_rigid_body_path(prim) -> str | None:
    from pxr import UsdPhysics

    current = prim
    while current and current.IsValid():
        if current.HasAPI(UsdPhysics.RigidBodyAPI):
            return current.GetPath().pathString
        current = current.GetParent()
    return None


def summarize_stage(path: str) -> dict[str, object]:
    from pxr import Usd, UsdGeom, UsdPhysics

    stage = Usd.Stage.Open(path)
    if stage is None:
        return {
            "path": path,
            "open_ok": False,
        }

    default_path = _normalized_default_path(stage)
    rigid_bodies: dict[str, dict[str, object]] = {}

    for prim in stage.Traverse():
        if not prim.HasAPI(UsdPhysics.RigidBodyAPI):
            continue

        full_path = prim.GetPath().pathString
        relative_body_path = _relative_path(full_path, default_path)
        mass_api = UsdPhysics.MassAPI(prim)

        rigid_bodies[full_path] = {
            "path": relative_body_path,
            "fullPath": full_path,
            "type": prim.GetTypeName(),
            "mass": _round_scalar(mass_api.GetMassAttr().Get()),
            "centerOfMass": _round_vec3(mass_api.GetCenterOfMassAttr().Get()),
            "diagonalInertia": _round_vec3(mass_api.GetDiagonalInertiaAttr().Get()),
            "principalAxes": _round_quat_wxyz(mass_api.GetPrincipalAxesAttr().Get()),
            "collisions": [],
        }

    collision_without_body: list[dict[str, object]] = []

    for prim in stage.Traverse():
        if not prim.HasAPI(UsdPhysics.CollisionAPI):
            continue

        full_path = prim.GetPath().pathString
        owner_full_path = _owner_rigid_body_path(prim)
        imageable = UsdGeom.Imageable(prim)
        purpose = imageable.ComputePurpose() if imageable else None
        visibility = imageable.ComputeVisibility() if imageable else None
        collision_entry = {
            "path": _relative_path(full_path, default_path),
            "type": prim.GetTypeName(),
            "purpose": str(purpose) if purpose else None,
            "visibility": str(visibility) if visibility else None,
        }

        mesh_collision_api = UsdPhysics.MeshCollisionAPI(prim)
        approximation_attr = mesh_collision_api.GetApproximationAttr()
        approximation = approximation_attr.Get() if approximation_attr else None
        if approximation:
            collision_entry["approximation"] = str(approximation)

        if not owner_full_path or owner_full_path not in rigid_bodies:
            collision_without_body.append(collision_entry)
            continue

        rigid_bodies[owner_full_path]["collisions"].append(collision_entry)

    summarized_bodies: dict[str, dict[str, object]] = {}
    total_collision_count = 0

    for body in rigid_bodies.values():
        collisions = list(body["collisions"])
        collisions.sort(key=lambda entry: str(entry.get("path") or ""))
        total_collision_count += len(collisions)

        collision_type_counts: dict[str, int] = {}
        mesh_collision_approximations: list[str] = []
        for entry in collisions:
            entry_type = str(entry.get("type") or "")
            collision_type_counts[entry_type] = collision_type_counts.get(entry_type, 0) + 1
            approximation = entry.get("approximation")
            if approximation:
                mesh_collision_approximations.append(str(approximation))

        mesh_collision_approximations.sort()

        summarized_bodies[str(body["path"])] = {
            "fullPath": body["fullPath"],
            "type": body["type"],
            "mass": body["mass"],
            "centerOfMass": body["centerOfMass"],
            "diagonalInertia": body["diagonalInertia"],
            "principalAxes": body["principalAxes"],
            "collisionCount": len(collisions),
            "collisionTypes": collision_type_counts,
            "meshCollisionApproximations": mesh_collision_approximations,
        }

    return {
        "path": path,
        "open_ok": True,
        "defaultPrimPath": default_path,
        "rigidBodyCount": len(summarized_bodies),
        "collisionCount": total_collision_count,
        "rigidBodies": summarized_bodies,
        "collisionWithoutBodyCount": len(collision_without_body),
        "collisionWithoutBodySample": collision_without_body[:16],
    }


def main() -> None:
    args = parse_args()
    app_launcher = AppLauncher(args)
    simulation_app = app_launcher.app

    try:
        payload = {path: summarize_stage(path) for path in args.paths}
        with open(args.output, "w", encoding="utf-8") as output_file:
            json.dump(payload, output_file, indent=2)
    finally:
        simulation_app.close()


if __name__ == "__main__":
    main()
