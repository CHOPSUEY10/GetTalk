<script>
    import Icon from "./Icon.svelte";

    export let icon = "inbox";
    /** @type {'neutral' | 'primary' | 'danger' | 'warning'} */
    export let tone = "primary";
    export let title = "";
    export let description = "";

    const toneClasses = {
        primary: "bg-indigo-50 text-indigo-600 border-indigo-100",
        neutral: "bg-slate-100 text-slate-500 border-slate-200",
        danger: "bg-rose-50 text-rose-600 border-rose-200",
        warning: "bg-amber-50 text-amber-600 border-amber-200"
    };

    $: badgeStyle = toneClasses[tone] || toneClasses.primary;
</script>

<div class="bg-white rounded-2xl border border-slate-200 p-8 sm:p-10 text-center animate-fadeIn">
    <div class="w-14 h-14 rounded-2xl border {badgeStyle} flex items-center justify-center mx-auto mb-4 shadow-xs">
        <Icon name={icon} size="lg" />
    </div>
    {#if title}
        <h3 class="font-bold text-slate-900 text-base mb-1.5">{title}</h3>
    {/if}
    {#if description}
        <p class="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
            {description}
        </p>
    {/if}
    {#if $$slots.default}
        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <slot />
        </div>
    {/if}
</div>

