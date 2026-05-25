import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const variantClasses: Record<string, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  outline: "border-border text-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "secondary" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant] ?? variantClasses.default,
        className,
      )}
      {...props}
    />
  );
}
