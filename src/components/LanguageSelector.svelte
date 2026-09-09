<script>
  import { locale } from 'svelte-i18n';

  const ACTIVE_CLASSES = 'bg-white/10 text-white shadow-md';
  const IDLE_CLASSES = 'text-neutral-500 hover:text-neutral-300';
  const BUTTON_CLASSES =
    'px-3.5 py-1 text-[10px] sm:text-xs font-semibold tracking-wider rounded-full transition-all duration-300 ease-out focus:outline-none cursor-pointer';

  /**
   * Switch the active locale.
   * @param {'en' | 'es'} code
   */
  function setLocale(code) {
    locale.set(code);
  }
</script>

<div class="inline-flex items-center gap-1.5 p-1 bg-[#0f0f13]/80 backdrop-blur-md border border-white/5 rounded-full select-none shadow-lg transition-all duration-300" role="group" aria-label="Language">
  <button
    type="button"
    class="{BUTTON_CLASSES} {$locale === 'en' ? ACTIVE_CLASSES : IDLE_CLASSES}"
    onclick={() => setLocale('en')}
    aria-pressed={$locale === 'en'}
  >
    EN
  </button>
  <button
    type="button"
    class="{BUTTON_CLASSES} {$locale === 'es' ? ACTIVE_CLASSES : IDLE_CLASSES}"
    onclick={() => setLocale('es')}
    aria-pressed={$locale === 'es'}
  >
    ES
  </button>
</div>
