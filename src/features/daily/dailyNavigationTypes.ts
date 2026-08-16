import type { DailyCategory } from "@/types";

export type DailyOpenArticleRequest = Readonly<{
  articleSection: string;
  category: DailyCategory;
  returnScrollTop: number;
  sharedIdentityAvailable: boolean;
  slug: string;
  sourceTrigger?: HTMLElement;
}>;
