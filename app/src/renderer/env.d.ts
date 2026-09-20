/// <reference types="vite/client" />

interface OpenedBundle {
  path: string;
  content: string;
}

interface Window {
  metaspacer?: {
    platform: string;
    openBundle: () => Promise<OpenedBundle | null>;
  };
}
