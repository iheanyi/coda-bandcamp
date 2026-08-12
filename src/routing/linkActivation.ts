type PrimaryActivation = Readonly<{
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}>;

type CodaLinkActivationEvent = PrimaryActivation & {
  currentTarget: HTMLAnchorElement;
  preventDefault: () => void;
};

export function isUnmodifiedPrimaryActivation(
  event: PrimaryActivation,
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function handleCodaLinkActivation(
  event: CodaLinkActivationEvent,
  navigate: (trigger: HTMLAnchorElement) => void,
): void {
  if (!isUnmodifiedPrimaryActivation(event)) return;
  event.preventDefault();
  navigate(event.currentTarget);
}
