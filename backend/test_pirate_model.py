"""Rebuild the saved demonstration through the same kernel used by LucasCad."""
import json
from pathlib import Path

from server import build_document


def test_black_lantern_native_history_rebuilds_and_contains_real_details():
    path = Path(__file__).resolve().parents[1] / "examples" / "Black-Lantern.lucascad.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert {f["type"] for f in doc["features"]} == {"loft", "extrude", "revolve", "sweep"}
    for records in [doc["features"], doc["sketches"], doc["referenceGeometry"]]:
        assert len({r["id"] for r in records}) == len(records)
    bodies = build_document(doc)[0]
    assert len(bodies) == 186
    assert all(b.isValid() and len(b.Solids()) == 1 and b.Volume() > 0 for b in bodies.values())
    assert len([key for key in bodies if key.startswith("sail-")]) == 6
    assert len([key for key in bodies if key.startswith("cannon-")]) == 10
    assert len([key for key in bodies if key.startswith("ratline-")]) == 36
    assert len([key for key in bodies if key.startswith("wale-")]) == 4
    assert bodies["rudder"].Center().x < -130  # Stern, not bow.
    assert bodies["bowsprit"].Center().x > 150
    assert bodies["mast-Main"].BoundingBox().zmax > bodies["mast-Fore"].BoundingBox().zmax
    assert any(f.get("combine") == "cut" and f.get("targetBodyId") == "hull" for f in doc["features"])
    assert any(f["name"] == "Deck plank seams" and f.get("combine") == "cut" for f in doc["features"])
