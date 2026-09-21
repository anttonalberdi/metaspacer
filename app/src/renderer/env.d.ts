/// <reference types="vite/client" />

interface OpenedBundle {
  path: string;
  content: string;
}

interface OpenedInput {
  name: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

interface Window {
  metaspacer?: {
    platform: string;
    openBundle: () => Promise<OpenedBundle | null>;
    openBuilderInput: (kind: string) => Promise<OpenedInput | null>;
    preflightSpec: (payload: unknown) => Promise<unknown>;
    saveSpec: (content: string) => Promise<string | null>;
  };
}
