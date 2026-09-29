/**
 * Exact decimal produced by pulse-core, as a plain-notation string ("1234.50",
 * "-0.0042"). Money, prices and sizes always travel as strings: never turn one
 * into a JS number to compute with it (see CLAUDE.md, "Argent et prix").
 */
export type Decimal = string
