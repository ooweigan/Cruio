export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  }).catch((error: unknown) => {
    if (error instanceof TypeError) throw new ApiError("无法连接服务，请检查网络后重试。", 0);
    throw error;
  });
  if (response.status === 204) return null as T;
  const responseText = await response.text();
  let payloadValue: unknown = null;
  try {
    payloadValue = JSON.parse(responseText);
  } catch {
    if (response.ok) throw new ApiError("服务响应格式异常，请稍后重试。", response.status);
  }
  const payload = payloadValue && typeof payloadValue === "object" && !Array.isArray(payloadValue)
    ? payloadValue as { message?: unknown; quote?: { blocks?: unknown[] } }
    : null;
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : quoteBlockMessage(payload?.quote?.blocks);
    throw new ApiError(message || "服务暂时无法处理请求，请稍后重试。", response.status);
  }
  return payload as T;
}

export function quoteBlockMessage(blocks?: unknown[]) {
  if (!blocks?.length) return "";
  const messages: Record<string, string> = {
    node_disabled: "节点已禁用，请先启用节点。",
    node_missing_or_operation_mismatch: "当前画布缺少匹配的生成节点，请刷新画布后重试。",
    node_version_changed: "生成节点已更新，请重新获取报价。",
    canvas_version_changed: "画布已更新，请等待保存后重新获取报价。",
    workflow_version_changed: "工作流版本已变化，请刷新后重新获取报价。",
    prompt_snapshot_mismatch: "生成提示词与已保存内容不一致，请保存后重新获取报价。",
    parameter_snapshot_mismatch: "生成参数与已保存配置不一致，请保存后重新获取报价。",
    unsupported_input_node: "当前连接包含暂不支持的输入类型。",
    formal_input_unavailable: "上游正式采用结果已失效或文件校验失败，请重新采用后报价。",
    formal_input_snapshot_mismatch: "上游正式输出引用已变化，请刷新画布后重新报价。",
    asset_port_snapshot_mismatch: "素材连接已变化，请刷新画布后重新报价。",
    model_unavailable: "该模型当前不可用，请重新选择模型。",
    model_snapshot_mismatch: "当前模型与节点已保存的模型配置不匹配，请重新选择。",
    generation_executor_unavailable: "该生成能力暂未接通执行服务，当前不能创建任务。",
    pricing_unconfigured: "该模型暂未配置报价，当前不能提交。",
    unsupported_parameters: "模型不支持当前参数。",
    prompt_too_long: "提示词超过该模型支持的长度。",
    asset_missing_revoked_or_unsupported: "引用素材已撤回或不支持，请更换素材。",
    too_many_references: "引用素材数量超过模型限制。",
    insufficient_credits: "可用点数不足，当前不能提交。",
  };
  return blocks.map((block) => messages[String(block)] ?? "本次条件暂不可执行，请检查输入后重试。").join("；");
}
