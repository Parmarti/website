import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
  NodeConnectionType,
} from "n8n-workflow";
import { fanoutApiRequest } from "./GenericFunctions";
import { SIGNATURE_HEADER, WEBHOOK_EVENTS, verifySignature } from "./shared";

interface StaticData extends IDataObject {
  webhookId?: string;
  webhookSecret?: string;
}

function sameEvents(a: unknown, b: string[]): boolean {
  const left = Array.isArray(a) ? [...(a as string[])].sort() : [];
  const right = [...b].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

export class FanoutTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Fanout Trigger",
    name: "fanoutTrigger",
    icon: "file:fanout.svg",
    group: ["trigger"],
    version: 1,
    subtitle: '={{($parameter["events"] || []).length ? $parameter["events"].join(", ") : "All events"}}',
    description: "Starts the workflow when a post finishes publishing or an account changes",
    defaults: { name: "Fanout Trigger" },
    inputs: [],
    outputs: ["main" as NodeConnectionType],
    credentials: [{ name: "fanoutApi", required: true }],
    webhooks: [{ name: "default", httpMethod: "POST", responseMode: "onReceived", path: "webhook" }],
    properties: [
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        options: WEBHOOK_EVENTS,
        default: [],
        description: "Leave empty to receive all events",
      },
      {
        displayName: "Verify Signature",
        name: "verifySignature",
        type: "boolean",
        default: true,
        description: "Whether to reject requests that are not signed with this webhook's secret",
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as StaticData;
        const url = this.getNodeWebhookUrl("default");
        const events = this.getNodeParameter("events", []) as string[];
        const { webhooks } = (await fanoutApiRequest.call(this, "GET", "/webhooks")) as { webhooks: IDataObject[] };
        const existing = webhooks.find((w) => w.url === url);
        if (!existing) return false;
        // Reuse it only if we still hold its secret and the events did not change; otherwise recreate it.
        if (existing.id === staticData.webhookId && staticData.webhookSecret && sameEvents(existing.events, events)) return true;
        await fanoutApiRequest.call(this, "DELETE", `/webhooks/${encodeURIComponent(existing.id as string)}`).catch(() => undefined);
        delete staticData.webhookId;
        delete staticData.webhookSecret;
        return false;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as StaticData;
        const url = this.getNodeWebhookUrl("default");
        const events = this.getNodeParameter("events", []) as string[];
        const { webhook } = (await fanoutApiRequest.call(this, "POST", "/webhooks", { url, events })) as { webhook: IDataObject };
        if (!webhook?.id || !webhook.secret) return false;
        staticData.webhookId = webhook.id as string;
        staticData.webhookSecret = webhook.secret as string;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as StaticData;
        if (staticData.webhookId) {
          try {
            await fanoutApiRequest.call(this, "DELETE", `/webhooks/${encodeURIComponent(staticData.webhookId)}`);
          } catch {
            // Already gone on the server: nothing to clean up.
          }
        }
        delete staticData.webhookId;
        delete staticData.webhookSecret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData();
    const shouldVerify = this.getNodeParameter("verifySignature", true) as boolean;

    if (shouldVerify) {
      const staticData = this.getWorkflowStaticData("node") as StaticData;
      const req = this.getRequestObject() as unknown as { rawBody?: Buffer | string };
      const raw = req.rawBody !== undefined ? req.rawBody.toString() : JSON.stringify(body);
      const header = this.getHeaderData()[SIGNATURE_HEADER] as string | undefined;
      if (!verifySignature(raw, header, staticData.webhookSecret ?? "")) {
        const res = this.getResponseObject();
        res.status(401).send("Invalid signature").end();
        return { noWebhookResponse: true };
      }
    }

    const events = this.getNodeParameter("events", []) as string[];
    const event = body.event as string | undefined;
    // Test events from the API are always passed through so users can check the connection.
    if (events.length && event && event !== "webhook.test" && !events.includes(event)) {
      return { webhookResponse: { received: true, ignored: true } };
    }

    return { workflowData: [this.helpers.returnJsonArray(body)] };
  }
}
