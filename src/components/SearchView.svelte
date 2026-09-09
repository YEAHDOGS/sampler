<!--
  DOGS Sampler — SearchView
  Roadmap milestone #1: the search UI wired to SampleSearchService.
  Search input → per-provider result cards → inline <audio> previews →
  license + attribution per hit, plus the BYO key settings panel
  (Freesound / Pixabay keys stored in the user's localStorage only).

  Owns its scroll region (overflow-y-auto): the app shell locks body
  scrolling for the landing page, so results scroll inside this view.
-->
<script>
  import { t } from "svelte-i18n";
  import { createEventDispatcher } from "svelte";
  import {
    SampleSearchService,
    getStoredKeys,
    saveKeys,
    clearKeys,
  } from "../lib/sampleService.js";
  import {
    formatDuration,
    licenseShort,
    groupResultsByProvider,
  } from "../lib/formatSamples.js";

  // ── Hoisted constants ──────────────────────────────────────────────
  const SEARCH_LIMIT = 24;
  const SEARCH_DEBOUNCE_MS = 450;
  const MAX_CARD_TAGS = 4;

  const dispatch = createEventDispatcher();
  const service = new SampleSearchService();

  // ── Search state ───────────────────────────────────────────────────
  let query = "";
  let searching = false;
  let searchedQuery = "";
  let buckets = [];
  let searchError = null;
  let debounceTimer = null;

  // ── Key settings state (BYO keys, device-local only) ────────────────
  let settingsOpen = false;
  let freesoundKey = getStoredKeys().freesound ?? "";
  let pixabayKey = getStoredKeys().pixabay ?? "";
  let settingsSaved = false;

  $: hasSearched = searchedQuery !== "";
  $: totalResults = buckets.reduce(
    (sum, bucket) => sum + bucket.results.length,
    0,
  );

  function scheduleSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    settingsSaved = false;
    debounceTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  }

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      buckets = [];
      searchedQuery = "";
      searching = false;
      searchError = null;
      return;
    }
    searching = true;
    searchError = null;
    try {
      const envelope = await service.searchAll(trimmed, {
        limit: SEARCH_LIMIT,
      });
      searchedQuery = envelope.query;
      buckets = groupResultsByProvider(envelope.results, envelope.providers);
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
      buckets = [];
      searchedQuery = trimmed;
    } finally {
      searching = false;
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (debounceTimer) clearTimeout(debounceTimer);
    runSearch();
  }

  function persistKeys() {
    saveKeys({
      freesound: freesoundKey.trim() ? freesoundKey.trim() : undefined,
      pixabay: pixabayKey.trim() ? pixabayKey.trim() : undefined,
    });
    settingsSaved = true;
  }

  function resetKeys() {
    clearKeys();
    freesoundKey = "";
    pixabayKey = "";
    settingsSaved = false;
  }

  function closeView() {
    dispatch("close");
  }
</script>

<section
  class="h-full w-full overflow-y-auto bg-[#050508] text-white"
  aria-label={$t("search.aria_view")}
