export function simplify(input: string): string {
  if (!input) return ""

  const decoded = decodeURIComponent(input)
  const [base, fragment] = decoded.split("#", 2)

  const simplifiedBase = base
    .replace(/[^a-zA-Z0-9]/g, "-") // normalize hive name only
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()

  return fragment ? `${simplifiedBase}#${fragment}` : simplifiedBase
}
