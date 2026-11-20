import type Decimal from "decimal.js";
import { formatShares } from "./ledger";

export const dash = "\u2014";
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
});
const quoteDateTime = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  timeZone: "America/New_York", timeZoneName: "short",
});
const clockTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
export function money(value: Decimal | null, signed = false) {
  if (value === null) return dash;
  const rounded = value.toDecimalPlaces(2);
  const sign = rounded.lt(0) ? "-" : signed && rounded.gt(0) ? "+" : "";
  return sign + "$" + rounded.abs().toFixed(2).replace(/\B(?=(\d{3})+\.)/g, ",");
}
export function quotePrice(value: Decimal) {
  return "$" + value.toFixed(Math.max(2, value.decimalPlaces())).replace(/\B(?=(\d{3})+\.)/g, ",");
}
export function percent(value: Decimal | null, signed = false) {
  if (value === null) return dash;
  const rounded = value.toDecimalPlaces(2);
  return (signed && rounded.gt(0) ? "+" : "") + (rounded.isZero() ? "0.00" : rounded.toFixed(2)) + "%";
}
export function tone(value: Decimal | null) {
  return value?.gt(0) ? "gain" : value?.lt(0) ? "loss" : "";
}
export const time = (at: number) => dateTime.format(at);
export const quoteTime = (at: number) => quoteDateTime.format(at);
export const clock = (at: number) => clockTime.format(at);
export const abbreviated = (value: number) => "$" + compact.format(value);
export const shares = formatShares;
