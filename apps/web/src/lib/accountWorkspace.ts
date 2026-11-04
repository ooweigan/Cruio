import { computed, ref, shallowRef } from "vue";
import { freezeAccountContext, getAccountContext } from "@/lib/accountTransport";

type AccountWorkspace = {
  dirty: () => boolean;
  busy: () => boolean;
  save: () => Promise<void>;
  cancel: () => void;
};

const workspace = shallowRef<AccountWorkspace>();
const savingAccountWork = ref(false);
export const accountWorkFinished = ref(false);
export const hasUnsavedAccountWork = computed(() => !accountWorkFinished.value && !!workspace.value?.dirty());

export function resetAccountWork() {
  accountWorkFinished.value = false;
}

export function registerAccountWorkspace(value: AccountWorkspace) {
  workspace.value = value;
  accountWorkFinished.value = false;
  return () => {
    if (workspace.value === value) workspace.value = undefined;
  };
}

async function completeAccountWork(finish: boolean, discard: boolean) {
  if (accountWorkFinished.value) return;
  if (savingAccountWork.value) throw new Error("当前内容正在保存，请稍后重试。");
  const current = workspace.value;
  const context = getAccountContext();
  if (current?.busy()) throw new Error("文件正在处理中，请稍后重试。");
  savingAccountWork.value = true;
  try {
    if (!discard) await current?.save();
    if (workspace.value !== current || getAccountContext() !== context) throw new Error("账号或项目已切换，请重新保存当前内容。");
    if (finish) {
      current?.cancel();
      freezeAccountContext();
      accountWorkFinished.value = true;
    }
  } finally {
    savingAccountWork.value = false;
  }
}

export function saveAccountWork() {
  return completeAccountWork(false, false);
}

export function finishAccountWork(discard: boolean) {
  return completeAccountWork(true, discard);
}
