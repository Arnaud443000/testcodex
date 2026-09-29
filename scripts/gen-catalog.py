#!/usr/bin/env python3
"""Génère la migration SQL et le catalogue TypeScript à partir de crates/pulse-core/catalog/assets.csv."""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
rows = []
for line in (root / "crates/pulse-core/catalog/assets.csv").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("#"):
        continue
    symbol, name, cls, mult = line.split(";")
    assert cls in {"forex", "index", "crypto", "stock", "commodity", "future", "other"}, line
    assert re.fullmatch(r"[0-9]+(\.[0-9]+)?", mult) and float(mult) > 0, line
    rows.append((symbol, name, cls, mult))
keys = [re.sub(r"[^A-Z0-9.]", "", s.upper()) for s, *_ in rows]
assert len(set(keys)) == len(keys), "doublon de symbole"

q = lambda s: "'" + s.replace("'", "''") + "'"
values = ",\n".join(f"        ({q(s)}, {q(s.upper())}, {q(n)}, {q(c)}, {q(m)})" for s, n, c, m in rows)
sql = f"""-- Généré par scripts/gen-catalog.py depuis catalog/assets.csv : ne pas éditer à la main.
-- v4 : nom complet des actifs + catalogue intégré. Un actif déjà présent (même symbole normalisé)
-- garde SA catégorie et SON multiplicateur ; seul son nom est complété s'il était vide.
ALTER TABLE instruments ADD COLUMN name TEXT NOT NULL DEFAULT '';
INSERT INTO instruments (symbol, symbol_key, name, asset_class, default_multiplier) VALUES
{values}
ON CONFLICT(symbol_key) DO UPDATE SET name = excluded.name WHERE instruments.name = '';
"""
(root / "crates/pulse-core/catalog/v4_asset_catalog.sql").write_text(sql, encoding="utf-8")

ts_rows = "\n".join(f"  [{q(s)}, {q(n)}, {q(c)}, {q(m)}]," for s, n, c, m in rows)
ts = f"""// Généré par scripts/gen-catalog.py depuis crates/pulse-core/catalog/assets.csv : ne pas éditer à la main.
import type {{ AssetClass }} from '../types/trade'

/** [symbole, nom complet, classe, multiplicateur par défaut] — valeurs courantes, à vérifier auprès du courtier. */
export const ASSET_CATALOG: ReadonlyArray<readonly [string, string, AssetClass, string]> = [
{ts_rows}
]
"""
(root / "src/lib/assetCatalog.ts").write_text(ts, encoding="utf-8")
print(len(rows), "actifs")
