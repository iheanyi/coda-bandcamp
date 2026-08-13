import type { DailyCategory } from "@/types";

export type DailyOpenArticleRequest = Readonly<{
  articleSection: string;
  category: DailyCategory;
  returnScrollTop: number;
  slug: string;
  sourceArtwork?: HTMLElement;
  sourceTitle?: HTMLElement;
  sourceTrigger?: HTMLElement;
}>;
