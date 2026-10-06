"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[#e76645] text-white hover:bg-[#d85938] shadow-sm",
        outline:
          "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 shadow-xs",
        ghost: "text-neutral-600 hover:bg-neutral-100",
        secondary: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
        destructive: "bg-red-600 text-white hover:bg-red-700",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-xs",
        icon: "size-8",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(variants({ variant, size, className }))} {...props} />
  );
}
