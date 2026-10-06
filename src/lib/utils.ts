import { isMissing } from "./domain/values";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const brNumber = (n: number, decimals = 0) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: decimals }).format(n);
export const brMoney = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
export function display(value: unknown): string {
  if (isMissing(value)) return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return brNumber(value, 2);
  if (typeof value === "object") return JSON.stringify(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
    return String(value).split("-").reverse().join("/");
  return String(value);
}
export function dateBR(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
