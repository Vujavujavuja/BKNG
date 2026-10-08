export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export interface AppContext {
  Bindings: Env;
  Variables: {
    userId: string;
    /** Origin plus base path of the current request, no trailing slash. */
    baseUrl: string;
  };
}
