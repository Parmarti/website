import type {
  IDataObject,
  IExecuteFunctions,
  IHookFunctions,
  IHttpRequestMethods,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  IWebhookFunctions,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError } from "n8n-workflow";
import { normalizeBaseUrl } from "./shared";

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

/** Pull the API's own error text out of whatever error shape the HTTP helper throws. */
function apiErrorDetails(error: unknown): { message?: string; description?: string } {
  const e = error as Record<string, any>;
  const body =
    e?.response?.data ?? e?.response?.body ?? e?.cause?.response?.data ?? e?.cause?.response?.body ?? e?.error ?? undefined;
  const parsed = typeof body === "string" ? safeJson(body) : body;
  const apiError = parsed?.error;
  if (!apiError || typeof apiError !== "object") return {};
  const details = apiError.details;
  let description: string | undefined;
  if (Array.isArray(details)) {
    description = details
      .map((d: IDataObject) => `${d.platform ?? d.accountId}: ${Array.isArray(d.errors) ? d.errors.join(" ") : JSON.stringify(d)}`)
      .join("\n");
  } else if (details) {
    description = JSON.stringify(details);
  }
  return { message: apiError.message, description };
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function fanoutApiRequest(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<any> {
  const credentials = await this.getCredentials("fanoutApi");
  const options: IHttpRequestOptions = {
    method,
    url: `${normalizeBaseUrl(credentials.baseUrl as string)}/api/v1${path}`,
    json: true,
  };
  if (body && Object.keys(body).length) options.body = body;
  if (qs && Object.keys(qs).length) options.qs = qs;
  try {
    return await this.helpers.httpRequestWithAuthentication.call(this, "fanoutApi", options);
  } catch (error) {
    const { message, description } = apiErrorDetails(error);
    const apiError = new NodeApiError(this.getNode(), error as JsonObject, { message, description });
    // NodeApiError replaces the description with the response message, so set the per-network details again.
    if (description) apiError.description = description;
    throw apiError;
  }
}

/** Upload raw file bytes to POST /media. Returns the parsed JSON response. */
export async function fanoutApiUpload(
  this: IExecuteFunctions,
  data: Buffer,
  contentType: string,
  filename?: string,
): Promise<any> {
  const credentials = await this.getCredentials("fanoutApi");
  const options: IHttpRequestOptions = {
    method: "POST",
    url: `${normalizeBaseUrl(credentials.baseUrl as string)}/api/v1/media`,
    headers: { "Content-Type": contentType },
    body: data,
    // The body is bytes, not JSON. The response is JSON and is parsed below if needed.
    json: false,
    ...(filename ? { qs: { filename } } : {}),
  };
  try {
    const response = await this.helpers.httpRequestWithAuthentication.call(this, "fanoutApi", options);
    if (Buffer.isBuffer(response)) return JSON.parse(response.toString("utf8"));
    return typeof response === "string" ? JSON.parse(response) : response;
  } catch (error) {
    const { message, description } = apiErrorDetails(error);
    const apiError = new NodeApiError(this.getNode(), error as JsonObject, { message, description });
    if (description) apiError.description = description;
    throw apiError;
  }
}

/** Follow nextCursor until the limit is reached or there are no more pages. */
export async function fanoutApiRequestAllPosts(this: IExecuteFunctions, qs: IDataObject, limit?: number): Promise<IDataObject[]> {
  const results: IDataObject[] = [];
  let cursor: string | null = null;
  do {
    const pageSize = limit ? Math.min(100, limit - results.length) : 100;
    const response = (await fanoutApiRequest.call(this, "GET", "/posts", undefined, {
      ...qs,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    })) as { posts: IDataObject[]; nextCursor: string | null };
    results.push(...response.posts);
    cursor = response.nextCursor;
  } while (cursor && (!limit || results.length < limit));
  return limit ? results.slice(0, limit) : results;
}
