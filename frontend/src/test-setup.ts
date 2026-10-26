import "@testing-library/jest-dom/vitest";

// jsdom has no microphone. Pages that check it as they open get one that works.
if (!navigator.mediaDevices) {
  const track = { label: "Test microphone", stop: () => undefined };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  });
}
