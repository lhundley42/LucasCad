"""Bounded, kernel-tested fillet limits and target-only interactive previews."""
from collections import OrderedDict
import json
import math
from threading import RLock
import time

import cadquery as cq


def geometry_key(document):
    ignored = {"name", "bodyName", "visible", "bodyVisible", "dimensionOffsets", "hiddenDimensionKeys", "sourceLabel", "metadata", "meshQuality"}
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k not in ignored}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value
    return json.dumps(clean(document), sort_keys=True, separators=(",", ":"))


class FilletWorkbench:
    def __init__(self, build, apply, mesh):
        self.build, self.apply, self.mesh = build, apply, mesh
        self.documents, self.limits = OrderedDict(), OrderedDict()
        self.lock = RLock()

    def evaluate(self, payload):
        with self.lock:
            document = payload.get("document", {})
            key = geometry_key(document)
            if key not in self.documents:
                self.documents[key] = self.build(document)[0]
                if len(self.documents) > 3:
                    self.documents.popitem(last=False)
            self.documents.move_to_end(key)
            body_id = payload.get("targetBodyId")
            body = self.documents[key].get(body_id)
            if body is None:
                raise ValueError("Select an existing solid body for the fillet.")
            raw_indices = payload.get("edgeIndices", [])
            if not raw_indices or any(not isinstance(i, int) or isinstance(i, bool) for i in raw_indices):
                raise ValueError("Select one or more solid edges to fillet.")
            indices = sorted(set(raw_indices))
            edges = body.Edges()
            if indices[0] < 1 or indices[-1] > len(edges):
                raise ValueError("An edge reference changed. Reselect the fillet edges.")
            request_radius = float(payload.get("radius", 2))
            if not math.isfinite(request_radius):
                raise ValueError("Fillet radius must be a finite number.")
            selection = (key, body_id, tuple(indices))
            tested = {}
            def attempt(radius):
                radius = round(radius, 9)
                if radius not in tested:
                    try:
                        result = self.apply(body, {"type": "fillet", "edgeIndices": indices, "radius": radius})
                        tested[radius] = result if result.isValid() and len(result.Solids()) == 1 and result.Volume() > 1e-9 else None
                    except Exception:
                        tested[radius] = None
                return tested[radius]
            if selection not in self.limits:
                bounds = body.BoundingBox()
                ceiling = max(bounds.DiagonalLength, .01)
                minimum = max(.001, ceiling * 1e-6)
                seed = min(max(request_radius, minimum), ceiling / 4)
                started = time.monotonic()
                while attempt(seed) is None and seed > minimum:
                    seed = max(minimum, seed / 2)
                if attempt(seed) is None:
                    return {"available": False, "message": "No usable radius found for this edge set. Remove a conflicting edge or choose a sharp boundary instead of a seam/tangent edge.", "maxRadius": 0, "minimumRadius": minimum}
                low = seed
                high = min(ceiling, seed * 2)
                while attempt(high) is not None and high < ceiling and time.monotonic() - started < 5:
                    low = high
                    high = min(ceiling, high * 2)
                failed_upper = attempt(high) is None
                if not failed_upper:
                    low = high
                for _ in range(11):
                    if not failed_upper or high - low <= max(.001, low * .002) or time.monotonic() - started > 7:
                        break
                    mid = (low + high) / 2
                    if attempt(mid) is not None:
                        low = mid
                    else:
                        high = mid
                # Use the verified lower bound, never the untested midpoint or failing limit.
                resolved = failed_upper and high - low <= max(.001, low * .002)
                self.limits[selection] = {"maxRadius": low, "minimumRadius": minimum, "limitResolved": resolved, "precision": high - low if failed_upper else None, "seed": seed}
                if len(self.limits) > 24:
                    self.limits.popitem(last=False)
            limits = self.limits[selection]
            self.limits.move_to_end(selection)
            radius = max(limits["minimumRadius"], min(request_radius, limits["maxRadius"]))
            shape = attempt(radius)
            # Some topology transitions have holes in their valid radius range.
            # A maximum alone is not sufficient validation for every interior value.
            if shape is None:
                radius = min(radius, limits["seed"])
                shape = attempt(radius)
                while shape is None and radius > limits["minimumRadius"]:
                    radius = max(limits["minimumRadius"], radius / 2)
                    shape = attempt(radius)
            if shape is None:
                return {"available": False, "message": "This radius is not valid for the selected edges. The last valid preview is unchanged.", **limits}
            edge = edges[indices[0] - 1]
            anchor = edge.positionAt(.5)
            direction = cq.Vector(0, 0, 0)
            for face in body.Faces():
                if any(edge.isSame(boundary) for boundary in face.Edges()):
                    try:
                        direction = direction.add(face.normalAt(anchor))
                    except Exception:
                        pass
            if direction.Length < 1e-6:
                tangent = edge.tangentAt(.5)
                direction = tangent.cross(cq.Vector(0, 0, 1) if abs(tangent.z) < .9 else cq.Vector(1, 0, 0))
            direction = direction.normalized()
            return {"available": True, **{k: v for k, v in limits.items() if k != "seed"}, "radius": radius,
                    "adjusted": abs(request_radius - radius) > 1e-8, "targetBodyId": body_id,
                    "anchor": list(anchor.toTuple()), "direction": list(direction.toTuple()),
                    "previewFaces": self.mesh(shape), "message": "Radius adjusted to a tested value." if abs(request_radius - radius) > 1e-8 else "Valid fillet preview"}
