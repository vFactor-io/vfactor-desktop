import type { HarnessDefinition } from "../types"
import { DesktopRuntimeHarnessAdapter } from "./desktopRuntimeAdapter"

export class CodexHarnessAdapter extends DesktopRuntimeHarnessAdapter {
  constructor(definition: HarnessDefinition) {
    super(definition)
  }
}
