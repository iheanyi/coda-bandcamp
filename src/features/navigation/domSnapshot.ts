export type DomAttributeEdit = Readonly<{
  element: HTMLElement;
  kind: "attribute";
  name: string;
  value: string;
}>;

export type DomClassEdit = Readonly<{
  className: string;
  element: HTMLElement;
  kind: "class";
}>;

export type DomStyleEdit = Readonly<{
  element: HTMLElement;
  kind: "style";
  name: string;
  priority?: string;
  value: string;
}>;

export type DomEdit = DomAttributeEdit | DomClassEdit | DomStyleEdit;

type AttributeSnapshot = Readonly<{
  edit: DomAttributeEdit;
  previous: string | null;
}>;

type ClassSnapshot = Readonly<{
  edit: DomClassEdit;
  previous: boolean;
}>;

type StyleSnapshot = Readonly<{
  edit: DomStyleEdit;
  previousPriority: string;
  previousValue: string;
}>;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported DOM edit variant: ${String(value)}`);
}

function writeStyleProperty(
  element: HTMLElement,
  name: string,
  value: string,
  priority: string,
): void {
  if (!value) {
    element.style.removeProperty(name);
    return;
  }
  element.style.setProperty(name, value, priority);
}

/**
 * Apply a batch of DOM edits and return a single restore. Restore writes the
 * captured baselines back exactly once and ignores later calls.
 */
export function applyDomEdits(edits: readonly DomEdit[]): () => void {
  const attributes: AttributeSnapshot[] = [];
  const classes: ClassSnapshot[] = [];
  const styles: StyleSnapshot[] = [];

  for (const edit of edits) {
    switch (edit.kind) {
      case "attribute":
        attributes.push({ edit, previous: edit.element.getAttribute(edit.name) });
        edit.element.setAttribute(edit.name, edit.value);
        break;
      case "class":
        classes.push({
          edit,
          previous: edit.element.classList.contains(edit.className),
        });
        edit.element.classList.add(edit.className);
        break;
      case "style":
        styles.push({
          edit,
          previousPriority: edit.element.style.getPropertyPriority(edit.name),
          previousValue: edit.element.style.getPropertyValue(edit.name),
        });
        writeStyleProperty(
          edit.element,
          edit.name,
          edit.value,
          edit.priority ?? "",
        );
        break;
      default:
        assertNever(edit);
    }
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (let index = styles.length - 1; index >= 0; index -= 1) {
      const snapshot = styles[index];
      if (!snapshot) continue;
      writeStyleProperty(
        snapshot.edit.element,
        snapshot.edit.name,
        snapshot.previousValue,
        snapshot.previousPriority,
      );
    }
    for (let index = classes.length - 1; index >= 0; index -= 1) {
      const snapshot = classes[index];
      if (!snapshot) continue;
      if (!snapshot.previous) {
        snapshot.edit.element.classList.remove(snapshot.edit.className);
      }
    }
    for (let index = attributes.length - 1; index >= 0; index -= 1) {
      const snapshot = attributes[index];
      if (!snapshot) continue;
      if (snapshot.previous === null) {
        snapshot.edit.element.removeAttribute(snapshot.edit.name);
      } else {
        snapshot.edit.element.setAttribute(snapshot.edit.name, snapshot.previous);
      }
    }
  };
}
