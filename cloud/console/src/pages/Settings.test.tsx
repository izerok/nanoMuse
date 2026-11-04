import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangContext } from "../lib/i18n";
import type { Nudges, NudgesPolicy, Recommended, RuntimeSettings } from "../lib/types";
import { SettingsPage } from "./Settings";

const replies = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/hooks", () => ({
  useData: (url: string) => ({ data: replies.get(url), reload: () => {} }), invalidate: () => {},
}));
vi.mock("./common", () => ({ Loaded: ({ q, children }: { q: { data: unknown }; children: (data: unknown) => ReactNode }) => q.data === undefined ? null : children(q.data) }));
const runtime: RuntimeSettings = {
  values: { allowance_cny: 10, invite_bonus_cny: 5, signup_open: true },
  env: { allowance_cny: 10, invite_bonus_cny: 5, signup_open: true },
  overridden: { allowance_cny: false, invite_bonus_cny: false, signup_open: false }, below_allowance: 0,
};
const policy: NudgesPolicy = {
  version: 1, star: {
    enabled: true, url: "https://github.com/nano-muse/nanoMuse", cooldown_days: 7, max_asks: 4,
    text: "original", text_zh: "", moments: { signed_in: true, tasks: [3, 10], new_look: true, exhausted: true, days_used: [7], goal_done: true },
  },
};
const nudges: Nudges = { nudges: policy, defaults: policy, stored: false, updated_at: null };
const rec: Recommended = {
  recommended: { chat: "model-a", gui: "model-a" },
  defaults: { chat: "model-a", gui: "model-a" },
  stored: false,
  updated_at: null,
  models: [
    { id: "model-a", kind: "chat", lanes: ["chat", "gui"] },
    { id: "model-b", kind: "chat", lanes: ["chat", "gui"] },
    { id: "pic-1", kind: "image", lanes: [] },
  ],
};
let screen: ReactTestRenderer | undefined;
const page = () => <LangContext.Provider value={{ lang: "en", setLang: () => {} }}><SettingsPage /></LangContext.Provider>;
const input = (value: string) => screen!.root.findAllByType("input").find((node) => node.props.value === value);
const selects = () => screen!.root.findAllByType("select");
beforeEach(() => { replies.clear(); });
afterEach(() => { if (screen) act(() => screen!.unmount()); screen = undefined; });

describe("settings polling while editing", () => {
  it("preserves both numeric drafts through an unchanged poll and accepts changed server values", async () => {
    replies.set("/v1/admin/settings", structuredClone(runtime));
    await act(async () => { screen = create(page()); });
    act(() => { input("10")!.props.onChange({ target: { value: "42" } }); input("5")!.props.onChange({ target: { value: "9" } }); });
    replies.set("/v1/admin/settings", structuredClone(runtime));
    await act(async () => { screen!.update(page()); });
    expect(input("42")).toBeDefined();
    expect(input("9")).toBeDefined();
    replies.set("/v1/admin/settings", { ...runtime, values: { ...runtime.values, allowance_cny: 20 } });
    await act(async () => { screen!.update(page()); });
    expect(input("20")).toBeDefined();
    expect(input("5")).toBeDefined();
  });

  it("preserves nudge text and task drafts through an unchanged poll, then loads a saved policy version", async () => {
    replies.set("/v1/admin/nudges", structuredClone(nudges));
    await act(async () => { screen = create(page()); });
    act(() => { input("original")!.props.onChange({ target: { value: "draft" } }); input("3, 10")!.props.onChange({ target: { value: "4, 12" } }); });
    replies.set("/v1/admin/nudges", structuredClone(nudges));
    await act(async () => { screen!.update(page()); });
    expect(input("draft")).toBeDefined();
    expect(input("4, 12")).toBeDefined();
    replies.set("/v1/admin/nudges", { ...nudges, nudges: { ...policy, version: 2 } });
    await act(async () => { screen!.update(page()); });
    expect(input("original")).toBeDefined();
    expect(input("3, 10")).toBeDefined();
  });

  it("shows the recommended model of each lane and keeps a changed pick in the draft", async () => {
    replies.set("/v1/admin/recommended", structuredClone(rec));
    await act(async () => { screen = create(page()); });
    expect(selects().map((s) => s.props.value)).toEqual(["model-a", "model-a"]);
    // the image model is not offered for either lane
    expect(selects()[0].findAllByType("option").map((o) => o.props.value)).toEqual(["", "model-a", "model-b"]);
    act(() => { selects()[0].props.onChange({ target: { value: "model-b" } }); });
    expect(selects().map((s) => s.props.value)).toEqual(["model-b", "model-a"]);
  });
});
