import {
  Copy,
  Download,
  Gauge,
  RotateCcw,
  Save,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMotionDiagnostic } from "@/motionDiagnostics";
import type { MotionEase, MotionProfile, MotionTiming } from "@/motionProfile";
import {
  duplicateMotionPreset,
  exportMotionProfile,
  getAllMotionPresets,
  importMotionProfile,
  renameMotionPreset,
  resetMotionProfile,
  saveMotionPreset,
  selectMotionPreset,
  updateMotionProfile,
  useMotionProfileState,
} from "@/motionProfileStore";

type MotionFamily = "page" | "component" | "shared" | "detail" | "feedback";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
      {children}
    </label>
  );
}

function NumberControl({
  label,
  value,
  minimum,
  maximum,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
        <input
          aria-label={label}
          className="accent-primary"
          max={maximum}
          min={minimum}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          step={step}
          type="range"
          value={value}
        />
        <output className="rounded-md border border-border bg-coda-field px-2 py-1 text-right font-mono text-[11px] text-foreground normal-case">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {unit}
        </output>
      </div>
    </Field>
  );
}

function TimingEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MotionTiming;
  onChange: (value: MotionTiming) => void;
}) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-border bg-black/10 p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Motion">
          <select
            aria-label={`${label} motion`}
            className="h-8 rounded-md border border-input bg-coda-field px-2 text-xs text-foreground"
            onChange={(event) =>
              onChange({
                ...value,
                type: event.currentTarget.value as MotionTiming["type"],
              })
            }
            value={value.type}
          >
            <option value="tween">Tween</option>
            <option value="spring">Spring</option>
          </select>
        </Field>
        <Field label="Easing">
          <select
            aria-label={`${label} easing`}
            className="h-8 rounded-md border border-input bg-coda-field px-2 text-xs text-foreground"
            disabled={value.type === "spring"}
            onChange={(event) =>
              onChange({
                ...value,
                ease: event.currentTarget.value as MotionEase,
              })
            }
            value={value.ease}
          >
            <option value="emphasized">Emphasized</option>
            <option value="standard">Standard</option>
            <option value="accelerate">Accelerate</option>
            <option value="linear">Linear</option>
          </select>
        </Field>
      </div>
      <NumberControl
        label="Duration"
        maximum={2_000}
        minimum={40}
        onChange={(durationMs) => onChange({ ...value, durationMs })}
        step={10}
        unit="ms"
        value={value.durationMs}
      />
      {value.type === "spring" ? (
        <NumberControl
          label="Bounce"
          maximum={1}
          minimum={0}
          onChange={(bounce) => onChange({ ...value, bounce })}
          step={0.01}
          value={value.bounce}
        />
      ) : null}
    </fieldset>
  );
}

function updateFamily<K extends keyof MotionProfile>(
  key: K,
  value: MotionProfile[K],
) {
  updateMotionProfile((profile) => ({ ...profile, [key]: value }));
}

function PageControls({ profile }: { profile: MotionProfile }) {
  const family = profile.page;
  const set = (patch: Partial<typeof family>) =>
    updateFamily("page", { ...family, ...patch });
  return (
    <div className="grid gap-3">
      <Field label="Choreography">
        <select
          aria-label="Page choreography"
          className="h-8 rounded-md border border-input bg-coda-field px-2 text-xs text-foreground"
          onChange={(event) =>
            set({ mode: event.currentTarget.value as typeof family.mode })
          }
          value={family.mode}
        >
          <option value="slide">Directional slide</option>
          <option value="crossfade">Crossfade</option>
        </select>
      </Field>
      <TimingEditor
        label="Enter"
        onChange={(enter) => set({ enter })}
        value={family.enter}
      />
      <TimingEditor
        label="Exit"
        onChange={(exit) => set({ exit })}
        value={family.exit}
      />
      <NumberControl
        label="Enter delay"
        maximum={500}
        minimum={0}
        onChange={(enterDelayMs) => set({ enterDelayMs })}
        step={5}
        unit="ms"
        value={family.enterDelayMs}
      />
      <NumberControl
        label="Translation"
        maximum={80}
        minimum={0}
        onChange={(translationPx) => set({ translationPx })}
        step={1}
        unit="px"
        value={family.translationPx}
      />
      <NumberControl
        label="Scale from"
        maximum={1.2}
        minimum={0.7}
        onChange={(scaleFrom) => set({ scaleFrom })}
        step={0.01}
        value={family.scaleFrom}
      />
      <NumberControl
        label="Opacity from"
        maximum={1}
        minimum={0}
        onChange={(opacityFrom) => set({ opacityFrom })}
        step={0.05}
        value={family.opacityFrom}
      />
    </div>
  );
}

