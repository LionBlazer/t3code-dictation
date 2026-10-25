import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { dismissContextMenu, showContextMenuFallback } from "../../contextMenuFallback";
import { ExpandableFileImage } from "../files/ExpandableFileImage";
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import "../../index.css";

const src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><path fill="teal" d="M0 0H1600V900H0z"/></svg>')}`;

it("uses Ctrl-wheel to zoom at the pointer, drags to pan, and clicks to close", async () => {
  const close = vi.fn();
  await using screen = await render(
    <ExpandedImageDialog
      preview={{ images: [{ src, name: "Screenshot" }], index: 0 }}
      onClose={close}
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
    deltaY: -400,
    ctrlKey: true,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  await act(() => {
    viewport.dispatchEvent(wheel);
  });
  await vi.waitFor(() => expect(Number(viewport.dataset.zoom)).toBeCloseTo(1.22 ** 4, 5));
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
  expect(close).not.toHaveBeenCalled();
  await image.click();
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.container).toBeDefined();
});

it("uses wheel and arrows for a clamped gallery, resetting zoom only when the image changes", async () => {
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
  const wheel = async (deltaY: number, ctrlKey = false) => {
    await act(() => {
      page
        .getByRole("region")
        .element()
        .dispatchEvent(
          new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true }),
        );
    });
  };
  await wheel(-400, true);
  await vi.waitFor(() =>
    expect(Number(page.getByRole("region").element().getAttribute("data-zoom"))).toBeGreaterThan(1),
  );
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(page.getByRole("img", { name: "First", exact: true })).toBeVisible();
  expect(Number(page.getByRole("region").element().getAttribute("data-zoom"))).toBeGreaterThan(1);
  await wheel(100);
  await expect.element(page.getByRole("img", { name: "Second", exact: true })).toBeVisible();
  await expect.element(page.getByRole("region")).toHaveAttribute("data-zoom", "1");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("img", { name: "Second", exact: true })).toBeVisible();
  await wheel(-100);
  await expect.element(page.getByRole("img", { name: "First", exact: true })).toBeVisible();
  await wheel(-400, true);
  await vi.waitFor(() =>
    expect(Number(page.getByRole("region").element().getAttribute("data-zoom"))).toBeGreaterThan(1),
  );
  await userEvent.keyboard("{ArrowRight}");
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
  await vi.waitFor(() => expect(viewport.style.cursor).toBe("default"));
  expect(close).not.toHaveBeenCalled();
  expect(screen.container).toBeDefined();
});

it("keeps wheel input inside the viewer while a context menu is open", async () => {
  await using screen = await render(
    <ExpandedImageDialog
      preview={{
        images: [
          { src, name: "Screenshot" },
          { src, name: "Second" },
        ],
        index: 0,
      }}
      onClose={() => {}}
    />,
  );
  await expect.element(page.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
  const viewport = page.getByRole("region").element() as HTMLElement;
  const menu = showContextMenuFallback([{ id: "copy", label: "Copy image" }], { x: 10, y: 10 });
  try {
    for (const ctrlKey of [false, true]) {
      const event = new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      });
      await act(() => {
        viewport.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    }
    await expect.element(page.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
    expect(viewport.dataset.zoom).toBe("1");
  } finally {
    dismissContextMenu();
    await menu;
  }
  expect(screen.container).toBeDefined();
});

it("keeps a single image on ordinary wheel and returns from maximum zoom to a centered fit", async () => {
  await using screen = await render(
    <ExpandedImageDialog
      preview={{ images: [{ src, name: "Screenshot" }], index: 0 }}
      onClose={() => {}}
    />,
  );
  const image = page.getByRole("img", { name: "Screenshot", exact: true });
  await expect.element(image).toBeVisible();
  const viewport = page.getByRole("region").element() as HTMLElement;
  await vi.waitFor(() => expect((image.element() as HTMLImageElement).naturalWidth).toBe(1600));
  const fitted = image.element().getBoundingClientRect();
  const bounds = viewport.getBoundingClientRect();
  const wheel = async (deltaY: number, ctrlKey: boolean) => {
    await act(() => {
      viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY,
          ctrlKey,
          bubbles: true,
          cancelable: true,
          clientX: Math.round(bounds.left + bounds.width / 2),
          clientY: Math.round(bounds.top + bounds.height / 2),
        }),
      );
    });
  };
  await wheel(100, false);
  expect(image.element().getBoundingClientRect().width).toBeCloseTo(fitted.width);
  await wheel(-10000, true);
  await vi.waitFor(() =>
    expect(image.element().getBoundingClientRect().width).toBeCloseTo(fitted.width * 8),
  );
  await wheel(10000, true);
  await vi.waitFor(() => {
    const reset = image.element().getBoundingClientRect();
    expect(reset.width).toBeCloseTo(fitted.width);
    expect(reset.left).toBeCloseTo(fitted.left);
    expect(reset.top).toBeCloseTo(fitted.top);
  });
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
  await page.getByRole("region").click();
  await expect.element(opener).toHaveFocus();
});
