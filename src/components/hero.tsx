import { Link } from "@tanstack/react-router";
import { PlayCircle, Sparkles } from "lucide-react";
import heroImg from "@/assets/hero-banner.jpg";
import { Button } from "@/components/ui/button";

interface Props {
  featured?: { slug: string; title: string; overview: string | null; backdrop_url: string | null } | null;
}

export function Hero({ featured }: Props) {
  const bg = featured?.backdrop_url || heroImg;
  return (
    <section className="relative min-h-[78vh] md:min-h-[88vh] w-full overflow-hidden">
      <img
        src={bg}
        alt=""
        width={1920}
        height={1080}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/40 to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-[78vh] md:min-h-[88vh] max-w-7xl items-end md:items-center px-6 pt-24 pb-16">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 text-xs text-foreground/80 mb-5">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            <span>Premium streaming directory</span>
          </div>
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight">
            {featured?.title ?? (
              <>
                Every story.<br />
                <span className="text-gradient-primary">One vault.</span>
              </>
            )}
          </h1>
          <p className="mt-5 text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl">
            {featured?.overview ??
              "Discover thousands of movies, web series, anime, K-Drama and cartoons. Curated, organized, and delivered straight from Telegram."}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {featured ? (
              <Link to="/title/$slug" params={{ slug: featured.slug }}>
                <Button size="lg" className="bg-gradient-primary hover:opacity-90 text-primary-foreground border-0 h-12 px-7 text-base">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Watch now
                </Button>
              </Link>
            ) : (
              <Link to="/browse/$category" params={{ category: "movie" }}>
                <Button size="lg" className="bg-gradient-primary hover:opacity-90 text-primary-foreground border-0 h-12 px-7 text-base">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Start exploring
                </Button>
              </Link>
            )}
            <Link to="/browse/$category" params={{ category: "series" }}>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base bg-surface/40 backdrop-blur border-border">
                Browse series
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
