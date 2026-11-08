import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import { fanoutApiRequest, fanoutApiRequestAllPosts } from "./GenericFunctions";
import { PLATFORMS } from "./shared";

const POST_STATUSES = ["draft", "scheduled", "publishing", "published", "partial", "failed", "cancelled"].map((s) => ({
  name: s.charAt(0).toUpperCase() + s.slice(1),
  value: s,
}));

function parseJsonObject(ctx: IExecuteFunctions, value: unknown, field: string, itemIndex: number): IDataObject | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") return value as IDataObject;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return Object.keys(parsed).length ? parsed : undefined;
  } catch {
    /* fall through */
  }
  throw new NodeOperationError(ctx.getNode(), `${field} must be a JSON object`, { itemIndex });
}

export class Fanout implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Fanout",
    name: "fanout",
    icon: "file:fanout.svg",
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Publish and schedule social media posts to 14 networks with one request",
    defaults: { name: "Fanout" },
    inputs: ["main" as NodeConnectionType],
    outputs: ["main" as NodeConnectionType],
    credentials: [{ name: "fanoutApi", required: true }],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Post", value: "post" },
          { name: "Account", value: "account" },
          { name: "Profile", value: "profile" },
          { name: "Connect Link", value: "connectLink" },
        ],
        default: "post",
      },

      /* ---------------- Post ---------------- */
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["post"] } },
        options: [
          { name: "Create", value: "create", action: "Create a post", description: "Publish now, schedule, or save a draft" },
          { name: "Delete", value: "delete", action: "Delete a post", description: "Cancel a scheduled post or remove a finished one from history" },
          { name: "Get", value: "get", action: "Get a post" },
          { name: "Get Many", value: "getAll", action: "Get many posts" },
          { name: "Retry", value: "retry", action: "Retry a post", description: "Queue the failed networks of a post again" },
        ],
        default: "create",
      },
      {
        displayName: "Text",
        name: "content",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        displayOptions: { show: { resource: ["post"], operation: ["create"] } },
        description: "The post text. You can override it for each account below.",
      },
      {
        displayName: "Accounts",
        name: "targets",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        placeholder: "Add Account",
        default: {},
        required: true,
        displayOptions: { show: { resource: ["post"], operation: ["create"] } },
        description: "The connected accounts to post to",
        options: [
          {
            name: "target",
            displayName: "Account",
            values: [
              {
                displayName: "Account Name or ID",
                name: "accountId",
                type: "options",
                typeOptions: { loadOptionsMethod: "getAccounts" },
                default: "",
                required: true,
                description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
              },
              {
                displayName: "Platform",
                name: "platform",
                type: "options",
                options: [{ name: "Detect From Account", value: "" }, ...PLATFORMS],
                default: "",
                description: "Optional. When set, the API checks that the account is on this network.",
              },
              {
                displayName: "Text Override",
                name: "content",
                type: "string",
                typeOptions: { rows: 2 },
                default: "",
                description: "Text for this account only. Leave empty to use the main text.",
              },
              {
                displayName: "Platform Options (JSON)",
                name: "platformSpecificData",
                type: "json",
                default: "{}",
                description: 'Network options, for example {"title": "My video", "visibility": "public"} for YouTube. See the API docs.',
              },
            ],
          },
        ],
      },
      {
        displayName: "Media",
        name: "media",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        placeholder: "Add Media",
        default: {},
        displayOptions: { show: { resource: ["post"], operation: ["create"] } },
        description: "Public URLs of images or videos",
        options: [
          {
            name: "item",
            displayName: "Media Item",
            values: [
              { displayName: "URL", name: "url", type: "string", default: "", required: true, placeholder: "https://cdn.example.com/photo.jpg" },
              {
                displayName: "Type",
                name: "type",
                type: "options",
                options: [
                  { name: "Detect From URL", value: "" },
                  { name: "Image", value: "image" },
                  { name: "Video", value: "video" },
                ],
                default: "",
              },
              { displayName: "Alt Text", name: "altText", type: "string", default: "" },
            ],
          },
        ],
      },
      {
        displayName: "When",
        name: "when",
        type: "options",
        options: [
          { name: "Publish Now", value: "now" },
          { name: "Schedule", value: "schedule" },
          { name: "Save as Draft", value: "draft" },
        ],
        default: "now",
        displayOptions: { show: { resource: ["post"], operation: ["create"] } },
      },
      {
        displayName: "Scheduled For",
        name: "scheduledFor",
        type: "dateTime",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["post"], operation: ["create"], when: ["schedule"] } },
        description: "Date and time to publish. A value without a UTC offset is read in the time zone below.",
      },
      {
        displayName: "Time Zone",
        name: "timezone",
        type: "string",
        default: "UTC",
        placeholder: "America/New_York",
        displayOptions: { show: { resource: ["post"], operation: ["create"], when: ["schedule"] } },
        description: "IANA time zone name",
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["post"], operation: ["create"] } },
        options: [
          { displayName: "External ID", name: "externalId", type: "string", default: "", description: "Your own reference. It is returned in responses and webhooks." },
          {
            displayName: "Profile Name or ID",
            name: "profileId",
            type: "options",
            typeOptions: { loadOptionsMethod: "getProfiles" },
            default: "",
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
          },
        ],
      },
      {
        displayName: "Post ID",
        name: "postId",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["post"], operation: ["get", "delete", "retry"] } },
      },
      {
        displayName: "Return All",
        name: "returnAll",
        type: "boolean",
        default: false,
        displayOptions: { show: { resource: ["post"], operation: ["getAll"] } },
        description: "Whether to return all results or only up to a given limit",
      },
      {
        displayName: "Limit",
        name: "limit",
        type: "number",
        typeOptions: { minValue: 1 },
        default: 50,
        displayOptions: { show: { resource: ["post"], operation: ["getAll"], returnAll: [false] } },
        description: "Max number of results to return",
      },
      {
        displayName: "Filters",
        name: "filters",
        type: "collection",
        placeholder: "Add Filter",
        default: {},
        displayOptions: { show: { resource: ["post"], operation: ["getAll"] } },
        options: [
          { displayName: "Status", name: "status", type: "options", options: POST_STATUSES, default: "published" },
          {
            displayName: "Profile Name or ID",
            name: "profileId",
            type: "options",
            typeOptions: { loadOptionsMethod: "getProfiles" },
            default: "",
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
          },
        ],
      },

      /* ---------------- Account ---------------- */
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["account"] } },
        options: [
          { name: "Disconnect", value: "disconnect", action: "Disconnect an account" },
          { name: "Get", value: "get", action: "Get an account" },
          { name: "Get Many", value: "getAll", action: "Get many accounts" },
        ],
        default: "getAll",
      },
      {
        displayName: "Account Name or ID",
        name: "accountId",
        type: "options",
        typeOptions: { loadOptionsMethod: "getAccounts" },
        default: "",
        required: true,
        displayOptions: { show: { resource: ["account"], operation: ["get", "disconnect"] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: "Filters",
        name: "filters",
        type: "collection",
        placeholder: "Add Filter",
        default: {},
        displayOptions: { show: { resource: ["account"], operation: ["getAll"] } },
        options: [
          { displayName: "Platform", name: "platform", type: "options", options: PLATFORMS, default: "linkedin" },
          {
            displayName: "Profile Name or ID",
            name: "profileId",
            type: "options",
            typeOptions: { loadOptionsMethod: "getProfiles" },
            default: "",
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
          },
        ],
      },

      /* ---------------- Profile ---------------- */
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["profile"] } },
        options: [
          { name: "Create", value: "create", action: "Create a profile" },
          { name: "Get Many", value: "getAll", action: "Get many profiles" },
        ],
        default: "getAll",
      },
      {
        displayName: "Name",
        name: "name",
        type: "string",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["profile"], operation: ["create"] } },
        description: "For example the name of your customer or brand",
      },
      {
        displayName: "Description",
        name: "description",
        type: "string",
        default: "",
        displayOptions: { show: { resource: ["profile"], operation: ["create"] } },
      },

      /* ---------------- Connect link ---------------- */
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["connectLink"] } },
        options: [{ name: "Get", value: "get", action: "Get a connect link", description: "Get a link your user opens to connect an account" }],
        default: "get",
      },
      {
        displayName: "Platform",
        name: "platform",
        type: "options",
        options: PLATFORMS,
        default: "linkedin",
        required: true,
        displayOptions: { show: { resource: ["connectLink"] } },
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["connectLink"] } },
        options: [
          {
            displayName: "Profile Name or ID",
            name: "profileId",
            type: "options",
            typeOptions: { loadOptionsMethod: "getProfiles" },
            default: "",
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
          },
          {
            displayName: "Redirect URL",
            name: "redirectUrl",
            type: "string",
            default: "",
            placeholder: "https://yourapp.com/connected",
            description: "Where to send the user when they finish. Results are added as query parameters.",
          },
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const { accounts } = (await fanoutApiRequest.call(this, "GET", "/accounts")) as { accounts: IDataObject[] };
        return accounts.map((a) => ({
          name: `${a.platform}: ${a.displayName || a.username || a.id}${a.status !== "active" ? ` (${a.status})` : ""}`,
          value: a.id as string,
        }));
      },
      async getProfiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const { profiles } = (await fanoutApiRequest.call(this, "GET", "/profiles")) as { profiles: IDataObject[] };
        return profiles.map((p) => ({ name: p.name as string, value: p.id as string }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    const push = (data: IDataObject | IDataObject[], itemIndex: number) => {
      for (const json of Array.isArray(data) ? data : [data]) output.push({ json, pairedItem: { item: itemIndex } });
    };

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        const operation = this.getNodeParameter("operation", i) as string;

        if (resource === "post") {
          if (operation === "create") {
            const targets = ((this.getNodeParameter("targets", i, {}) as IDataObject).target as IDataObject[] | undefined) ?? [];
            if (targets.length === 0) throw new NodeOperationError(this.getNode(), "Add at least one account to post to", { itemIndex: i });
            const media = ((this.getNodeParameter("media", i, {}) as IDataObject).item as IDataObject[] | undefined) ?? [];
            const when = this.getNodeParameter("when", i) as string;
            const additional = this.getNodeParameter("additionalFields", i, {}) as IDataObject;

            const body: IDataObject = {
              content: this.getNodeParameter("content", i, "") as string,
              platforms: targets.map((t) => {
                const target: IDataObject = { accountId: t.accountId };
                if (t.platform) target.platform = t.platform;
                if (t.content) target.content = t.content;
                const data = parseJsonObject(this, t.platformSpecificData, "Platform Options", i);
                if (data) target.platformSpecificData = data;
                return target;
              }),
              mediaItems: media
                .filter((m) => m.url)
                .map((m) => ({ url: m.url, ...(m.type ? { type: m.type } : {}), ...(m.altText ? { altText: m.altText } : {}) })),
            };
            if (when === "now") body.publishNow = true;
            if (when === "draft") body.isDraft = true;
            if (when === "schedule") {
              body.scheduledFor = this.getNodeParameter("scheduledFor", i) as string;
              body.timezone = (this.getNodeParameter("timezone", i, "UTC") as string) || "UTC";
            }
            if (additional.externalId) body.externalId = additional.externalId;
            if (additional.profileId) body.profileId = additional.profileId;

            const { post } = await fanoutApiRequest.call(this, "POST", "/posts", body);
            push(post, i);
          } else if (operation === "get") {
            const id = encodeURIComponent(this.getNodeParameter("postId", i) as string);
            const { post } = await fanoutApiRequest.call(this, "GET", `/posts/${id}`);
            push(post, i);
          } else if (operation === "getAll") {
            const returnAll = this.getNodeParameter("returnAll", i) as boolean;
            const limit = returnAll ? undefined : (this.getNodeParameter("limit", i) as number);
            const filters = this.getNodeParameter("filters", i, {}) as IDataObject;
            const qs: IDataObject = {};
            if (filters.status) qs.status = filters.status;
            if (filters.profileId) qs.profileId = filters.profileId;
            push(await fanoutApiRequestAllPosts.call(this, qs, limit), i);
          } else if (operation === "delete") {
            const id = encodeURIComponent(this.getNodeParameter("postId", i) as string);
            push(await fanoutApiRequest.call(this, "DELETE", `/posts/${id}`), i);
          } else if (operation === "retry") {
            const id = encodeURIComponent(this.getNodeParameter("postId", i) as string);
            push(await fanoutApiRequest.call(this, "POST", `/posts/${id}/retry`), i);
          }
        } else if (resource === "account") {
          if (operation === "getAll") {
            const filters = this.getNodeParameter("filters", i, {}) as IDataObject;
            const qs: IDataObject = {};
            if (filters.platform) qs.platform = filters.platform;
            if (filters.profileId) qs.profileId = filters.profileId;
            const { accounts } = await fanoutApiRequest.call(this, "GET", "/accounts", undefined, qs);
            push(accounts, i);
          } else if (operation === "get") {
            const id = encodeURIComponent(this.getNodeParameter("accountId", i) as string);
            const { account } = await fanoutApiRequest.call(this, "GET", `/accounts/${id}`);
            push(account, i);
          } else if (operation === "disconnect") {
            const id = encodeURIComponent(this.getNodeParameter("accountId", i) as string);
            push(await fanoutApiRequest.call(this, "DELETE", `/accounts/${id}`), i);
          }
        } else if (resource === "profile") {
          if (operation === "create") {
            const description = this.getNodeParameter("description", i, "") as string;
            const { profile } = await fanoutApiRequest.call(this, "POST", "/profiles", {
              name: this.getNodeParameter("name", i) as string,
              ...(description ? { description } : {}),
            });
            push(profile, i);
          } else if (operation === "getAll") {
            const { profiles } = await fanoutApiRequest.call(this, "GET", "/profiles");
            push(profiles, i);
          }
        } else if (resource === "connectLink") {
          const platform = this.getNodeParameter("platform", i) as string;
          const additional = this.getNodeParameter("additionalFields", i, {}) as IDataObject;
          const qs: IDataObject = {};
          if (additional.profileId) qs.profileId = additional.profileId;
          if (additional.redirectUrl) qs.redirectUrl = additional.redirectUrl;
          const result = await fanoutApiRequest.call(this, "GET", `/connect/${encodeURIComponent(platform)}`, undefined, qs);
          push({ platform, ...result }, i);
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown resource ${resource}`, { itemIndex: i });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw error;
      }
    }

    return [output];
  }
}
