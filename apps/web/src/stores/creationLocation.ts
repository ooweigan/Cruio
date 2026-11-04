import axios from "axios";
import { ref } from "vue";
import { getAccountContext } from "@/lib/accountTransport";

export const creationLocation = ref<{ directory: string | null; available: boolean; legacyAssets?: string | null }>({ directory: null, available: false });

export async function loadCreationLocation() {
  const context = getAccountContext();
  const { data } = await axios.get("/api/workspaces/location/get", { headers: { "x-toonflow-workspace": "1" } });
  if (context !== getAccountContext()) throw new Error("账户已切换，请重新加载");
  creationLocation.value = data.data;
}

export async function saveCreationLocation(directory: string) {
  const context = getAccountContext();
  const { data } = await axios.put("/api/workspaces/location/save", { directory }, { headers: { "x-toonflow-workspace": "1" } });
  if (context !== getAccountContext()) throw new Error("账户已切换，请重新加载");
  creationLocation.value = data.data;
}
