import React, { createRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioPlayer } from "../../src/ui/AudioPlayer.js";

describe("UI Primitive: AudioPlayer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders custom player container and underlying audio element without native controls", () => {
    const audioRef = createRef<HTMLAudioElement>();
    render(<AudioPlayer ref={audioRef} src="blob:http://localhost/test.mp3" />);

    const container = screen.getByRole("region", { name: "语音合成播放器" });
    expect(container).toBeDefined();
    expect(container.classList.contains("audio-player")).toBe(true);

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute("controls")).toBe(false);
    expect(audio?.src).toContain("blob:http://localhost/test.mp3");

    // Forwarded ref points to the audio element
    expect(audioRef.current).toBe(audio);
  });

  it("renders custom play button, initial time display, seek slider, and mute button", () => {
    render(<AudioPlayer src="blob:http://localhost/test.mp3" />);

    const playBtn = screen.getByRole("button", { name: "播放" });
    expect(playBtn).toBeDefined();

    // Before duration is loaded, displays 0:00 / --:--
    const timeDisplay = screen.getByLabelText("播放时间");
    expect(timeDisplay.textContent).toContain("0:00 / --:--");

    // Seek slider is initially disabled because duration is not finite
    const seekSlider = screen.getByLabelText("音频时间进度条") as HTMLInputElement;
    expect(seekSlider.disabled).toBe(true);

    const muteBtn = screen.getByRole("button", { name: "静音" });
    expect(muteBtn).toBeDefined();
  });

  it("toggles play/pause state when clicked", async () => {
    const user = userEvent.setup();
    const playMock = vi.fn().mockResolvedValue(undefined);
    const pauseMock = vi.fn();
    window.HTMLMediaElement.prototype.play = playMock;
    window.HTMLMediaElement.prototype.pause = pauseMock;

    render(<AudioPlayer src="blob:http://localhost/test.mp3" />);

    const playBtn = screen.getByRole("button", { name: "播放" });
    await user.click(playBtn);
    expect(playMock).toHaveBeenCalled();

    // Simulate audio 'play' event
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "paused", { value: false, configurable: true });
    fireEvent.play(audio);

    expect(screen.getByRole("button", { name: "暂停" })).toBeDefined();

    const pauseBtn = screen.getByRole("button", { name: "暂停" });
    await user.click(pauseBtn);
    expect(pauseMock).toHaveBeenCalled();

    // Simulate audio 'pause' event
    Object.defineProperty(audio, "paused", { value: true, configurable: true });
    fireEvent.pause(audio);
    expect(screen.getByRole("button", { name: "播放" })).toBeDefined();
  });

  it("updates duration and enables seek slider when metadata is loaded", () => {
    render(<AudioPlayer src="blob:http://localhost/test.mp3" />);

    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { value: 65, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 10, configurable: true });

    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    const timeDisplay = screen.getByLabelText("播放时间");
    expect(timeDisplay.textContent).toBe("0:10 / 1:05");

    const seekSlider = screen.getByLabelText("音频时间进度条") as HTMLInputElement;
    expect(seekSlider.disabled).toBe(false);
    expect(seekSlider.max).toBe("65");
    expect(seekSlider.value).toBe("10");
  });

  it("toggles mute state when mute button is clicked", async () => {
    const user = userEvent.setup();
    render(<AudioPlayer src="blob:http://localhost/test.mp3" />);

    const audio = document.querySelector("audio")!;
    expect(audio.muted).toBe(false);

    const muteBtn = screen.getByRole("button", { name: "静音" });
    await user.click(muteBtn);

    expect(audio.muted).toBe(true);
    expect(screen.getByRole("button", { name: "取消静音" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "取消静音" }));
    expect(audio.muted).toBe(false);
  });

  it("renders download button with filename and download URL when provided", () => {
    render(
      <AudioPlayer
        src="blob:http://localhost/test.mp3"
        downloadUrl="blob:http://localhost/download.mp3"
        downloadFilename="test_output.mp3"
      />,
    );

    const downloadLink = screen.getByRole("link", { name: "下载合成音频" });
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe("blob:http://localhost/download.mp3");
    expect(downloadLink.getAttribute("download")).toBe("test_output.mp3");
  });
});
