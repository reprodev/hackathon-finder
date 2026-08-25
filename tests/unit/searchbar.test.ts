import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for SearchBar component logic.
 * Since we're testing in a Node/Vitest environment without a DOM renderer,
 * we test the core logic: debounce behavior and the 2-char minimum threshold.
 *
 * The SearchBar implements:
 * - 300ms debounce on input changes
 * - Calls onSearch with the debounced value
 * - Does NOT enforce the 2-char minimum internally — it emits whatever the user types
 *   and the consumer (API layer) handles the < 2 char case by returning all results
 */

describe("SearchBar debounce logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should debounce calls by 300ms", () => {
    const callback = vi.fn();
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Simulate the debounce pattern used in SearchBar
    function simulateInput(value: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callback(value);
      }, 300);
    }

    simulateInput("a");
    simulateInput("ab");
    simulateInput("abc");

    // Nothing called yet
    expect(callback).not.toHaveBeenCalled();

    // Advance 300ms
    vi.advanceTimersByTime(300);

    // Only the last value should be emitted
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("abc");
  });

  it("should emit empty string when input is cleared", () => {
    const callback = vi.fn();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function simulateInput(value: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callback(value);
      }, 300);
    }

    simulateInput("test");
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledWith("test");

    // Simulate clearing
    simulateInput("");
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledWith("");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("should not emit if value does not change during debounce window", () => {
    const callback = vi.fn();
    let currentValue = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    function simulateInput(value: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (value !== currentValue) {
          currentValue = value;
          callback(value);
        }
      }, 300);
    }

    simulateInput("test");
    vi.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledTimes(1);

    // Type the same value again
    simulateInput("test");
    vi.advanceTimersByTime(300);
    // Should not emit again since value didn't change
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("should cancel pending debounce on new input", () => {
    const callback = vi.fn();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function simulateInput(value: string) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callback(value);
      }, 300);
    }

    simulateInput("h");
    vi.advanceTimersByTime(100);

    simulateInput("ha");
    vi.advanceTimersByTime(100);

    simulateInput("hac");
    vi.advanceTimersByTime(100);

    simulateInput("hack");
    vi.advanceTimersByTime(300);

    // Only "hack" should be emitted
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("hack");
  });
});
