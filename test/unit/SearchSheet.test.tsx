import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchSheet } from "../../src/features/search/SearchSheet";
import * as pi from "../../src/features/sync/piClient";

beforeEach(() => vi.restoreAllMocks());
describe("SearchSheet", () => {
  it("does NOT search on typing — only when Search is pressed", async () => {
    const spy = vi.spyOn(pi, "searchSeries").mockResolvedValue({ results: [], errors: [] });
    vi.spyOn(pi, "listSearchSources").mockResolvedValue([{ id: "asurascans", name: "Asura Scans", host: "asurascans.com", searchable: true }]);
    render(<SearchSheet onClose={() => {}} onSelect={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "hero" } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("hero", expect.any(Array)));
  });

  it("clicking a result calls onSelect with the seriesUrl", async () => {
    vi.spyOn(pi, "listSearchSources").mockResolvedValue([{ id: "asurascans", name: "Asura Scans", host: "asurascans.com", searchable: true }]);
    vi.spyOn(pi, "searchSeries").mockResolvedValue({ results: [{ adapterId: "asurascans", title: "The Hero", seriesUrl: "https://asurascans.com/series/x", coverUrl: null }], errors: [] });
    const onSelect = vi.fn();
    render(<SearchSheet onClose={() => {}} onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "hero" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    const hit = await screen.findByText("The Hero");
    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledWith("https://asurascans.com/series/x");
  });
});
