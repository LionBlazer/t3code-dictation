import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ExpandableFileImage } from "../files/ExpandableFileImage";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import "../../index.css";

const src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><path fill="teal" d="M0 0H1600V900H0z"/></svg>')}`;

it("zooms at the pointer, pans without scrolling, and fits the image again", async () => {
  await using screen = await render(
    <ExpandedImageDialog
      preview={{ images: [{ src, name: "Screenshot" }], index: 0 }}
      onClose={() => {}}
    />,
  );
  const region = page.getByRole("region", { name: "Screenshot, zoomable image" });
  const image = page.getByRole("img", { name: "Screenshot" });
  await expect.element(image).toBeVisible();
  const viewport = region.element() as HTMLElement;
  await vi.waitFor(() => expect((image.element() as HTMLImageElement).naturalWidth).toBe(1600));
  const bounds = viewport.getBoundingClientRect();
  const point = {
    x: Math.round(bounds.left + bounds.width * 0.6),
    y: Math.round(bounds.top + bounds.height / 2),
  };
  const before = image.element().getBoundingClientRect();
  const pixel = (point.x - before.left) / before.width;
  const wheel = new WheelEvent("wheel", {
    deltaY: -350,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  await act(() => {
    viewport.dispatchEvent(wheel);
  });
  await vi.waitFor(() => expect(Number(viewport.dataset.zoom)).toBeGreaterThan(2));
  expect(wheel.defaultPrevented).toBe(true);
  const after = image.element().getBoundingClientRect();
  expect((point.x - after.left) / after.width).toBeCloseTo(pixel, 4);
  expect(viewport.scrollTop).toBe(0);
  expect(viewport.scrollLeft).toBe(0);
  const left = after.left;
  await userEvent.dragAndDrop(region, region, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 160, y: 120 },
  });
  await vi.waitFor(() =>
    expect(image.element().getBoundingClientRect().left).toBeGreaterThan(left + 40),
  );
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  await expect.element(region).toHaveAttribute("data-zoom", "1");
  await expect.element(page.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await image.dblClick();
  await expect.element(region).toHaveAttribute("data-zoom", "2");
  viewport.focus();
  await userEvent.keyboard("0");
  await expect.element(region).toHaveAttribute("data-zoom", "1");
  expect(screen.container).toBeDefined();
});

it("resets zoom when changing images and closes with Escape", async () => {
  const close = vi.fn();
  await using screen = await render(
    <ExpandedImageDialog
      preview={{
        images: [
          { src, name: "First" },
          { src, name: "Second" },
        ],
        index: 0,
      }}
      onClose={close}
    />,
  );
  await expect.element(page.getByRole("img", { name: "First", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await vi.waitFor(() =>
    expect(Number(page.getByRole("region").element().getAttribute("data-zoom"))).toBeGreaterThan(1),
  );
  await page.getByRole("button", { name: "Next media", exact: true }).click();
  await expect.element(page.getByRole("img", { name: "Second", exact: true })).toBeVisible();
  await expect.element(page.getByRole("region")).toHaveAttribute("data-zoom", "1");
  await userEvent.keyboard("{Escape}");
  expect(close).toHaveBeenCalled();
  expect(screen.container).toBeDefined();
});

it("handles a two-pointer pinch and releases cancelled touches", async () => {
  const close = vi.fn();
  await using screen = await render(
    <ExpandedImageDialog
      preview={{ images: [{ src, name: "Touch screenshot" }], index: 0 }}
      onClose={close}
    />,
  );
  await expect.element(page.getByRole("img", { name: "Touch screenshot" })).toBeVisible();
  const viewport = page.getByRole("region").element() as HTMLElement;
  // Synthetic pointer events have no browser-owned pointer to capture.
  using _capture = vi.spyOn(viewport, "setPointerCapture").mockImplementation(() => {});
  const bounds = viewport.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  await act(() => {
    viewport.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        clientX: x - 30,
        clientY: y,
        bubbles: true,
      }),
    );
    viewport.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        clientX: x + 30,
        clientY: y,
        bubbles: true,
      }),
    );
    viewport.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        clientX: x + 90,
        clientY: y,
        bubbles: true,
      }),
    );
  });
  await expect.element(page.getByRole("region")).toHaveAttribute("data-zoom", "2");
  await act(() => {
    viewport.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1, pointerType: "touch", bubbles: true }),
    );
    viewport.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 2, pointerType: "touch", bubbles: true }),
    );
  });
  await vi.waitFor(() => expect(viewport.style.cursor).toBe("grab"));
  expect(close).not.toHaveBeenCalled();
  expect(screen.container).toBeDefined();
});

it("opens file panel images in the same viewer and returns focus on close", async () => {
  await using screen = await render(
    <div style={{ height: 300, display: "flex" }}>
      <ExpandableFileImage src={src} name="File screenshot" onError={() => {}} />
    </div>,
  );
  const opener = screen.getByRole("button", { name: "Preview File screenshot", exact: true });
  await opener.click();
  await expect
    .element(page.getByRole("region", { name: "File screenshot, zoomable image" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await expect.element(opener).toHaveFocus();
});
