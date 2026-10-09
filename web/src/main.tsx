import "@mantine/core/styles.css";
import "./styles/fonts.css";
import "./styles/gradients.css";
import "./styles/theme.css";
import "./styles/overlays.css";
import "./styles/mobile.css";
import "./styles/zIndexVariables.css";

import React from "react";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import {
  createTheme,
  darken,
  Drawer,
  MantineProvider,
  MantineColorsTuple,
  Modal,
  Tooltip,
} from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LandingPage from "./pages/LandingPage";
import { isMobileDevice } from "./utils/isTouchDevice";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  {
    lazy: () =>
      import("./play/PlayerLayout").then((m) => ({
        Component: m.PlayerLayout,
      })),
    children: [
      {
        path: "/play",
        lazy: () =>
          import("./pages/PlayHomePage").then((m) => ({
            Component: m.default,
          })),
      },
      {
        path: "/game/:mapid",
        lazy: () =>
          import("./pages/GamePage").then((m) => ({ Component: m.default })),
      },
    ],
  },
  {
    path: "/admin",
    lazy: () =>
      import("./pages/AdminPage").then((m) => ({ Component: m.default })),
  },
  {
    path: "/system/:systemId",
    lazy: () =>
      import("./domains/map/components/SystemTilePage/SystemTilePage").then(
        (m) => ({ Component: m.SystemTilePage }),
      ),
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

document.body.classList.toggle("mobile", isMobileDevice());

/*
 * Every Mantine portal renders into this one node. Left to itself each closed
 * Popover/Tooltip appended its own empty div to <body>, and React attached its
 * full delegated-listener set to each — ~320 divs and ~46k listeners on a game.
 */
const portalRoot = document.createElement("div");
portalRoot.id = "mantine-portal-root";
document.body.appendChild(portalRoot);

const myColor: MantineColorsTuple = [
  darken("#edf5ff", 0.5),
  darken("#e0e6f1", 0.5),
  darken("#c3cad9", 0.5),
  darken("#a3adc1", 0.5),
  darken("#8894ad", 0.5),
  darken("#7685a1", 0.5),
  darken("#6d7d9c", 0.5),
  darken("#5b6b89", 0.5),
  darken("#4f5f7c", 0.5),
  darken("#405270", 0.5),
];

const theme = createTheme({
  colors: {
    blueGray: myColor,
  },
  /*
   * Type roles come from styles/typography.css so CSS modules and Mantine props
   * cannot drift apart. Slider carries display, IBM Plex Sans every piece of UI
   * text, IBM Plex Mono every numeral.
   */
  fontFamily: "var(--font-text)",
  fontFamilyMonospace: "var(--font-data)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "600",
  },
  /*
   * Mantine's ladder keeps its original values, expressed in rem so it honours the
   * reader's browser setting. It is NOT remapped onto the semantic roles: `xs` is
   * used in 139 places as the chip/body size, and folding it onto the 10px label
   * role shrank every chip label in the app — the semantic roles are for CSS
   * modules, this ladder is for component props.
   */
  fontSizes: {
    xs: "0.75rem" /*    12 */,
    sm: "0.875rem" /*   14 */,
    md: "1rem" /*       16 */,
    lg: "1.125rem" /*   18 */,
    xl: "1.25rem" /*    20 */,
  },
  lineHeights: {
    /* xs is the uppercase label role — single line, tight. sm upward can wrap, so
       it takes body leading; light text on a dark field needs the extra air. */
    xs: "var(--lh-tight)",
    sm: "var(--lh-body)",
    md: "var(--lh-body)",
    lg: "var(--lh-body)",
    xl: "var(--lh-body)",
  },
  breakpoints: {
    xs: "36em", // 576px
    sm: "48em", // 768px
    md: "62em", // 992px
    lg: "75em", // 1200px
    xl: "88em", // 1408px
    xl2: "100em", // 1600px - custom
    xl3: "120em", // 1920px - custom
    xl4: "140em", // 2240px - custom
    xl5: "160em", // 2560px - custom
    xl6: "180em", // 2880px - custom
    xl7: "200em", // 3200px - custom
  },
  /* Every floating surface shares the themed details-card chrome
     (see styles/overlays.css) */
  components: {
    Modal: Modal.extend({
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.6, blur: 3 },
      },
      classNames: {
        content: "overlay-modal-content",
        header: "overlay-modal-header",
        title: "overlay-modal-title",
      },
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.6, blur: 3 },
      },
      classNames: {
        content: "overlay-drawer-content",
        header: "overlay-modal-header",
        title: "overlay-modal-title",
      },
    }),
    Tooltip: Tooltip.extend({
      classNames: { tooltip: "overlay-tooltip" },
    }),
    Portal: {
      defaultProps: { target: portalRoot },
    },
  },
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
