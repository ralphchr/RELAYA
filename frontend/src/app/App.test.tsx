import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@relaya/contracts";
import { App } from "./App.js";
import { mockServices } from "../services/mock/index.js";
import { DEFAULT_SETTINGS, localData } from "../services/localData.js";
import { scriptedReconstruction } from "../services/mock/scenario.js";
import type { AgentJoinProblem, Services } from "../services/types.js";

afterEach(() => cleanup());
beforeEach(() => sessionStorage.clear());

const testServices = (): Services => ({
  ...mockServices,
  account: { getMe: async () => ({ displayName: "Dana Cruz", firstName: "Dana", initials: "D", avatarUrl: null, email: null, phone: null, signedIn: true, agentDisplayName: null, settings: DEFAULT_SETTINGS, plan: { name: "Free plan", agentSessionsLeft: 8, agentSessionsTotal: 8, agentMinutesLeft: 240, sentencesLeft: 60, sentencesTotal: 60, resetsOn: "Nov 1" } }) },
  sessions: { create: async () => ({ id: "s1" }), end: async () => undefined },
  pipeline: {
    ...mockServices.pipeline,
    reconstruct: async () => scriptedReconstruction("r1"),
    reconstructTranscript: async ({ transcript }) => {
      const result = scriptedReconstruction("r2");
      const text = `The corrected transcript is: ${transcript}`;
      return {
        ...result,
        transcript,
        sentence: { ...result.sentence, text, literal: transcript, wordCount: text.split(/\s+/).length },
        guard: { ...result.guard, status: "clear", risk: "low", needsVerify: false, issues: [], kept: [] },
      };
    },
  },
});

function renderAt(path: string, services = testServices()) {
  // CI may load the developer's local Supabase env, which enables the route guard.
  // These tests exercise guest-preview UI, not Supabase authentication itself.
  sessionStorage.setItem("relaya.guestPreview", "1");
  window.history.pushState({}, "", path);
  return render(<App services={services} />);
}

