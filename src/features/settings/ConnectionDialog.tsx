import {
  AudioLines,
  Check,
  ExternalLink,
  Radio,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { AppUpdateSettings } from "@/AppUpdater";
import type { AppUpdaterController } from "@/appUpdaterController";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import {
  beginLastFmAuthorization,
  completeLastFmAuthorization,
  connectBandcamp,
  disconnectLastFm,
  isDesktop,
  openLastFmAuthorization,
} from "@/lib";
import { cn } from "@/lib/utils";
import type {
  Album,
  ConnectionInput,
  LastFmStatus,
} from "@/types";

type ConnectionDialogProps = {
  appUpdater: AppUpdaterController;
  children?: ReactNode;
  className?: string;
  connected: boolean;
  lastFmStatus: LastFmStatus;
  open: boolean;
  onClose: () => void;
  onConnected: (albums: Album[]) => void;
  onDisconnected: () => Promise<void>;
  onLastFmStatus: (status: LastFmStatus) => void;
};

export function ConnectionDialog({
  appUpdater,
  children,
  className,
  connected,
  lastFmStatus,
  open,
  onClose,
  onConnected,
  onDisconnected,
  onLastFmStatus,
}: ConnectionDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "error">("idle");
  const [connectLoaded, setConnectLoaded] = useState(0);
  const [error, setError] = useState("");
  const [settingsOpening, setSettingsOpening] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastFmToken, setLastFmToken] = useState("");
  const [lastFmAction, setLastFmAction] = useState<
    "idle" | "starting" | "finishing" | "disconnecting"
  >("idle");
  const [lastFmError, setLastFmError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "connecting") return;
    const input: ConnectionInput = { username: username.trim(), password };
    if (!input.username || !input.password) return;
    setError("");
    setConnectLoaded(0);
    try {
      setState("connecting");
      const library = await connectBandcamp(input, ({ loaded }) => {
        setConnectLoaded(loaded);
      });
      setPassword("");
      onConnected(library);
      onClose();
    } catch (cause) {
      setState("error");
      setPassword("");
      setError(String(cause).replace(/^Error:\s*/, ""));
    }
  };

  const openSettings = async () => {
    if (settingsOpening) return;
    const settingsUrl = "https://bandcamp.com/settings?pane=fan";
    setError("");
    setSettingsOpening(true);
    try {
      if (isDesktop()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(settingsUrl);
      } else {
        window.open(settingsUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError(
        "Could not open your browser. Visit bandcamp.com/settings and choose Fan.",
      );
    } finally {
      setSettingsOpening(false);
    }
  };

  const removeBandcamp = async () => {
    if (disconnecting) return;
    setError("");
    setDisconnecting(true);
    try {
      await onDisconnected();
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ""));
      setDisconnecting(false);
    }
  };

  const beginLastFm = async () => {
    setLastFmError("");
    setLastFmAction("starting");
    try {
      const authorization = await beginLastFmAuthorization();
      await openLastFmAuthorization(authorization.authorizationUrl);
      setLastFmToken(authorization.token);
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };

  const finishLastFm = async () => {
    if (!lastFmToken) return;
    setLastFmError("");
    setLastFmAction("finishing");
    try {
      const status = await completeLastFmAuthorization(lastFmToken);
      setLastFmToken("");
      onLastFmStatus(status);
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };

  const removeLastFm = async () => {
    setLastFmError("");
    setLastFmAction("disconnecting");
    try {
      onLastFmStatus(await disconnectLastFm());
      setLastFmToken("");
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };

  const dialogBusy =
    state === "connecting" ||
    settingsOpening ||
    disconnecting ||
    lastFmAction !== "idle";

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onExitComplete={() => {
        setUsername("");
        setPassword("");
        setState("idle");
        setConnectLoaded(0);
        setError("");
        setSettingsOpening(false);
        setDisconnecting(false);
        setLastFmToken("");
        setLastFmAction("idle");
        setLastFmError("");
      }}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (dialogBusy) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        aria-busy={dialogBusy}
        className={cn(
          "max-h-[calc(100%-(--spacing(8)))] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0",
          className,
        )}
        showCloseButton={false}
      >
        <Button
          className="absolute top-3 right-3 z-2"
          onClick={onClose}
          aria-label="Close"
          disabled={dialogBusy}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X size={19} />
        </Button>
        <div
          className="min-h-0 overflow-y-auto p-8 [scrollbar-color:#3e4142_transparent] scrollbar-thin"
          data-slot="connection-dialog-scroll"
        >
          <div className="mb-5 grid size-12 place-items-center rounded-full bg-accent text-[#e77b60]">
            <Radio size={24} />
          </div>
          <span className="mb-2.5 text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase">
            Secure connection
          </span>
          <DialogTitle
            id="connection-title"
            className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter"
          >
            {connected ? "Bandcamp is connected" : "Bring in your collection"}
          </DialogTitle>
          <DialogDescription className="mt-2.5 mb-4 text-xs/normal text-[#969994]">
            Coda uses Bandcamp’s official Subsonic beta. Generate separate app
            credentials in Fan Settings, then enter them here.
          </DialogDescription>
          <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-white/2.5 px-3.5 py-3">
            <span className="flex items-center gap-2 text-xs text-[#a8aaa5]">
              <Check className="text-coda-success" size={15} /> Stored in your
              system credential vault
            </span>
            <span className="flex items-center gap-2 text-xs text-[#a8aaa5]">
              <Check className="text-coda-success" size={15} /> Requests limited
              to bandcamp.com
            </span>
            <span className="flex items-center gap-2 text-xs text-[#a8aaa5]">
              <Check className="text-coda-success" size={15} /> No analytics or
              third-party servers
            </span>
          </div>
          <Button
            className="my-4 h-auto justify-start gap-2 p-0 text-xs text-[#df8067] hover:bg-transparent hover:text-[#f1957d]"
            onClick={() => void openSettings()}
            disabled={settingsOpening || state === "connecting" || disconnecting}
            size="compact"
            variant="text"
          >
            {settingsOpening ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <ExternalLink size={16} />
            )}
            {settingsOpening
              ? "Opening Bandcamp…"
              : "Sign in and generate credentials"}
          </Button>
          <ol className="-mt-1 mb-4 grid list-decimal gap-1 pl-6 text-xs/normal text-[#8d908b] marker:font-bold marker:text-[#cf6d55]">
            <li>Sign in to your Bandcamp fan account in the browser.</li>
            <li>Scroll to Subsonic and choose Generate credentials.</li>
            <li>Return here and enter the generated username and password.</li>
          </ol>
          {!connected ? (
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <Label className="flex-col items-stretch gap-1.5">
                Subsonic username
                <Input
                  name="subsonic-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Generated username"
                  disabled={state === "connecting"}
                />
              </Label>
              <Label className="flex-col items-stretch gap-1.5">
                Subsonic password
                <Input
                  name="subsonic-password"
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Generated password"
                  disabled={state === "connecting"}
                />
              </Label>
              {error ? <Alert variant="danger">{error}</Alert> : null}
              <Button
                className="mt-1 w-full"
                type="submit"
                disabled={!username.trim() || !password || state === "connecting"}
                variant="primary"
              >
                {state === "connecting" ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <Radio size={17} />
                )}
                {state === "connecting"
                  ? connectLoaded
                    ? `Loading ${countLabel(connectLoaded, "release")}…`
                    : "Connecting securely…"
                  : "Connect Bandcamp"}
              </Button>
            </form>
          ) : null}
          {connected ? (
            <>
              {error ? <Alert variant="danger">{error}</Alert> : null}
              <Button
                type="button"
                className="mt-2.5 w-full text-xs"
                onClick={() => void removeBandcamp()}
                disabled={disconnecting}
                variant="danger"
              >
                {disconnecting ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : null}
                {disconnecting
                  ? "Disconnecting Bandcamp…"
                  : "Disconnect and remove Bandcamp credentials"}
              </Button>
            </>
          ) : null}
          <Separator className="my-5" />
          <section className="grid gap-3" aria-labelledby="lastfm-settings-title">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
              <AudioLines className="mt-px text-[#d4d2cc]" size={17} />
              <div>
                <h3
                  id="lastfm-settings-title"
                  className="m-0 text-sm font-semibold text-[#deddd7]"
                >
                  Last.fm scrobbling
                </h3>
                <p className="mt-1 mb-0 text-xs/normal text-[#858984]">
                  Send Now Playing updates and scrobble after half the track or
                  four minutes, whichever comes first.
                </p>
              </div>
              <Badge
                variant={lastFmStatus.connected ? "success" : "secondary"}
              >
                {lastFmStatus.connected ? "Connected" : "Not connected"}
              </Badge>
            </div>
            {lastFmStatus.connected ? (
              <div className="flex items-center justify-between gap-3 pl-7">
                <span className="text-xs text-[#8f928d]">
                  Scrobbling as{" "}
                  <strong className="font-semibold text-[#d0d1cb]">
                    {lastFmStatus.username}
                  </strong>
                </span>
                <Button
                  type="button"
                  onClick={() => void removeLastFm()}
                  disabled={lastFmAction !== "idle"}
                  size="compact"
                >
                  {lastFmAction === "disconnecting" ? (
                    <Spinner aria-hidden="true" className="size-4" />
                  ) : null}
                  {lastFmAction === "disconnecting"
                    ? "Disconnecting…"
                    : "Disconnect"}
                </Button>
              </div>
            ) : lastFmStatus.configured ? (
              <div className="flex items-center justify-between gap-3 pl-7">
                {lastFmToken ? (
                  <>
                    <p className="m-0 text-xs/normal text-[#858984]">
                      Approve Coda in the browser, then return here to finish.
                    </p>
                    <Button
                      type="button"
                      onClick={() => void finishLastFm()}
                      disabled={lastFmAction !== "idle"}
                      size="compact"
                    >
                      {lastFmAction === "finishing" ? (
                        <Spinner aria-hidden="true" className="size-4" />
                      ) : (
                        <Check size={15} />
                      )}
                      {lastFmAction === "finishing"
                        ? "Finishing…"
                        : "Finish connection"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void beginLastFm()}
                    disabled={lastFmAction !== "idle"}
                    size="compact"
                  >
                    {lastFmAction === "starting" ? (
                      <Spinner aria-hidden="true" className="size-4" />
                    ) : (
                      <ExternalLink size={15} />
                    )}
                    {lastFmAction === "starting"
                      ? "Opening Last.fm…"
                      : "Connect Last.fm"}
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-1 mb-0 pl-7 text-xs/normal text-[#858984]">
                Last.fm credentials have not been added to this Coda build yet.
              </p>
            )}
            {lastFmError ? <Alert variant="danger">{lastFmError}</Alert> : null}
            <small className="block pl-7 text-xs/normal text-[#656965]">
              The Last.fm session key is stored in your system credential vault.
              Coda never sees your Last.fm password.
            </small>
          </section>
          {appUpdater.supported ? (
            <>
              <Separator className="my-5" />
              <AppUpdateSettings updater={appUpdater} />
            </>
          ) : null}
          <small className="mt-4 block text-xs/normal text-[#656965]">
            Bandcamp’s Subsonic service is currently in beta. Coda is an
            independent client and is not affiliated with Bandcamp or Last.fm.
          </small>
        </div>
      </DialogContent>
      {children}
    </Dialog>
  );
}
