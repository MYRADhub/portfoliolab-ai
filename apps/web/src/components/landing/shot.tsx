import Image from "next/image";
import { cn } from "@/lib/utils";

export type ShotName = "dashboard" | "news" | "research" | "fit" | "deck";

/**
 * A real screenshot of the app in a quiet window frame, in the theme the visitor is using. Both versions are in the
 * page; CSS shows the one that matches, so switching themes needs no script.
 */
export function Shot({
  name,
  alt,
  priority = false,
  className,
}: {
  name: ShotName;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const common = {
    width: 2880,
    height: 1800,
    sizes: "(min-width: 1280px) 1100px, (min-width: 1024px) 60vw, 100vw",
    priority,
    className: "h-auto w-full",
  } as const;
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
      </div>
      <Image
        src={`/landing/${name}-light.jpg`}
        alt={alt}
        {...common}
        className={cn(common.className, "dark:hidden")}
      />
      <Image
        src={`/landing/${name}-dark.jpg`}
        alt={alt}
        {...common}
        className={cn(common.className, "hidden dark:block")}
      />
    </figure>
  );
}
