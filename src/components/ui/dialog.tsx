"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  drawer = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 bg-white shadow-2xl focus:outline-none flex flex-col",
            drawer
              ? "inset-y-0 right-0 w-full sm:w-[720px]"
              : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl w-[calc(100%-32px)] max-h-[90vh]",
            !drawer && (wide ? "max-w-5xl" : "max-w-xl"),
          )}
        >
          <div className="border-b border-neutral-100 px-6 py-5 pr-12">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              className={cn(
                "mt-1 text-sm text-neutral-500",
                !description && "sr-only",
              )}
            >
              {description ?? "Consulte e edite as informações."}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X size={18} />
          </DialogPrimitive.Close>
          <div className="overflow-y-auto p-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
