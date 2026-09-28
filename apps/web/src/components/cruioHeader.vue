<template>
  <header class="appHeader">
    <button class="brandButton" type="button" @click="router.push('/projects')">
      <span class="brandMark">C</span>
      <span class="brandName">CRUIO</span>
    </button>

    <nav aria-label="主导航">
      <router-link to="/projects">项目</router-link>
      <router-link to="/workflows">工作流</router-link>
    </nav>

    <div class="accountArea">
      <span>{{ session.user?.email }}</span>
      <button type="button" class="textButton" @click="logout">退出</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useCruioSession } from "@/stores/cruioSession";

const router = useRouter();
const session = useCruioSession();

async function logout() {
  await session.signOut();
  await router.replace("/login");
}
</script>

<style scoped lang="scss">
.appHeader {
  width: min(100% - 40px, 1320px);
  height: 76px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid var(--cr-line);
}

.brandButton {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  color: var(--cr-ink);
  background: transparent;
  cursor: pointer;
}

.brandMark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px 8px 8px 2px;
  color: #28242e;
  background: var(--cr-gradient);
  font-family: Georgia, serif;
  font-size: 1.05rem;
}

.brandName { font-size: .86rem; font-weight: 780; letter-spacing: .16em; }
nav a { padding: 9px 12px; border-radius: 7px; color: var(--cr-muted); text-decoration: none; font-size: .86rem; font-weight: 650; }
nav a.router-link-active { color: var(--cr-ink); background: var(--cr-soft); }
.accountArea { justify-self: end; display: flex; align-items: center; gap: 14px; color: var(--cr-muted); font-size: .78rem; }
.textButton { border: 0; color: var(--cr-violet); background: transparent; font: inherit; font-weight: 650; cursor: pointer; }

@media (max-width: 680px) {
  .appHeader { width: min(100% - 24px, 1320px); grid-template-columns: 1fr auto; }
  nav, .accountArea > span { display: none; }
}
</style>
