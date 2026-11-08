import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from "n8n-workflow";

export class FanoutApi implements ICredentialType {
  name = "fanoutApi";

  displayName = "Fanout API";

  documentationUrl = "https://api.example.com/docs";

  icon = "file:fanout.svg" as const;

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "Create a key in the dashboard under API keys",
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://api.example.com",
      required: true,
      description: "The address of your Fanout server, without a trailing slash",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl.replace(/\\/$/, '')}}",
      url: "/api/v1/usage",
      method: "GET",
    },
  };
}