function ComponentControls({ profile }: { profile: MotionProfile }) {
  const family = profile.component;
  const set = (patch: Partial<typeof family>) =>
    updateFamily("component", { ...family, ...patch });
  return (
    <div className="grid gap-3">
      <TimingEditor
        label="Enter"
        onChange={(enter) => set({ enter })}
        value={family.enter}
      />
      <TimingEditor
        label="Exit"
        onChange={(exit) => set({ exit })}
        value={family.exit}
      />
      <NumberControl
        label="Translation"
        maximum={80}
        minimum={0}
        onChange={(translationPx) => set({ translationPx })}
        step={1}
        unit="px"
        value={family.translationPx}
      />
      <NumberControl
        label="Scale from"
        maximum={1.2}
        minimum={0.7}
        onChange={(scaleFrom) => set({ scaleFrom })}
        step={0.01}
        value={family.scaleFrom}
      />
      <NumberControl
        label="Opacity from"
        maximum={1}
        minimum={0}
        onChange={(opacityFrom) => set({ opacityFrom })}
        step={0.05}
        value={family.opacityFrom}
      />
    </div>
  );
}

function SharedControls({ profile }: { profile: MotionProfile }) {
  const family = profile.shared;
  const set = (patch: Partial<typeof family>) =>
    updateFamily("shared", { ...family, ...patch });
  return (
    <div className="grid gap-3">
      <Field label="Shared choreography">
        <select
          aria-label="Shared choreography"
          className="h-8 rounded-md border border-input bg-coda-field px-2 text-xs text-foreground"
          onChange={(event) =>
            set({
              choreography: event.currentTarget
                .value as typeof family.choreography,
            })
          }
          value={family.choreography}
        >
          <option value="morph">Native morph</option>
          <option value="crossfade">Crossfade baseline</option>
        </select>
      </Field>
      <TimingEditor
        label="Artwork"
        onChange={(artwork) => set({ artwork })}
        value={family.artwork}
      />
      <TimingEditor
        label="Identity"
        onChange={(identity) => set({ identity })}
        value={family.identity}
      />
      <TimingEditor
        label="Title"
        onChange={(title) => set({ title })}
        value={family.title}
      />
      <TimingEditor
        label="Crossfade"
        onChange={(crossfade) => set({ crossfade })}
        value={family.crossfade}
      />
      <NumberControl
        label="Scale from"
        maximum={1.2}
        minimum={0.7}
        onChange={(scaleFrom) => set({ scaleFrom })}
        step={0.01}
        value={family.scaleFrom}
      />
      <NumberControl
        label="Opacity from"
        maximum={1}
        minimum={0}
        onChange={(opacityFrom) => set({ opacityFrom })}
        step={0.05}
        value={family.opacityFrom}
      />
    </div>
  );
}

function DetailControls({ profile }: { profile: MotionProfile }) {
  const family = profile.detail;
  const set = (patch: Partial<typeof family>) =>
    updateFamily("detail", { ...family, ...patch });
  return (
    <div className="grid gap-3">
      <TimingEditor
        label="Surface"
        onChange={(surface) => set({ surface })}
        value={family.surface}
      />
      <NumberControl
        label="Translation"
        maximum={80}
        minimum={0}
        onChange={(translationPx) => set({ translationPx })}
        step={1}
        unit="px"
        value={family.translationPx}
      />
      <NumberControl
        label="Scale from"
        maximum={1.2}
        minimum={0.7}
        onChange={(scaleFrom) => set({ scaleFrom })}
        step={0.01}
        value={family.scaleFrom}
      />
      <NumberControl
        label="Opacity from"
        maximum={1}
        minimum={0}
        onChange={(opacityFrom) => set({ opacityFrom })}
        step={0.05}
        value={family.opacityFrom}
      />
    </div>
  );
}

