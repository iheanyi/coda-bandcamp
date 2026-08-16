import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  devtoolsProps: undefined as
    | {
        config?: Record<string, unknown>;
        plugins?: Array<{ id?: string; name: string; render: ReactNode }>;
      }
    | undefined,
  queryPanelProps: undefined as Record<string, unknown> | undefined,
  routerPanelProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: (props: NonNullable<typeof mocks.devtoolsProps>) => {
    mocks.devtoolsProps = props;
    return (
      <div data-testid="tanstack-devtools">
        {props.plugins?.map((plugin) => (
          <div key={plugin.id}>{plugin.render}</div>
        ))}
      </div>
    );
  },
}));

vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtoolsPanel: (props: Record<string, unknown>) => {
    mocks.queryPanelProps = props;
    return <div>Query panel</div>;
  },
}));

vi.mock("@tanstack/react-router-devtools", () => ({
  TanStackRouterDevtoolsPanel: (props: Record<string, unknown>) => {
    mocks.routerPanelProps = props;
    return <div>Router panel</div>;
  },
}));

import { CodaDevtools } from "./CodaDevtools";

beforeEach(() => {
  mocks.devtoolsProps = undefined;
  mocks.queryPanelProps = undefined;
  mocks.routerPanelProps = undefined;
});

describe("CodaDevtools", () => {
  it("registers Router and Query inspectors with explicit app instances", () => {
    const queryClient = {};
    const router = {};

    render(
      <CodaDevtools
        queryClient={queryClient as never}
        router={router as never}
      />,
    );

    expect(screen.getByTestId("tanstack-devtools")).toBeVisible();
    expect(mocks.devtoolsProps?.config).toMatchObject({
      defaultOpen: false,
      hideUntilHover: false,
      panelLocation: "bottom",
      position: "middle-right",
      triggerMode: "fixed",
    });
    expect(
      mocks.devtoolsProps?.plugins?.map(({ id, name }) => ({ id, name })),
    ).toEqual([
      { id: "tanstack-router", name: "TanStack Router" },
      { id: "tanstack-query", name: "TanStack Query" },
    ]);
    expect(mocks.routerPanelProps?.router).toBe(router);
    expect(mocks.queryPanelProps?.client).toBe(queryClient);
  });
});
