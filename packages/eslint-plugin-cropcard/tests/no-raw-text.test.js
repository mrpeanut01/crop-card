import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import plugin from "../index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The Svelte parser comes from the web app's eslint-plugin-svelte, so this
// package needs no dependency of its own on svelte.
const sveltePlugin = await import(
  new URL(
    "../../../apps/web/node_modules/eslint-plugin-svelte/lib/index.js",
    import.meta.url,
  )
);
const svelteParser = sveltePlugin.default.configs["flat/base"].find(
  (c) => c.languageOptions?.parser,
).languageOptions.parser;

const rule = plugin.rules["no-raw-text"];
const WORDS = ["CropCard", "GPA", "ft", "oz", "d", "h", "CSV", "PDF", "°F"];

const ruleTester = new RuleTester({
  languageOptions: {
    parser: svelteParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

const file = (code) => ({ code, filename: "Test.svelte" });

ruleTester.run("no-raw-text", rule, {
  valid: [
    file(`<span>{tr('nav.today')}</span>`),
    file(`<a aria-label={tr('nav.home')} href="/">{label}</a>`),
    file(`<p>   </p>`),
    file(`<span>· → 3</span>`),
    file(`<input placeholder={name} />`),
    file(`<div class="brand serif" data-x="Hello" href="/today"></div>`),
    file(`<style>.a { font-family: Helvetica; }</style>`),
    file(`<script>const label = 'Today';</script><span>{label}</span>`),
    {
      ...file(`<a class="brand">CropCard</a>`),
      options: [{ allow: ["CropCard"] }],
    },
    {
      ...file(`<div title="Plain">x</div>`),
      options: [{ attributes: ["placeholder"], allow: ["x"] }],
    },
    {
      ...file(`<span>{n} GPA · 12 ft</span>`),
      options: [{ allowWords: WORDS }],
    },
    {
      ...file(`<span>(3 d) · CSV, PDF</span>`),
      options: [{ allowWords: WORDS }],
    },
    { ...file(`<span>80 °F</span>`), options: [{ allowWords: WORDS }] },
    file(`<span>/plugins plugins/fungicides/</span>`),
    file(`<span>https://console.anthropic.com/settings</span>`),
    file(`<span>wheatscab.psu.edu ↗</span>`),
    file(`<code>complianceFlags</code>`),
    file(`<pre>sha256(plaintext)</pre>`),
    file(`<p><kbd>Ctrl</kbd> <samp>FeatureCollection</samp> {x}</p>`),
    file(
      `<div lang="en" data-english-only="safety"><strong>STOP</strong> do not spray</div>`,
    ),
    file(
      `<p lang="en" data-english-only="regulatory" title="7 CFR 205.238">Quote <span aria-label="Rule text">x</span></p>`,
    ),
    file(
      `<div lang="en" data-english-only="safety"><Pill>Hold eggs</Pill></div>`,
    ),
    file(`<span lang="en">{label}</span>`),
    {
      ...file(`<div lang="en" data-english-only="hazard">Danger</div>`),
      options: [{ reasons: ["hazard"] }],
    },
  ],
  invalid: [
    {
      ...file(`<span>Today</span>`),
      errors: [{ messageId: "rawText", data: { text: "Today" } }],
    },
    {
      ...file(`<p>Hi {name}, welcome</p>`),
      errors: [
        { messageId: "rawText", data: { text: "Hi" } },
        { messageId: "rawText", data: { text: ", welcome" } },
      ],
    },
    {
      ...file(`<button aria-label="More pages">x</button>`),
      options: [{ allow: ["x"] }],
      errors: [
        {
          messageId: "rawAttribute",
          data: { name: "aria-label", text: "More pages" },
        },
      ],
    },
    {
      ...file(`<Section title="Profile" sub="Ignored" />`),
      errors: [
        { messageId: "rawAttribute", data: { name: "title", text: "Profile" } },
      ],
    },
    {
      ...file(`<input placeholder="Farm name {n}" />`),
      errors: [
        {
          messageId: "rawAttribute",
          data: { name: "placeholder", text: "Farm name" },
        },
      ],
    },
    {
      ...file(`<svelte:head><title>Account · CropCard</title></svelte:head>`),
      errors: [{ messageId: "rawText" }],
    },
    {
      ...file(`<span>Señal</span>`),
      errors: [{ messageId: "rawText", data: { text: "Señal" } }],
    },
    {
      ...file(`<span>Every 3 days</span>`),
      options: [{ allowWords: WORDS }],
      errors: [{ messageId: "rawText", data: { text: "Every 3 days" } }],
    },
    {
      ...file(`<span>ac</span>`),
      options: [{ allowWords: WORDS }],
      errors: [{ messageId: "rawText", data: { text: "ac" } }],
    },
    {
      ...file(`<span lang="en">Hold eggs</span>`),
      errors: [{ messageId: "rawText", data: { text: "Hold eggs" } }],
    },
    {
      ...file(`<div data-english-only="safety">STOP</div>`),
      errors: [
        { messageId: "missingLang" },
        { messageId: "rawText", data: { text: "STOP" } },
      ],
    },
    {
      ...file(`<div lang="en" data-english-only="because">STOP</div>`),
      errors: [
        {
          messageId: "badReason",
          data: { reason: "because", allowed: "safety, regulatory" },
        },
        { messageId: "rawText", data: { text: "STOP" } },
      ],
    },
    {
      ...file(`<div lang="en" data-english-only>STOP</div>`),
      errors: [{ messageId: "badReason" }, { messageId: "rawText" }],
    },
    {
      ...file(`<div lang={l} data-english-only="safety">STOP</div>`),
      errors: [{ messageId: "missingLang" }, { messageId: "rawText" }],
    },
    {
      ...file(`<Pill lang="en" data-english-only="safety">Hold</Pill>`),
      errors: [
        { messageId: "onComponent" },
        { messageId: "rawText", data: { text: "Hold" } },
      ],
    },
    {
      ...file(`<div lang="en" data-english-only="safety"></div><p>Outside</p>`),
      errors: [{ messageId: "rawText", data: { text: "Outside" } }],
    },
  ],
});