>
  <div class="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-12 py-4 sm:py-6">
    <!-- View header: back, title, settings toggle -->
    <div class="flex items-center justify-between gap-3 mb-4 sm:mb-6">
      <button
        type="button"
        on:click={closeView}
        class="text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-neutral-400 hover:text-[#ff3344] transition-colors cursor-pointer"
      >
        ← {$t("search.back")}
      </button>
      <h2
        class="text-lg sm:text-xl md:text-2xl font-bold tracking-wider text-white"
      >
        {$t("search.title")}
      </h2>
      <button
        type="button"
        on:click={() => (settingsOpen = !settingsOpen)}
        aria-expanded={settingsOpen}
        aria-label={$t("search.settings_toggle")}
        class="text-neutral-400 hover:text-[#ff3344] transition-colors text-lg sm:text-xl cursor-pointer"
      >
        ⚙
      </button>
    </div>

    <!-- Search bar -->
    <form on:submit={handleSubmit} class="flex gap-2 mb-4 sm:mb-6">
      <input
        type="search"
        bind:value={query}
        on:input={scheduleSearch}
        placeholder={$t("search.placeholder")}
        aria-label={$t("search.aria_input")}
        autocomplete="off"
        class="flex-1 min-w-0 bg-[#0e0e12]/80 border border-white/10 focus:border-[#ff3344]/60 rounded-xl px-4 py-2.5 sm:py-3 text-sm sm:text-base text-white placeholder:text-neutral-600 outline-none transition-colors"
      />
      <button
        type="submit"
        disabled={searching}
        class="shrink-0 bg-[#ff3344] hover:bg-[#ff4455] disabled:opacity-50 disabled:cursor-wait text-white font-bold text-xs sm:text-sm uppercase tracking-widest rounded-xl px-4 sm:px-6 py-2.5 sm:py-3 transition-colors cursor-pointer"
      >
        {searching ? $t("search.searching") : $t("search.go")}
      </button>
    </form>

    <!-- Key settings panel (BYO keys, localStorage only — never committed) -->
    {#if settingsOpen}
      <div
        class="mb-4 sm:mb-6 p-4 bg-[#0e0e12]/60 border border-white/5 rounded-xl"
      >
        <h3 class="text-xs sm:text-sm font-bold tracking-wide mb-1">
          {$t("search.settings_title")}
        </h3>
        <p class="text-[10px] sm:text-xs text-neutral-500 mb-3 leading-relaxed">
          {$t("search.settings_note")}
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span
              class="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-neutral-400"
            >
              {$t("search.freesound_key")}
            </span>
            <input
              type="password"
              bind:value={freesoundKey}
              autocomplete="off"
              class="bg-black/40 border border-white/10 focus:border-[#ff3344]/60 rounded-lg px-3 py-2 text-xs sm:text-sm text-white outline-none transition-colors"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span
              class="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-neutral-400"
            >
              {$t("search.pixabay_key")}
            </span>
            <input
              type="password"
              bind:value={pixabayKey}
              autocomplete="off"
              class="bg-black/40 border border-white/10 focus:border-[#ff3344]/60 rounded-lg px-3 py-2 text-xs sm:text-sm text-white outline-none transition-colors"
            />
          </label>
        </div>
        <div class="flex items-center gap-3 mt-3">
          <button
            type="button"
            on:click={persistKeys}
            class="bg-[#ff3344] hover:bg-[#ff4455] text-white font-bold text-[11px] sm:text-xs uppercase tracking-widest rounded-lg px-4 py-2 transition-colors cursor-pointer"
          >
            {$t("search.save_keys")}
          </button>
          <button
            type="button"
            on:click={resetKeys}
            class="text-[11px] sm:text-xs font-semibold uppercase tracking-widest text-neutral-500 hover:text-white transition-colors cursor-pointer"
          >
            {$t("search.clear_keys")}
          </button>
          {#if settingsSaved}
            <span
              class="text-[11px] sm:text-xs text-emerald-400"
              role="status"
            >
              {$t("search.keys_saved")}
            </span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Status line -->
    {#if searchError}
      <p class="text-xs sm:text-sm text-[#ff3344] mb-4" role="alert">
        {$t("search.error", { values: { error: searchError } })}
      </p>
    {:else if searching}
      <p
        class="text-xs sm:text-sm text-neutral-500 mb-4 animate-pulse"
        role="status"
      >
        {$t("search.searching_for", { values: { query: query.trim() } })}
      </p>
    {:else if hasSearched}
      <p class="text-xs sm:text-sm text-neutral-500 mb-4">
        {$t("search.results_count", {
          values: { count: totalResults, query: searchedQuery },
        })}
      </p>
    {:else}
      <p class="text-xs sm:text-sm text-neutral-600 mb-4">
        {$t("search.hint")}
      </p>
    {/if}

    <!-- Results, grouped per provider -->
    {#each buckets as bucket (bucket.provider)}
      <div class="mb-6 sm:mb-8">
        <div class="flex items-baseline gap-2 mb-2 sm:mb-3">
          <h3
            class="text-sm sm:text-base font-bold tracking-wide text-white"
          >
            {bucket.label}
          </h3>
          {#if bucket.total !== null}
            <span class="text-[10px] sm:text-xs text-neutral-500">
              {$t("search.total", { values: { total: bucket.total } })}
            </span>
          {/if}
        </div>

        {#if bucket.error}
          <div
            class="p-3 sm:p-4 bg-[#0e0e12]/60 border border-white/5 rounded-xl text-[11px] sm:text-xs text-neutral-500 leading-relaxed"
          >
            {bucket.error}
          </div>
        {:else if bucket.provider === "local"}
          <p class="text-[10px] sm:text-xs text-neutral-600 mb-2 leading-relaxed">
            {$t("search.offline_hint")}
          </p>
        {/if}

        {#if bucket.results.length > 0}
          <div
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
          >
            {#each bucket.results as result (result.provider + ":" + result.id)}
              <article
                class="flex flex-col gap-2 p-3 sm:p-4 bg-[#0e0e12]/60 hover:bg-[#14141a]/80 border border-white/5 hover:border-[#ff3344]/30 rounded-xl transition-all duration-300"
              >
                <h4
                  class="text-xs sm:text-sm font-bold text-white leading-snug line-clamp-2"
                  title={result.title}
                >
                  {result.title}
                </h4>
                <div
                  class="flex items-center gap-2 text-[10px] sm:text-[11px] text-neutral-500"
                >
                  <span
                    class="font-mono text-neutral-400"
                    aria-label={$t("search.duration", {
                      values: { duration: formatDuration(result.duration) },
                    })}
                  >
                    {formatDuration(result.duration)}
                  </span>
                  <span
                    class="uppercase tracking-widest border border-white/10 rounded px-1.5 py-0.5 text-neutral-400"
                  >
                    {licenseShort(result.license)}
                  </span>
                </div>
                {#if result.previewUrl}
                  <audio
                    controls
                    preload="none"
                    src={result.previewUrl}
                    class="w-full h-8 accent-[#ff3344]"
                  >
                    {$t("search.audio_unsupported")}
                  </audio>
                {:else}
                  <p class="text-[10px] sm:text-[11px] text-neutral-600">
                    {$t("search.no_preview")}
                  </p>
                {/if}
                {#if result.tags.length > 0}
                  <p
                    class="text-[10px] text-neutral-600 leading-relaxed truncate"
                  >
                    {result.tags.slice(0, MAX_CARD_TAGS).join(" · ")}
                  </p>
                {/if}
                <a
                  href={result.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-auto text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest text-neutral-500 hover:text-[#ff3344] transition-colors"
                >
                  {$t("search.attribution")} ↗
                </a>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if hasSearched && !searching && totalResults === 0 && !searchError}
      <div class="text-center py-8 sm:py-12">
        <p class="text-sm sm:text-base text-neutral-400 mb-1">
          {$t("search.no_results")}
        </p>
        <p class="text-[11px] sm:text-xs text-neutral-600">
          {$t("search.no_results_hint")}
        </p>
      </div>
    {/if}
  </div>
</section>
