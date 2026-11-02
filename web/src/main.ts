import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";

const API_TOKEN_STORAGE_KEY = "my_app_api_token";

function resolveApiToken(): string {
  const v = window.localStorage.getItem(API_TOKEN_STORAGE_KEY)?.trim();
  return v || "dev-token";
}

function installAuthFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawMethod = init?.method || (input instanceof Request ? input.method : "GET") || "GET";
    const method = rawMethod.toUpperCase();
    const isWriteMethod = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

    let path = "";
    if (typeof input === "string") path = input;
    else if (input instanceof URL) path = input.pathname;
    else if (input instanceof Request) path = input.url;

    const isApiCall = path.startsWith("/api/") || path.includes("/api/");
    if (!isWriteMethod || !isApiCall) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) {
      const token = resolveApiToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    if (input instanceof Request) {
      const nextReq = new Request(input, { headers });
      return originalFetch(nextReq, init);
    }
    return originalFetch(input, { ...(init || {}), headers });
  };
}

installAuthFetch();
const app = createApp(App);
app.use(createPinia());
app.mount("#app");
