export const ASSET_STORAGE_OPTIONS = [
  { value: "not_specified", label: "Not specified" },
  { value: "64_gb", label: "64 GB" },
  { value: "128_gb", label: "128 GB" },
  { value: "256_gb", label: "256 GB" },
  { value: "512_gb", label: "512 GB" },
  { value: "1_tb", label: "1 TB" },
  { value: "2_tb", label: "2 TB" },
] as const;

export const ASSET_RAM_OPTIONS = [
  { value: "not_specified", label: "Not specified" },
  { value: "2_gb", label: "2 GB" },
  { value: "4_gb", label: "4 GB" },
  { value: "6_gb", label: "6 GB" },
  { value: "8_gb", label: "8 GB" },
  { value: "12_gb", label: "12 GB" },
  { value: "16_gb", label: "16 GB" },
  { value: "18_gb", label: "18 GB" },
  { value: "24_gb", label: "24 GB" },
  { value: "32_gb", label: "32 GB" },
  { value: "36_gb", label: "36 GB" },
  { value: "64_gb", label: "64 GB" },
  { value: "128_gb", label: "128 GB" },
] as const;

export const ASSET_OS_OPTIONS = [
  { value: "not_specified", label: "Not specified" },
  { value: "Windows", label: "Windows" },
  { value: "macOS", label: "macOS" },
  { value: "Ubuntu", label: "Ubuntu" },
  { value: "Linux", label: "Linux" },
  { value: "Chrome OS", label: "Chrome OS" },
] as const;

export const MOBILE_OS_OPTIONS = [
  { value: "iOS", label: "iOS" },
  { value: "Android", label: "Android" },
] as const;

type Option = { value: string; label: string };

/**
 * New selections use canonical values, while an existing legacy value is
 * appended unchanged so editing never blanks or destructively rewrites it.
 */
export function optionsWithLegacyValue(options: readonly Option[], currentValue?: string) {
  if (!currentValue || options.some(option => option.value === currentValue || option.label === currentValue)) {
    return options;
  }
  return [...options, { value: currentValue, label: currentValue }];
}

export function optionValueForCurrent(options: readonly Option[], currentValue?: string) {
  if (!currentValue) return "__none__";
  return options.find(option => option.value === currentValue || option.label === currentValue)?.value ?? currentValue;
}

export function optionsForField(fieldKey: string, currentValue?: string) {
  if (fieldKey === "storage") return optionsWithLegacyValue(ASSET_STORAGE_OPTIONS, currentValue);
  if (fieldKey === "ram") return optionsWithLegacyValue(ASSET_RAM_OPTIONS, currentValue);
  if (fieldKey === "operatingSystem") return optionsWithLegacyValue(ASSET_OS_OPTIONS, currentValue);
  return null;
}