export type UnitSystem = "metric" | "imperial";

export const unitSuffix = (units: UnitSystem) => units === "imperial" ? "in" : "mm";
export const fromMillimeters = (value: number, units: UnitSystem) => units === "imperial" ? value / 25.4 : value;
export const toMillimeters = (value: number, units: UnitSystem) => units === "imperial" ? value * 25.4 : value;

export function formatLength(valueMm: number, units: UnitSystem) {
  const value = fromMillimeters(valueMm, units);
  const precision = units === "imperial" ? (Math.abs(value) < 10 ? 3 : 2) : (Math.abs(value) < 10 ? 2 : 1);
  return `${value.toFixed(precision).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "")} ${unitSuffix(units)}`;
}
