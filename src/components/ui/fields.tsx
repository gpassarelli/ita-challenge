"use client";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 disabled:bg-neutral-50",
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100",
        className,
      )}
      {...props}
    />
  );
}
export function Select({
  className,
  children,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-neutral-400",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
export function Label({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium text-neutral-600"
    >
      {children}
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "orange" | "red" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium",
        {
          "bg-neutral-100 text-neutral-600": tone === "neutral",
          "bg-emerald-50 text-emerald-700": tone === "green",
          "bg-orange-50 text-orange-700": tone === "orange",
          "bg-red-50 text-red-700": tone === "red",
          "bg-blue-50 text-blue-700": tone === "blue",
        },
      )}
    >
      {children}
    </span>
  );
}
export function ErrorNote({ message }: { message: string }) {
  return message ? (
    <div
      role="alert"
      className="my-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700"
    >
      {message}
    </div>
  ) : null;
}
