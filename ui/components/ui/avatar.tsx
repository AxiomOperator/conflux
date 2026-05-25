import Image from "next/image";

import { cn } from "@/lib/utils";

export function Avatar({
  alt,
  className,
  fallback,
  src,
}: {
  alt: string;
  className?: string;
  fallback: string;
  src?: string | null;
}) {
  return (
    <div
      className={cn(
        "relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary",
        className,
      )}
    >
      {src ? (
        <Image
          alt={alt}
          className="object-cover"
          fill
          sizes="40px"
          src={src}
          unoptimized
        />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
}
