export const LOCATION_OPTIONS = [
  "Ahmedabad",
  "Bangalore",
  "Chennai",
  "Delhi",
  "Ernakulam - Kochi",
  "Hyderabad",
  "Kolkata",
  "Mumbai",
  "Pune",
  "UAE - Dubai",
  "USA",
  "Remote",
  "Inhouse",
] as const;

export type LocationOption = (typeof LOCATION_OPTIONS)[number];
