<script>
  import { onMount } from "svelte";
  import { push } from "svelte-spa-router";
  import { authStore } from "../stores/auth.store.js";
  import { userStore } from "../stores/user.store.js";
  import AppShell from "../components/layout/AppShell.svelte";
  import Icon from "../components/common/Icon.svelte";
  import ProfileSettingsSection from "../components/auth/ProfileSettingsSection.svelte";
  import PrivacySettingsSection from "../components/auth/PrivacySettingsSection.svelte";
  import SecurityMfaSection from "../components/auth/SecurityMfaSection.svelte";
  import ActiveSessionsSection from "../components/auth/ActiveSessionsSection.svelte";
  import BlockedUsersSection from "../components/auth/BlockedUsersSection.svelte";

  export let params = {};
  export let initialTab = "profile";

  const TABS = [
    {
      id: "profile",
      label: "Profil & Akun",
      description: "Nickname, username, bio, dan email",
      icon: "user",
    },
    {
      id: "privacy",
      label: "Privasi Chat",
      description: "Last seen, centang biru, timer pesan",
      icon: "eye",
    },
    {
      id: "security",
      label: "Keamanan & MFA",
      description: "Kata sandi, TOTP MFA, kunci E2EE",
      icon: "shield",
    },
    {
      id: "sessions",
      label: "Sesi Aktif",
      description: "Perangkat login & pencabutan sesi",
      icon: "monitor",
    },
    {
      id: "blocked",
      label: "Pengguna Diblokir",
      description: "Kelola daftar blokir pengguna",
      icon: "ban",
    },
  ];

  const VALID_TAB_IDS = new Set(TABS.map((t) => t.id));

  let activeTab = VALID_TAB_IDS.has(params?.tab) ? params.tab : initialTab;

  $: if (params?.tab && VALID_TAB_IDS.has(params.tab)) {
    activeTab = params.tab;
  }

  onMount(async () => {
    try {
      const profile = await userStore.loadProfile();
      if (profile) {
        authStore.updateUser({
          ...($authStore.user || {}),
          ...profile,
        });
      }
    } catch {
      // Handled in store
    }
  });

  function selectTab(tabId) {
    activeTab = tabId;
    userStore.clearError();
    push(`/settings/${tabId}`);
  }
</script>

<AppShell activeNav="settings">
  <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
    <div class="mx-auto max-w-5xl">
      <!-- Page Header -->
      <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-slate-900 dark:text-white">
            Pengaturan Akun, Keamanan & Privasi
          </h1>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Kelola profil tampilan, privasi ruang obrolan, autentikasi dua faktor, perangkat aktif, dan keamanan kunci E2EE.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- Responsive Tab Navigation -->
        <nav
          aria-label="Kategori Pengaturan"
          class="lg:col-span-4 flex lg:flex-col gap-1.5 overflow-x-auto pb-2 lg:pb-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xs"
        >
          {#each TABS as tab (tab.id)}
            <button
              type="button"
              on:click={() => selectTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              class="flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors shrink-0 lg:w-full cursor-pointer {activeTab === tab.id
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'}"
            >
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 {activeTab === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}"
              >
                <Icon name={tab.icon} size="sm" />
              </div>
              <div class="min-w-0">
                <p class="text-xs font-bold truncate">{tab.label}</p>
                <p class="hidden sm:block text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                  {tab.description}
                </p>
              </div>
            </button>
          {/each}
        </nav>

        <!-- Active Tab Content -->
        <div class="lg:col-span-8 min-w-0">
          {#if activeTab === "profile"}
            <ProfileSettingsSection />
          {:else if activeTab === "privacy"}
            <PrivacySettingsSection />
          {:else if activeTab === "security"}
            <SecurityMfaSection />
          {:else if activeTab === "sessions"}
            <ActiveSessionsSection />
          {:else if activeTab === "blocked"}
            <BlockedUsersSection />
          {/if}
        </div>
      </div>
    </div>
  </div>
</AppShell>

