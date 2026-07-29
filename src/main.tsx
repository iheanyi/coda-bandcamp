import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { CodaMotionProvider } from "./MotionProvider";
import MiniPlayerWindow from "./MiniPlayerWindow";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const windowView = new URLSearchParams(window.location.search).get("view");

if (windowView === "mini-player") {
  document.documentElement.dataset.codaWindow = "mini-player";
  root.render(
    <StrictMode>
      <CodaMotionProvider>
        <TooltipProvider>
          <MiniPlayerWindow />
        </TooltipProvider>
      </CodaMotionProvider>
    </StrictMode>,
  );
} else {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  });

  root.render(
    <StrictMode>
      <CodaMotionProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </TooltipProvider>
      </CodaMotionProvider>
    </StrictMode>,
  );
}
