// Responsible person(s) per location. Keyed by the exact location string used in
// LOCATION_OPTIONS / assets.location (note Kochi is stored as "Ernakulam - Kochi").
export const LOCATION_RESPONSIBLES: Record<string, string[]> = {
  "Bangalore":         ["Sheshadri", "Bharat"],
  "Ahmedabad":         ["Chirag Parmar"],
  "Chennai":           ["Priyanga"],
  "Ernakulam - Kochi": ["Vijith"],
  "Hyderabad":         ["John", "Manik"],
  "Kolkata":           ["Sweta Paul"],
  "Delhi":             ["Pramod"],
  "Mumbai":            ["Sayeed"],
  "Pune":              ["Akshay"],
};

export function responsibleFor(location: string): string {
  const people = LOCATION_RESPONSIBLES[location];
  return people && people.length ? people.join(", ") : "—";
}
