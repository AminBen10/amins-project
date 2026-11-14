// "18 €", "desde 12 €" or "Consultar" when the shop has no public price.
export function priceLabel(price, from = false) {
  if (price == null) return 'Consultar';
  return `${from ? 'desde ' : ''}${String(price).replace('.', ',')} €`;
}
