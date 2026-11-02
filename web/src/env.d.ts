/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发时 SSE 直连后端根地址，如 http://127.0.0.1:3710（不设则默认当前 hostname:3710） */
  readonly VITE_API_SSE_ORIGIN?: string;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
