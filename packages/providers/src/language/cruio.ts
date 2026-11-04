const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

export default {
  id: "cruio" as const,
  label: "Cruio",
  icon: "",
  version: "1.0.0",
  apiUrl: "https://cruiorouter.onebeget.com/v1",
  protocol: "openai-completions",
  readme: "Cruio 模型服务，由 NewAPI 提供模型路由。",
  rules,
  models: [
    { id: "glm-5.3", label: "GLM 5.3", type: "text" },
    { id: "Qwen3-Max", label: "Qwen3-Max", type: "text" },
    { id: "kimi/kimi-k3", label: "Kimi K3", type: "text" },
    { id: "ZHIPU/GLM-5.3-Flash", label: "GLM 5.3 Flash", type: "text" },
    { id: "ZHIPU/GLM-5.3", label: "ZHIPU/GLM-5.3", type: "text" },
    { id: "deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash", type: "text" },
  ],
} satisfies ProviderDefinition<typeof rules>;