function FeedbackControls({ profile }: { profile: MotionProfile }) {
  return (
    <div className="grid gap-3">
      <TimingEditor
        label="Feedback"
        onChange={(timing) => updateFamily("feedback", { timing })}
        value={profile.feedback.timing}
      />
      <TimingEditor
        label="Selection"
        onChange={(selection) => updateFamily("selection", selection)}
        value={profile.selection}
      />
    </div>
  );
}

function formatRect(
  rect: { x: number; y: number; width: number; height: number } | undefined,
) {
  return rect ? `${rect.x}, ${rect.y} · ${rect.width}×${rect.height}` : "—";
}

function Diagnostics() {
  const diagnostic = useMotionDiagnostic();
  if (!diagnostic) {
    return (
      <p className="text-xs text-muted-foreground">
        Run a page or detail transition to capture diagnostics.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
      <dt className="text-muted-foreground">Transition</dt>
      <dd>{diagnostic.kind}</dd>
      <dt className="text-muted-foreground">Status</dt>
      <dd>
        {diagnostic.status}
        {diagnostic.reason ? ` · ${diagnostic.reason}` : ""}
      </dd>
      <dt className="text-muted-foreground">Fallback</dt>
      <dd>
        {diagnostic.status === "fallback"
          ? (diagnostic.reason ?? "Fallback used")
          : "None"}
      </dd>
      <dt className="text-muted-foreground">Native morph</dt>
      <dd>
        {diagnostic.sharedExpected
          ? diagnostic.sharedPaired === true
            ? "Paired"
            : diagnostic.sharedPaired === false
              ? "Not paired"
              : "Pending"
          : "Not expected"}
      </dd>
      <dt className="text-muted-foreground">Source</dt>
      <dd className="font-mono">{formatRect(diagnostic.sourceRect)}</dd>
      <dt className="text-muted-foreground">Destination</dt>
      <dd className="font-mono">{formatRect(diagnostic.destinationRect)}</dd>
      <dt className="text-muted-foreground">Endpoints</dt>
      <dd>
        {diagnostic.sourceCount} old / {diagnostic.destinationCount} new
      </dd>
      <dt className="text-muted-foreground">Pseudo layers</dt>
      <dd>
        {diagnostic.pseudoLayers.group.length} group ·{" "}
        {diagnostic.pseudoLayers.old.length} old ·{" "}
        {diagnostic.pseudoLayers.new.length} new
      </dd>
      <dt className="text-muted-foreground">Configured visual</dt>
      <dd>{Math.round(diagnostic.configuredDurationMs)}ms</dd>
      <dt className="text-muted-foreground">Actual settled</dt>
      <dd>
        {diagnostic.actualDurationMs === undefined
          ? "—"
          : `${Math.round(diagnostic.actualDurationMs)}ms`}
      </dd>
      <dt className="text-muted-foreground">Total elapsed</dt>
      <dd>
        {diagnostic.elapsedMs === undefined
          ? "—"
          : `${Math.round(diagnostic.elapsedMs)}ms`}
      </dd>
      <dt className="text-muted-foreground">Images</dt>
      <dd>
        {Math.round(diagnostic.imageInsertionMs ?? 0)}ms insert ·{" "}
        {Math.round(diagnostic.imageDecodeMs ?? 0)}ms decode
      </dd>
      <dt className="text-muted-foreground">Names</dt>
      <dd className="break-all font-mono">
        {diagnostic.transitionNames.join(", ") || "—"}
      </dd>
      <dt className="text-muted-foreground">Classes</dt>
      <dd className="break-all font-mono">
        {diagnostic.transitionClasses.join(", ") || "—"}
      </dd>
      <dt className="text-muted-foreground">Issues</dt>
      <dd>
        {[
          ...diagnostic.missingEndpoints.map((item) => `missing ${item}`),
          ...diagnostic.duplicateEndpoints.map((item) => `duplicate ${item}`),
        ].join(", ") || "None"}
      </dd>
    </dl>
  );
}

export function MotionLabPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const state = useMotionProfileState();
  const [family, setFamily] = useState<MotionFamily>("page");
  const [presetName, setPresetName] = useState("My Motion");
  const [error, setError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const presets = getAllMotionPresets();
  const activePreset = presets.find(
    (preset) => preset.id === state.activePresetId,
  );
  useEffect(() => {
    if (activePreset) setPresetName(activePreset.name);
  }, [activePreset]);
  if (!open) return null;

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      importMotionProfile(await file.text());
      setError(undefined);
    } catch {
      setError("That file is not a valid Coda Motion profile.");
    }
  };

  const handleExport = () => {
    const url = URL.createObjectURL(
      new Blob([exportMotionProfile()], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "coda-motion-profile.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const panel = (
    <aside
      aria-label="Motion Lab"
      aria-modal="false"
      className="fixed top-5 right-5 z-[80] flex max-h-[calc(100vh-2.5rem)] w-[min(25rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-(--line-strong) bg-[rgba(25,27,29,0.96)] text-foreground shadow-[0_28px_80px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      data-coda-motion-lab
      role="dialog"
      style={{ viewTransitionName: "none" }}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
          <Gauge className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Motion Lab</h2>
          <p className="text-[10px] text-muted-foreground">
            ⌘⇧D · live profile editor
          </p>
        </div>
        <Button
          aria-label="Close Motion Lab"
          onClick={() => onOpenChange(false)}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
      </header>

      <div className="grid gap-4 overflow-y-auto p-4">
        <section className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Field label="Preset">
              <select
                aria-label="Motion preset"
                className="h-8 min-w-0 rounded-md border border-input bg-coda-field px-2 text-xs text-foreground"
                onChange={(event) =>
                  selectMotionPreset(event.currentTarget.value)
                }
                value={state.activePresetId ?? "custom"}
              >
                {!state.activePresetId ? (
                  <option value="custom">Unsaved changes</option>
                ) : null}
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              aria-label="Reset to Current"
              onClick={resetMotionProfile}
              size="icon-sm"
              title="Reset to Current"
              variant="outline"
            >
              <RotateCcw />
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
            <Input
              aria-label="Preset name"
              onChange={(event) => setPresetName(event.currentTarget.value)}
              value={presetName}
            />
            <Button
              aria-label="Save preset"
              onClick={() => {
                const preset = saveMotionPreset(presetName);
                setPresetName(preset.name);
              }}
              size="icon-sm"
              title="Save preset"
            >
              <Save />
            </Button>
            <Button
              aria-label="Rename preset"
              disabled={!activePreset || activePreset.builtin}
              onClick={() => {
                if (activePreset)
                  renameMotionPreset(activePreset.id, presetName);
              }}
              size="icon-sm"
              title="Rename preset"
              variant="outline"
            >
              <span className="text-[10px] font-bold">Aa</span>
            </Button>
            <Button
              aria-label="Duplicate preset"
              disabled={!activePreset}
              onClick={() => {
                if (activePreset) duplicateMotionPreset(activePreset.id);
              }}
              size="icon-sm"
              title="Duplicate preset"
              variant="outline"
            >
              <Copy />
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
              ref={importRef}
              type="file"
            />
            <Button
              onClick={() => importRef.current?.click()}
              size="compact"
              variant="outline"
            >
              <Upload />
              Import
            </Button>
            <Button onClick={handleExport} size="compact" variant="outline">
              <Download />
              Export
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </section>

        <section className="grid gap-3 border-y border-border py-4">
          <NumberControl
            label="Inspection speed"
            maximum={4}
            minimum={0.1}
            onChange={(speed) =>
              updateMotionProfile((profile) => ({ ...profile, speed }))
            }
            step={0.1}
            unit="×"
            value={state.profile.speed}
          />
          <nav aria-label="Motion families" className="flex flex-wrap gap-1">
            {(
              ["page", "component", "shared", "detail", "feedback"] as const
            ).map((item) => (
              <button
                className="rounded-md border border-border px-2 py-1 text-[11px] capitalize data-[active=true]:border-primary/50 data-[active=true]:bg-primary/15 data-[active=true]:text-primary"
                data-active={family === item}
                key={item}
                onClick={() => setFamily(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </nav>
          {family === "page" ? <PageControls profile={state.profile} /> : null}
          {family === "component" ? (
            <ComponentControls profile={state.profile} />
          ) : null}
          {family === "shared" ? (
            <SharedControls profile={state.profile} />
          ) : null}
          {family === "detail" ? (
            <DetailControls profile={state.profile} />
          ) : null}
          {family === "feedback" ? (
            <FeedbackControls profile={state.profile} />
          ) : null}
        </section>

        <section className="grid gap-2">
          <h3 className="text-xs font-semibold">Last transition</h3>
          <Diagnostics />
        </section>
      </div>
    </aside>
  );

  return createPortal(panel, document.body);
}
