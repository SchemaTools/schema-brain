// Срок годности по версии (docs/spec.md, раздел 5.4; решение 8): при смене текущей
// версии продукта принятые записи с другой версией получают пометку «проверить»,
// показатель не сбрасывается.

export interface ProductVersion {
  product: string;
  version: string;
}

/**
 * Продукт и версия из строки записи: всё до номера версии — продукт.
 * «Revit 2026» → Revit / 2026; «Schema.Tools 1.4» → Schema.Tools / 1.4;
 * «СП 70.13330.2012» → СП 70.13330 / 2012 (у норм версия — год редакции).
 */
export function parseVersion(value: string | null | undefined): ProductVersion | null {
  const text = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const norm = /^((?:ГОСТ\s*Р?|СП|СНиП|СанПиН)\s*[\d.]+?)[.-](\d{4})$/i.exec(text);
  if (norm) return { product: norm[1].toUpperCase(), version: norm[2] };
  const match = /^(.*?)[\s_-]*v?(\d+(?:\.\d+)*[a-z]?)$/i.exec(text);
  if (!match || !match[1].trim()) return null;
  return { product: match[1].trim(), version: match[2] };
}

const sameProduct = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Нужна ли пометка «проверить»: продукт тот же, версия другая. */
export function needsCheck(recordVersion: string | null | undefined, current: ProductVersion): boolean {
  const own = parseVersion(recordVersion);
  return !!own && sameProduct(own.product, current.product) && own.version !== current.version;
}

/** Снимает ли отметка «сработало» пометку: проверено на текущей версии продукта (раздел 5.4, п. 3). */
export function clearsCheck(
  worked: boolean,
  checkedOn: string | null | undefined,
  current: ProductVersion | undefined,
): boolean {
  if (!worked || !current) return false;
  const checked = parseVersion(checkedOn);
  return !!checked && sameProduct(checked.product, current.product) && checked.version === current.version;
}

/** «Проверить: записано для Revit 2026, текущая — Revit 2027.» */
export function checkText(recordVersion: string, current: ProductVersion | undefined): string {
  return current
    ? `Проверить: записано для ${recordVersion}, текущая — ${current.product} ${current.version}.`
    : `Проверить: записано для ${recordVersion}.`;
}
