import type { AccountRecord, AccountStore } from "./store";
import type { NewApiCustomer, NewApiToken } from "./newApi";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const styles = `
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#203439;background:#f5f7f7;font-size:14px;line-height:1.55;color-scheme:light}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}button,.buttonLink{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid #cfdbdc;border-radius:8px;background:white;color:#254248;padding:9px 15px;cursor:pointer;font-weight:600;white-space:nowrap}button:hover,.buttonLink:hover{background:#edf5f4}button.primary,.buttonLink.primary{background:#116c62;border-color:#116c62;color:white}button.primary:hover,.buttonLink.primary:hover{background:#0b564e}.danger{color:#a63b36}button:disabled{opacity:.5;cursor:not-allowed}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #58b5a5;outline-offset:3px}input,textarea,select{width:100%;border:1px solid #ccd8da;border-radius:7px;padding:10px 12px;background:#fff;color:#203439;min-width:0}textarea{resize:vertical;min-height:110px}input::placeholder{color:#8a989c}label{display:block;font-weight:550;margin-bottom:6px}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:650;letter-spacing:-1px}h2{font-size:18px}h3{font-size:14px}small,.muted{color:#6e8085}small{font-size:12px}code{font-size:12px;overflow-wrap:anywhere}.shell{min-height:100vh;display:grid;grid-template-columns:214px minmax(0,1fr)}.sidebar{background:#fff;border-right:1px solid #e0e7e7;padding:32px 22px;display:flex;flex-direction:column;gap:38px}.brand{font-size:26px;letter-spacing:-1.4px;font-weight:750;display:flex;align-items:center;gap:10px}.brandMark{background:#116c62;color:white;width:32px;height:32px;display:grid;place-items:center;border-radius:9px;font-size:23px;letter-spacing:0}.sidebar small{display:block;margin-top:4px}.navItem{display:block;background:#e8f3ef;color:#146459;border-radius:7px;padding:12px 14px;font-weight:600}.sidebarFoot{margin-top:auto;font-size:12px;color:#7b8d90}.main{padding:27px 42px 48px;min-width:0;max-width:1640px;width:100%;margin:auto}.topbar{display:flex;justify-content:space-between;align-items:center;padding-bottom:30px;gap:16px}.topbar form{display:flex;align-items:center;gap:14px}.breadcrumb{font-size:12px;color:#829196}.heading{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:10px 0 28px}.heading p{color:#718185;margin-top:6px}.summary{display:flex;gap:32px;padding:18px 0 24px}.summary strong{font-size:25px;font-weight:600;margin-right:8px}.summary span{font-size:12px;color:#6e8085}.panel{background:white;border:1px solid #dfe7e7;border-radius:12px;padding:24px;margin-bottom:20px}.panelHeader{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:20px}.panelHeader p{margin-top:5px;font-size:12px;color:#6e8085}.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:20px}.toolbar input{max-width:380px}.toolbar select{width:150px}.tableWrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:12px;font-weight:500;color:#73858a;background:#f7f9f9}th,td{padding:14px 12px;border-bottom:1px solid #edf1f1}td small{display:block;margin-top:3px}.accountLink{font-weight:650;color:#195b54}.badge{display:inline-block;background:#e8f4ee;color:#247458;border-radius:5px;padding:3px 8px;font-size:11px;white-space:nowrap}.badge.pending{background:#f5f0e4;color:#92702d}.badge.off{background:#f4eaea;color:#a15550}.detailGrid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,1fr);gap:20px}.detailGrid .panel{height:fit-content}.field{margin-bottom:18px}.field small{display:block;margin-top:6px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.row .field{flex:1;min-width:150px}.notice{background:#eaf4f0;border:1px solid #c6dfd6;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:#2e6858}.notice.error{background:#fcf0ed;border-color:#ecd2c9;color:#994b3a}.note{background:#f6f8f8;padding:13px 15px;border-radius:8px;font-size:12px;color:#6e8085;margin-bottom:18px;overflow-wrap:anywhere}.rule{height:1px;background:#e7eded;margin:22px 0}.meta{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px;font-size:13px;margin:20px 0}.meta dt{color:#74868b}.meta dd{margin:0;overflow-wrap:anywhere}.empty{text-align:center;padding:48px;color:#718185}.login{max-width:420px;margin:12vh auto;padding:0 24px}.login .brand{margin-bottom:40px}.login h1{font-size:26px;margin-bottom:10px}.login form{margin-top:28px}.login button{width:100%}.loginHelp{margin-top:25px;font-size:12px;color:#77898c;line-height:1.8}.formPanel{max-width:600px}.checkbox{display:flex;align-items:flex-start;gap:8px;font-weight:400;font-size:12px;color:#718185;margin:15px 0}.checkbox input{width:auto;margin-top:3px}.footerNote{font-size:12px;color:#7a8b8f;margin-top:18px}.pagination{display:flex;align-items:center;justify-content:space-between;margin-top:20px;font-size:12px;color:#718185}
@media(max-width:1100px){.main{padding:24px}.detailGrid{grid-template-columns:1fr}.shell{grid-template-columns:180px minmax(0,1fr)}}@media(max-width:720px){.shell{display:block}.sidebar{padding:16px 20px;border-right:0;border-bottom:1px solid #e0e7e7;flex-direction:row;align-items:center;justify-content:space-between;gap:15px}.sidebar small,.sidebarFoot{display:none}.sidebar .brand{font-size:22px}.navItem{padding:7px 12px}.main{padding:20px 16px}.heading{align-items:flex-start}.heading h1{font-size:25px}.panel{padding:18px}.toolbar{flex-wrap:wrap}.toolbar input{max-width:none;flex:1;min-width:180px}.topbar{padding-bottom:12px}.summary{gap:20px}.summary strong{font-size:22px}.summary span{display:block}.row{align-items:stretch}.topbar form{gap:7px}.login{margin-top:8vh}}
`;

