import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

type SliderProps = SliderPrimitive.Root.Props<readonly number[]>

function asArray(value: number | readonly number[]): readonly number[] {
  return typeof value === "number" ? [value] : value
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  onValueChange,
  onValueCommitted,
  ...props
}: SliderProps) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]
  const primitiveDefaultValue = defaultValue?.length === 1
    ? defaultValue[0]
    : defaultValue
  const primitiveValue = value?.length === 1 ? value[0] : value

  return (
    <SliderPrimitive.Root<number | readonly number[]>
      className={cn(
        "group/slider w-full data-vertical:h-full data-vertical:w-auto",
        className,
      )}
      data-slot="slider"
      defaultValue={primitiveDefaultValue}
      value={primitiveValue}
      min={min}
      max={max}
      aria-label={ariaLabel}
      thumbAlignment="edge"
      onValueChange={(nextValue, eventDetails) => {
        onValueChange?.(asArray(nextValue), eventDetails)
      }}
      onValueCommitted={(nextValue, eventDetails) => {
        onValueCommitted?.(asArray(nextValue), eventDetails)
      }}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-horizontal:h-5 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-[#3a3d3f] select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-[#d5d3cd] select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
            className="relative block size-2.5 shrink-0 rounded-full border-0 bg-[#e9e7e1] opacity-0 transition-opacity duration-(--duration-coda-fast) outline-none select-none group-hover/slider:opacity-100 after:absolute after:-inset-2 has-[input:focus-visible]:opacity-100 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring motion-reduce:transition-none data-disabled:pointer-events-none data-disabled:opacity-0"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
