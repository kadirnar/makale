export type Language = "en" | "tr";
export interface Unit {
  id: string;
  text: string;
}
export interface Article {
  id: string;
  title: string;
  source: string;
  kind: string;
  warning: string;
  html: string;
  units: Unit[];
  translations: Record<string, string>;
  locked: string[];
  notes: string;
  blog: string;
  report: string;
  createdAt: string;
  updatedAt: string;
  pages?: number;
  translationModel?: string;
  reportModel?: string;
  reportAt?: string;
  pdfReviewed?: boolean;
}
export interface Settings {
  language: Language;
  theme: "light" | "dark" | "system";
  model: string;
  terms: string[];
}
export interface Model {
  id: string;
  name: string;
  context: number;
  promptPrice: string;
  completionPrice: string;
}
export interface Progress {
  id: string;
  stage?: string;
  done?: number;
  total?: number;
  article?: Article;
}
export interface Initial {
  articles: Article[];
  settings: Settings;
  keyConfigured: boolean;
  keySecure: boolean;
  defaultTerms: string[];
}
declare global {
  interface Window {
    makale: {
      call: <T = unknown>(method: string, args?: unknown) => Promise<T>;
      onProgress: (cb: (data: Progress) => void) => () => void;
    };
  }
}