function documentPage(content: string, title: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Cruio 管理台</title><style>${styles}</style></head><body>${content}</body></html>`;
}

const brand = '<a class="brand" href="/admin"><span class="brandMark" aria-hidden="true">c</span>Cruio</a>';

export function loginPage(error = "") {
  return documentPage(`<main class="login">${brand}<h1>账户管理台</h1><p class="muted">使用 Cruio 管理员账号登录</p>${error ? `<div role="alert" class="notice error">${escapeHtml(error)}</div>` : ""}<form method="post" action="/admin/login"><div class="field"><label for="account">账号</label><input id="account" name="account" autocomplete="username" maxlength="320" required autofocus></div><div class="field"><label for="password">密码</label><input id="password" type="password" name="password" autocomplete="current-password" maxlength="1024" required></div><button class="primary">登录管理台</button></form><div class="loginHelp">首次使用需在服务停止后，通过运营命令将已有账号设为管理员：<br><code>bun run --cwd apps/accountService manage makeAdmin 账号</code><br>普通创作账号不会自动获得管理权限。</div></main>`, "登录");
}

export type NewApiSelection = {
  keyword: string; page: number; tokenPage: number;
  customers?: { items: NewApiCustomer[]; total: number };
  tokens?: { customer: NewApiCustomer; items: NewApiToken[]; total: number };
  error?: string;
};
type PageOptions = { admin: AccountRecord; csrf: string; selected?: string; query?: string; filter?: string; page?: number; message?: string; error?: boolean; newApi?: NewApiSelection };

function newApiBindingForm(user: AccountRecord, users: AccountRecord[], csrf: string, selection?: NewApiSelection) {
  const fields = `<input type="hidden" name="selected" value="${user.id}"><input type="hidden" name="newApi" value="1">`;
  const url = (values: Record<string, string>) => escapeHtml(`/admin?${new URLSearchParams({ selected: user.id, newApi: "1", newApiQuery: selection?.keyword ?? "", newApiPage: String(selection?.page ?? 1), ...values })}`);
  const customers = selection?.customers;
  const tokens = selection?.tokens;
  const customerOptions = customers?.items.map(customer => {
    const linked = users.some(value => value.id !== user.id && value.newApiBinding?.userId === customer.id);
    return `<option value="${customer.id}" ${linked ? "disabled" : ""} ${tokens?.customer.id === customer.id ? "selected" : ""}>${escapeHtml(customer.displayName || customer.username)} · ${escapeHtml(customer.username)} · ${escapeHtml(customer.group)}${linked ? "（已绑定其他账号）" : ""}</option>`;
  }).join("");
  const tokenOptions = tokens?.items.map(token => {
    const unavailable = token.status === 2 || token.status === 3 || token.expiresAt !== -1 && token.expiresAt < Date.now() / 1000;
    return `<option value="${token.id}" ${unavailable ? "disabled" : ""}>${escapeHtml(token.name || `Key ${token.id}`)} · ${escapeHtml(token.group || "跟随用户组")}${unavailable ? "（已停用或过期）" : ""}</option>`;
  }).join("");
  return `<form class="toolbar" method="get" action="/admin">${fields}<input name="newApiQuery" aria-label="搜索 New API 客户" maxlength="128" placeholder="客户名称、账号或 ID" value="${escapeHtml(selection?.keyword ?? "")}"><button>从 New API 获取客户</button></form>
    ${selection?.error ? `<p class="notice error" role="alert">${escapeHtml(selection.error)}</p>` : ""}
    ${customers ? customers.items.length ? `<form method="get" action="/admin">${fields}<input type="hidden" name="newApiQuery" value="${escapeHtml(selection?.keyword)}"><input type="hidden" name="newApiPage" value="${selection?.page}"><div class="field"><label for="newApiUserId">New API 客户</label><select id="newApiUserId" name="newApiUserId" required><option value="">选择客户</option>${customerOptions}</select></div><button>加载该客户的 API Key</button></form>` : '<p class="note">未找到可用客户。</p>' : ""}
    ${customers && customers.total > 20 ? `<div class="pagination"><span>共 ${customers.total} 位客户</span><div class="row">${selection!.page > 1 ? `<a class="buttonLink" href="${url({ newApiPage: String(selection!.page - 1) })}">上一页</a>` : ""}${selection!.page * 20 < customers.total ? `<a class="buttonLink" href="${url({ newApiPage: String(selection!.page + 1) })}">下一页</a>` : ""}</div></div>` : ""}
    ${tokens ? `<div class="rule"></div><p class="note">已选择 ${escapeHtml(tokens.customer.displayName || tokens.customer.username)}（${escapeHtml(tokens.customer.username)}），会员等级：${escapeHtml(tokens.customer.group)}</p>${tokens.items.length ? `<form method="post" action="/admin/bindNewApi"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="userId" value="${user.id}"><input type="hidden" name="newApiUserId" value="${tokens.customer.id}"><div class="field"><label for="newApiTokenId">API Key</label><select id="newApiTokenId" name="newApiTokenId" required><option value="">选择 API Key</option>${tokenOptions}</select><small>保存时核验归属并加密保存 Key；页面不显示密钥明文。更换绑定将使原 Cruio 会话失效。</small></div><button class="primary">${user.modelCredential ? "更新绑定" : "保存绑定"}</button></form>` : '<p class="note">该客户尚无 API Key，请先在 New API 后台创建。</p>'}` : ""}
    ${tokens && tokens.total > 20 ? `<div class="pagination"><span>共 ${tokens.total} 个 Key</span><div class="row">${selection!.tokenPage > 1 ? `<a class="buttonLink" href="${url({ newApiUserId: String(tokens.customer.id), newApiTokenPage: String(selection!.tokenPage - 1) })}">上一页</a>` : ""}${selection!.tokenPage * 20 < tokens.total ? `<a class="buttonLink" href="${url({ newApiUserId: String(tokens.customer.id), newApiTokenPage: String(selection!.tokenPage + 1) })}">下一页</a>` : ""}</div></div>` : ""}`;
}

export async function adminPage(store: AccountStore, options: PageOptions) {
  const { admin, csrf, selected, query = "", filter = "all", message, error } = options;
  const state = await store.read();
  const hidden = `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
  const form = (action: string, content: string, userId?: string) => `<form method="post" action="/admin/${action}">${hidden}${userId ? `<input type="hidden" name="userId" value="${escapeHtml(userId)}">` : ""}${content}</form>`;
  const user = state.users.find(value => value.id === selected);
  let content: string;
  if (selected === "new") {
    content = `<div class="heading"><div><h1>新建账户</h1><p>创建账号后，选择 New API 客户和 API Key 完成绑定。</p></div><a class="buttonLink" href="/admin">返回列表</a></div>
      <section class="panel formPanel">${form("create", `<div class="field"><label for="account">登录账号</label><input id="account" name="account" maxlength="320" autocomplete="off" required></div>
        <div class="field"><label for="displayName">显示名称</label><input id="displayName" name="displayName" maxlength="200" required></div>
        <div class="field"><label for="password">初始密码</label><input id="password" type="password" name="password" minlength="6" maxlength="1024" autocomplete="new-password" required><small>至少 6 个字符。</small></div>
        <button class="primary">创建账户</button>`)}</section>`;
  } else if (user) {
    const bound = !!user.modelCredential;
    content = `<div class="heading"><div><div class="breadcrumb">账户管理 / 账户详情</div><h1>${escapeHtml(user.displayName)}</h1><p>${escapeHtml(user.account)} · ${user.role === "admin" ? "管理员" : "普通账户"}</p></div><a class="buttonLink" href="/admin">返回列表</a></div>
      <div class="detailGrid"><section class="panel"><div class="panelHeader"><div><h2>NewAPI API Key</h2><p>每个 Cruio 账户绑定一个用户专属 Key。</p></div><span class="badge ${bound ? "" : "pending"}">${bound ? "已绑定" : "未绑定"}</span></div>
        <p class="note">${user.newApiBinding ? `当前客户：${escapeHtml(user.newApiBinding.username)} · Key：${escapeHtml(user.newApiBinding.tokenName || user.newApiBinding.tokenId)}` : bound ? "当前为旧版手工 Key 绑定，请选择对应客户和 Key，以开通余额查询与兑换充值。" : "先在 New API 后台开通客户、配置会员分组并创建 Key，再在这里选择绑定。"}</p>
        ${newApiBindingForm(user, state.users, csrf, options.newApi)}
        ${bound ? `<div class="rule"></div>${form("clearModel", '<label class="checkbox"><input type="checkbox" name="confirm" value="yes" required>确认解除 Key 绑定，并使该账号的 Cruio 会话失效。</label><button class="danger">解除绑定</button>', user.id)}` : ""}
        <p class="footerNote">会员等级、消费倍率和模型权限由 New API 管理。充值按兑换码面额到账；Key 的固定分组可能影响实际消费倍率。</p>
      </section><div><section class="panel"><div class="panelHeader"><h2>账户状态</h2><span class="badge ${user.disabled ? "off" : ""}">${user.disabled ? "已停用" : "正常"}</span></div>
        <dl class="meta"><dt>Cruio ID</dt><dd><code>${user.id}</code></dd><dt>有效会话</dt><dd>${state.sessions.filter(session => session.userId === user.id && Date.parse(session.expiresAt) > Date.now()).length}</dd></dl>
        <div class="row">${form(user.disabled ? "enable" : "disable", `<button ${user.id === admin.id ? "disabled" : ""} class="${user.disabled ? "" : "danger"}">${user.disabled ? "启用账户" : "停用账户"}</button>`, user.id)}${form("revoke", "<button>撤销 Cruio 会话</button>", user.id)}</div>
        <p class="footerNote">停用仅阻止 Cruio 登录与会话使用。NewAPI Key 需在上游另行停用。</p></section>
        <section class="panel"><div class="panelHeader"><h2>重置密码</h2></div>${form("resetPassword", '<div class="field"><label for="newPassword">新密码</label><input id="newPassword" name="password" type="password" minlength="6" maxlength="1024" autocomplete="new-password" required><small>至少 6 个字符，保存后原 Cruio 会话失效。</small></div><button>保存新密码</button>', user.id)}</section>
      </div></div>`;
  } else {
    const needle = query.toLocaleLowerCase();
    const matches = state.users.filter(value => [value.account, value.displayName].some(field => field.toLocaleLowerCase().includes(needle))
      && (filter === "all" || filter === "unlinked" && !value.modelCredential || filter === "disabled" && value.disabled));
    const pages = Math.max(1, Math.ceil(matches.length / 30));
    const page = Math.min(Math.max(1, options.page ?? 1), pages);
    const pageUrl = (value: number) => `/admin?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}&page=${value}`;
    const rows = matches.slice((page - 1) * 30, page * 30).map(value => `<tr><td><a class="accountLink" href="/admin?selected=${value.id}">${escapeHtml(value.displayName)}</a><small>${escapeHtml(value.account)}</small></td>
      <td>${value.role === "admin" ? "管理员" : "普通账户"}</td><td><span class="badge ${value.disabled ? "off" : ""}">${value.disabled ? "已停用" : "正常"}</span></td>
      <td><span class="badge ${value.modelCredential ? "" : "pending"}">${value.modelCredential ? "已绑定" : "未绑定"}</span></td><td><a class="accountLink" href="/admin?selected=${value.id}">管理 →</a></td></tr>`).join("");
    content = `<div class="heading"><div><h1>账户管理</h1><p>开通 Cruio 账户，绑定运营已配置的 NewAPI Key。</p></div><a class="buttonLink primary" href="/admin?selected=new">＋ 新建账户</a></div>
      <div class="summary"><div><strong>${state.users.length}</strong><span>全部账户</span></div><div><strong>${state.users.filter(value => value.modelCredential).length}</strong><span>已绑定 Key</span></div><div><strong>${state.users.filter(value => !value.modelCredential).length}</strong><span>待绑定</span></div></div>
      <section class="panel"><form class="toolbar" method="get" action="/admin"><input aria-label="搜索账户" name="q" maxlength="320" placeholder="搜索 Cruio 账号或名称" value="${escapeHtml(query)}"><select name="filter" aria-label="筛选账户">${[["all", "全部账户"], ["unlinked", "未绑定 Key"], ["disabled", "已停用"]].map(([value, label]) => `<option value="${value}" ${filter === value ? "selected" : ""}>${label}</option>`).join("")}</select><button>搜索</button>${query || filter !== "all" ? '<a class="buttonLink" href="/admin">重置</a>' : ""}</form>
      <div class="tableWrap"><table><thead><tr><th>账户</th><th>角色</th><th>状态</th><th>API Key</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">未找到匹配账户</td></tr>'}</tbody></table></div>
      <div class="pagination"><span>共 ${matches.length} 个账户 · 第 ${page} / ${pages} 页</span><div class="row">${page > 1 ? `<a class="buttonLink" href="${escapeHtml(pageUrl(page - 1))}">上一页</a>` : ""}${page < pages ? `<a class="buttonLink" href="${escapeHtml(pageUrl(page + 1))}">下一页</a>` : ""}</div></div></section>
      <p class="footerNote">模型权限和额度全部在 NewAPI 后台配置，Cruio 只保存账户与 Key 的绑定。</p>`;
  }
  return documentPage(`<div class="shell"><aside class="sidebar"><div>${brand}<small>账户管理台</small></div><nav aria-label="管理导航"><a class="navItem" href="/admin" aria-current="page">账户管理</a></nav><div class="sidebarFoot">CRUIO CONSOLE<br>账户与 API Key 绑定</div></aside><main class="main"><div class="topbar"><span class="breadcrumb">控制台 / 账户</span>${form("logout", `<span>${escapeHtml(admin.displayName)}</span><button>退出</button>`)}</div>${message ? `<div role="${error ? "alert" : "status"}" class="notice ${error ? "error" : ""}">${escapeHtml(message)}</div>` : ""}${content}</main></div>`, user?.displayName ?? "账户管理");
}
