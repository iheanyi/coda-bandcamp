import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type GenreRailEdges = Readonly<{
  end: boolean;
  start: boolean;
}>;

export type GenreRailController = Readonly<{
  edges: GenreRailEdges;
  onScroll: (rail: HTMLElement) => void;
  ref: RefObject<HTMLElement | null>;
  scroll: (direction: -1 | 1) => void;
}>;

export type GenreRailControllerOptions = Readonly<{
  genre: string;
  genres: readonly string[];
}>;

const INITIAL_EDGES: GenreRailEdges = Object.freeze({
  end: false,
  start: false,
});

function reducedMotionPreferred(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/** Owns the scroll affordance lifecycle for the bounded genre chip rail. */
export function useGenreRailController({
  genre,
  genres,
}: GenreRailControllerOptions): GenreRailController {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState<GenreRailEdges>(INITIAL_EDGES);

  const updateEdges = useCallback((rail: HTMLElement) => {
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const nextEdges = {
      start: rail.scrollLeft > 1,
      end: rail.scrollLeft < maxScrollLeft - 1,
    };
    setEdges((current) =>
      current.start === nextEdges.start && current.end === nextEdges.end
        ? current
        : nextEdges,
    );
  }, []);

  const scroll = useCallback(
    (direction: -1 | 1) => {
      const rail = ref.current;
      if (!rail) return;
      const left =
        rail.scrollLeft +
        direction * Math.max(160, Math.round(rail.clientWidth * 0.7));
      rail.scrollTo({
        behavior: reducedMotionPreferred() ? "auto" : "smooth",
        left,
      });
    },
    [],
  );

  useLayoutEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    const syncEdges = () => updateEdges(rail);
    syncEdges();
    window.addEventListener("resize", syncEdges);
    return () => window.removeEventListener("resize", syncEdges);
  }, [genres, updateEdges]);

  useEffect(() => {
    if (genre !== "All") return;
    const rail = ref.current;
    if (!rail) return;
    rail.scrollTo({ behavior: "auto", left: 0 });
    updateEdges(rail);
  }, [genre, updateEdges]);

  return {
    edges,
    onScroll: updateEdges,
    ref,
    scroll,
  };
}
