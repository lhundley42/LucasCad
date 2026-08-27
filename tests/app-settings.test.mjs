import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_GLOBAL_SETTINGS, normalizeGlobalSettings, parseGlobalSettings } from "../app/components/appSettings.ts";
import { formatLength, fromMillimeters, toMillimeters } from "../app/components/units.ts";

test("dimension labels default to half size", () => {
  assert.equal(DEFAULT_GLOBAL_SETTINGS.sketchDimensionTextScale, 0.5);
  assert.equal(parseGlobalSettings(null).sketchDimensionTextScale, 0.5);
  assert.equal(DEFAULT_GLOBAL_SETTINGS.sketchNodeDiameterPx, 4);
  assert.equal(DEFAULT_GLOBAL_SETTINGS.sketchHighlightWidthPx, 1.2);
  assert.equal(DEFAULT_GLOBAL_SETTINGS.sketchGridSizeMm, 8);
  assert.equal(DEFAULT_GLOBAL_SETTINGS.unitSystem, "metric");
});

test("dimension label settings are normalized to the supported range", () => {
  assert.equal(normalizeGlobalSettings({ sketchDimensionTextScale: 0.1 }).sketchDimensionTextScale, 0.25);
  assert.equal(normalizeGlobalSettings({ sketchDimensionTextScale: 2 }).sketchDimensionTextScale, 1.5);
  assert.equal(parseGlobalSettings("not-json").sketchDimensionTextScale, 0.5);
  assert.equal(normalizeGlobalSettings({ sketchHighlightWidthPx: 0.1 }).sketchHighlightWidthPx, 0.5);
  assert.equal(normalizeGlobalSettings({ sketchHighlightWidthPx: 8 }).sketchHighlightWidthPx, 4);
});

test("metric and imperial display preserve millimeter model values", () => {
  assert.equal(fromMillimeters(25.4, "imperial"), 1);
  assert.equal(toMillimeters(1, "imperial"), 25.4);
  assert.equal(formatLength(25.4, "imperial"), "1 in");
  assert.equal(formatLength(25.4, "metric"), "25.4 mm");
  assert.equal(formatLength(3.0479999999999996, "metric"), "3.05 mm");
  assert.equal(formatLength(3.0479999999999996, "imperial"), "0.12 in");
});
