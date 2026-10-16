export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD';

export interface PostgrestRequestOptions {
  readonly method?: HttpMethod;
  readonly params?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface PostgrestResponse<T> {
  readonly data: T;
  readonly status: number;
  readonly count: number | null;
  readonly headers: Headers;
}
