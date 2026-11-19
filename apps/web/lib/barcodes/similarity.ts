export type BarcodeOwner = {
  productId: string
  productName: string
  code: string
}

const CONFUSABLES: Record<string, string> = {
  O: '0',
  Q: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
  T: '7',
}

export function normalizeBarcode(value: string): string {
  return value.trim().toUpperCase()
}

export function barcodeConfusableKey(value: string): string {
  return normalizeBarcode(value).replace(/[OQILSBZGT]/g, (character) => CONFUSABLES[character] ?? character)
}

/** Finds a different barcode that could be mistaken for this value when read or typed. */
export function findConfusableBarcode(
  code: string,
  owners: BarcodeOwner[],
  excludedProductId?: string
): BarcodeOwner | undefined {
  const normalized = normalizeBarcode(code)
  if (!normalized) return undefined
  const confusableKey = barcodeConfusableKey(code)
  return owners.find((owner) =>
    owner.productId !== excludedProductId &&
    normalizeBarcode(owner.code) !== normalized &&
    barcodeConfusableKey(owner.code) === confusableKey
  )
}