describe("web app", () => {
  it.each([
    ["Japanese and English", "japanese_english"],
    ["Mandarin Chinese and English", "mandarin_english"],
    ["Spanish and English", "spanish_english"],
  ])("lets the user select and save %s", async (label, mode) => {
    const services = testServices();
    const updateSettings = vi.fn(async () => undefined);
    services.data = { ...localData, updateSettings };
    renderAt("/settings/preferences", services);
    fireEvent.click(await screen.findByRole("combobox", { name: "Spoken languages" }));
    fireEvent.click(screen.getByRole("option", { name: label }));
    expect(screen.getByRole("combobox", { name: "Spoken languages" })).toHaveTextContent(label);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("Preferences saved.")).toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ languageMode: mode }));
  });

  it.each([
    { code: "ja", label: "Japanese", transcript: "たぶん来週までに完了します。" },
    { code: "zh", label: "Mandarin Chinese", transcript: "我们可能下周完成。" },
    { code: "es", label: "Spanish", transcript: "Tal vez terminemos la próxima semana." },
  ] as const)("shows $label input and English output for review before delivery", async ({ code, label, transcript }) => {
    const services = testServices();
    const sentence = "We will probably finish next week.";
    services.pipeline = { ...services.pipeline, reconstruct: async () => {
      const result = scriptedReconstruction("r1");
      return { ...result, transcript, languages: [code], sentence: { ...result.sentence, text: sentence, literal: transcript },
        guard: { status: "unsure", risk: "high", needsVerify: true, issues: [], kept: [] } };
    } };
    services.createRecorder = () => ({ warmUp: vi.fn(async () => undefined), start: vi.fn(async () => undefined), stop: vi.fn(async () => ({ blob: new Blob(["x"]), durationMs: 2000 })), cancel: vi.fn(), dispose: vi.fn() });
    renderAt("/session/s1", services);
    fireEvent.pointerDown(await screen.findByRole("button", { name: /Hold to speak/ }), { pointerId: 1 });
    fireEvent.pointerUp(await screen.findByRole("button", { name: /Release to finish/ }), { pointerId: 1 });
    expect(await screen.findByText("Review translation")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(transcript)).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve & say it/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(screen.getByText("Reviewed by you")).toBeInTheDocument();
    expect(screen.queryByText("Checked")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve & say it/ }));
    expect(screen.getByText("Read it aloud")).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("shows the public landing page at /", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: /Speak clearly, in your own words/i })).toBeInTheDocument();
    expect(document.querySelector(".header-cta")).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
    expect(screen.getByRole("link", { name: "Ways to use Relaya" })).toHaveAttribute("href", "#ways-to-use");
  });

  it("Speak for me asks for a meeting link and rejects non-Meet links", async () => {
    renderAt("/new");
    fireEvent.click(await screen.findByRole("radio", { name: /Speak for me/ }));
    fireEvent.change(await screen.findByLabelText("Meeting link"), { target: { value: "https://zoom.us/j/12345678901?pwd=abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Send my Relaya/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Zoom and Teams are coming soon");
  });

  it("won't start a session until the microphone is allowed", async () => {
    const getUserMedia = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    renderAt("/new");
    expect(await screen.findByRole("alert")).toHaveTextContent("Relaya can't hear you");
    expect(screen.getByRole("button", { name: /Start session/ })).toBeDisabled();
    getUserMedia.mockResolvedValue({ getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream);
    fireEvent.click(screen.getByRole("button", { name: "Turn on mic" }));
    expect(await screen.findByRole("button", { name: /Mic ready/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start session/ })).toBeEnabled();
    getUserMedia.mockRestore();
  });

  it("explains a bot name mismatch and links to Google name settings", async () => {
    let report: (s: AgentStatus, why?: { kind: AgentJoinProblem; message: string }) => void = () => undefined;
    const services = testServices();
    services.agent = { ...mockServices.agent, join: (_i, onStatus) => { report = onStatus; return { agentSessionId: "a1", cancel: () => undefined }; } };
    sessionStorage.setItem("relaya.draft", JSON.stringify({ mode: "speak", meeting: { url: "https://meet.google.com/kqv-xmtp-ruz", code: "kqv-xmtp-ruz" } }));
    renderAt("/new/joining", services);
    await screen.findByText("Preparing Relaya to join…");
    act(() => report("failed", { kind: "bot_name_mismatch", message: "Google Meet would show Demo instead of RELAYA AI." }));
    expect(screen.getByRole("heading", { name: "Set your bot's Google name before joining" })).toBeInTheDocument();
    expect(screen.getByText("Google Meet would show Demo instead of RELAYA AI.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Google name settings" })).toHaveAttribute("href", "https://myaccount.google.com/name");
    expect(screen.queryByRole("button", { name: /Start session/ })).not.toBeInTheDocument();
  });

  it("joining shows the host-admitted state, then starts the session", async () => {
    let report: (s: AgentStatus) => void = () => undefined;
    const services = testServices();
    const join = vi.fn<Services["agent"]["join"]>((_i, onStatus) => { report = onStatus; return { agentSessionId: "a1", cancel: () => undefined }; });
    services.agent = { ...mockServices.agent, join };
    sessionStorage.setItem("relaya.draft", JSON.stringify({ mode: "speak", meeting: { url: "https://meet.google.com/kqv-xmtp-ruz", code: "kqv-xmtp-ruz" } }));
    renderAt("/new/joining", services);
    expect(await screen.findByText("Preparing Relaya to join…")).toBeInTheDocument();
    expect(join).toHaveBeenCalledWith(expect.objectContaining({ displayName: "RELAYA AI" }), expect.any(Function));
    act(() => report("admitted"));
    expect(await screen.findByText("RELAYA AI is in the meeting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start session/ }));
    expect(await screen.findByRole("button", { name: /Hold to speak/ })).toBeInTheDocument();
  });

  it("in-call panel: record, Context Guard blocks approve, keep the fix, approve, read aloud", async () => {
    const recorder = { warmUp: vi.fn(async () => undefined), start: vi.fn(async () => undefined), stop: vi.fn(async () => ({ blob: new Blob(["x"]), durationMs: 2000 })), cancel: vi.fn(), dispose: vi.fn() };
    renderAt("/session/s1", { ...testServices(), createRecorder: () => recorder });

    const hold = await screen.findByRole("button", { name: /Hold to speak/ });
    expect(screen.getByText(/started Relaya/)).toBeInTheDocument();
    fireEvent.pointerDown(hold, { pointerId: 1 });
    expect(await screen.findByRole("button", { name: /Release to finish/ })).toBeInTheDocument();
    fireEvent.pointerUp(screen.getByRole("button", { name: /Release to finish/ }), { pointerId: 1 });

    expect(await screen.findByText("1 to check")).toBeInTheDocument();
    // Not approvable yet: it only brings the highlight's choices into view.
    const waiting = screen.getByRole("button", { name: /Check the highlight first/ });
    expect(waiting).toHaveClass("is-waiting");
    fireEvent.click(waiting);
    expect(screen.getByRole("button", { name: /Check the highlight first/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep “might”/ }));
    const approve = screen.getByRole("button", { name: /Approve & say it/ });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(screen.getByText("Read it aloud")).toBeInTheDocument();
    expect(screen.getByText(/It might be safer to present on Monday/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/said the sentence in their own voice/)).toBeInTheDocument();
  });

  it("corrects what Relaya heard and lets the user discreetly edit the final sentence", async () => {
    const recorder = { warmUp: vi.fn(async () => undefined), start: vi.fn(async () => undefined), stop: vi.fn(async () => ({ blob: new Blob(["x"]), durationMs: 2000 })), cancel: vi.fn(), dispose: vi.fn() };
    renderAt("/session/s1", { ...testServices(), createRecorder: () => recorder });
    const hold = await screen.findByRole("button", { name: /Hold to speak/ });
    fireEvent.pointerDown(hold, { pointerId: 1 });
    fireEvent.pointerUp(await screen.findByRole("button", { name: /Release to finish/ }), { pointerId: 1 });

    fireEvent.click(await screen.findByRole("button", { name: "Correct what Relaya heard" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Correct what Relaya heard" }), { target: { value: "I meant their office is ready." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("I meant their office is ready.")).toBeInTheDocument();
    expect(screen.getByText("The corrected transcript is: I meant their office is ready.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit what Relaya will say" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit what Relaya will say" }), { target: { value: "The main payments flow is ready, but refunds are not tested yet." } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(screen.getByText("Edited by you")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve & say it/ }));
    expect(screen.getByText("The main payments flow is ready, but refunds are not tested yet.")).toBeInTheDocument();
  });

  it("account menu links to the profile page with the user's details", async () => {
    renderAt("/new");
    fireEvent.click(await screen.findByRole("button", { name: /Dana Cruz/ }));
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "Your profile", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile overview", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue("Dana Cruz");
    expect(screen.getByRole("heading", { name: "Recent communication" })).toBeInTheDocument();
  });

  it("asks before signing out to add an account", async () => {
    renderAt("/new");
    fireEvent.click(await screen.findByRole("button", { name: /Dana Cruz/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Dana Cruz/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add account" }));
    expect(screen.getByRole("heading", { name: "Add another account?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Add another account?" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("relaya.guestPreview")).toBe("1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out & continue" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Relaya" })).toBeInTheDocument();
    expect(sessionStorage.getItem("relaya.guestPreview")).toBeNull();
  });

  it("renders a not-found page for unknown routes", () => {
    renderAt("/unknown");
    expect(screen.getByRole("heading", { name: /page not found/i, level: 2 })).toBeInTheDocument();
  });
});
