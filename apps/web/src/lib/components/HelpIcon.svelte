<script lang="ts">
  /**
   * Small (i) help icon with a click + hover popover. Use anywhere a
   * field label needs a sentence of context.
   *
   * Usage:
   *   <HelpIcon label="What is chemistry class?" text="HRAC mode-of-action group …" />
   */
  let {
    label,
    text
  }: {
    label: string;
    text: string;
  } = $props();

  let open = $state(false);
</script>

<span class="help" class:open>
  <button
    type="button"
    class="help-icon"
    aria-label={label}
    aria-expanded={open}
    onclick={() => (open = !open)}
    onblur={() => (open = false)}>ⓘ</button
  >
  <span class="help-popover" role="tooltip">{text}</span>
</span>

<style>
  .help {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  button.help-icon {
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    min-width: 18px;
    min-height: 18px;
    border-radius: 50%;
    background: #e7f1ea;
    color: #1f5e3a;
    font-size: 0.7rem;
    font-weight: 700;
    font-family: inherit;
    line-height: 1;
    padding: 0;
    margin: 0;
    border: 1px solid #b3d4bf;
    cursor: pointer;
    flex: 0 0 auto;
  }
  button.help-icon:hover {
    background: #d4e5db;
  }
  button.help-icon:focus-visible {
    outline: 2px solid #1f5e3a;
    outline-offset: 1px;
  }
  .help-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    width: 280px;
    max-width: calc(100vw - 32px);
    background: #1f2d24;
    color: #fff;
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
    font-size: 0.78rem;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    visibility: hidden;
    opacity: 0;
    transition:
      opacity 0.12s ease,
      visibility 0.12s ease;
    pointer-events: none;
    white-space: normal;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
  }
  .help-popover::before {
    content: '';
    position: absolute;
    top: -5px;
    left: 6px;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 5px solid #1f2d24;
  }
  .help:hover .help-popover,
  .help:focus-within .help-popover,
  .help.open .help-popover {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }
</style>
